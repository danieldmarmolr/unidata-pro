"""
Endpoints AUTENTICADOS para gestion de solicitudes de devolucion de
suscripcion MELI (cola del area Finanzas).

GET    /api/refund-requests                       -> listar
GET    /api/refund-requests/{id}                  -> detalle
POST   /api/refund-requests/{id}/mark-transferred -> Finanzas marca como transferido
POST   /api/refund-requests/{id}/cancel-integration -> marca como cancelado (desvinculacion manual en panel Unidrop)
POST   /api/refund-requests/{id}/reject           -> rechazar
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_admin, require_area
from app.db import refund_requests_db
from app.services.finanzas_invoices_meli import get_latest_subscription_invoice_for_dni

log = logging.getLogger("unidata.api.refund_requests")

router = APIRouter(prefix="/api/refund-requests", tags=["refund-requests"])

_AREAS = ["finanzas", "administracion"]


class TransferBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    refund_amount_arg: float | None = Field(default=None, ge=0)


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=5, max_length=1000)


@router.get("")
def list_(
    user: Annotated[dict, Depends(current_user)],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query()] = None,
    from_date: Annotated[str | None, Query(description="YYYY-MM-DD")] = None,
    to_date: Annotated[str | None, Query(description="YYYY-MM-DD")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    require_area(user, _AREAS)
    try:
        items = refund_requests_db.list_requests(
            status=status_filter, search=search,
            from_date=from_date, to_date=to_date, limit=limit,
        )
        counts = refund_requests_db.counts_by_status(
            search=search, from_date=from_date, to_date=to_date,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "count": len(items), "counts_by_status": counts}


@router.get("/{request_id}")
def detail(
    request_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    row = refund_requests_db.get_request(request_id)
    if not row:
        raise HTTPException(404, "Solicitud no encontrada")
    return row


@router.post("/{request_id}/mark-transferred")
def mark_transferred(
    request_id: int,
    body: TransferBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    if existing["status"] != "pending":
        raise HTTPException(
            409,
            f"Solo se pueden marcar como transferidas las solicitudes en estado 'pending' (actual: {existing['status']})",
        )
    result = refund_requests_db.mark_transferred(
        request_id,
        user_id=user["id"],
        user_email=user["email"],
        note=(body.note or "").strip() or None,
        refund_amount_arg=body.refund_amount_arg,
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result


@router.post("/{request_id}/cancel-integration")
def cancel_integration(
    request_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Marca la solicitud como integration_cancelled.

    La desvinculacion real de Mercado Libre se hace MANUAL en el panel de
    Unidrop (unidrop.com.ar/panel/users/{user_id}) — desde el frontend se
    abre esa URL y el admin marca el checkbox + Desvincular alli. Este
    endpoint solo registra que el paso ya se hizo, sin llamar a la API de
    Unidrop (que requeriria UNIDROP_API_TOKEN, no disponible aun).
    """
    require_area(user, _AREAS)
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    if existing["status"] != "transferred":
        raise HTTPException(
            409,
            f"Solo se puede cancelar la integracion despues de marcar como transferido (actual: {existing['status']})",
        )

    audit = f"Desvinculacion manual en panel Unidrop (user_id={existing['dropshipper_user_id']})"
    result = refund_requests_db.mark_integration_cancelled(
        request_id,
        user_id=user["id"],
        user_email=user["email"],
        api_response=audit,
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    log.info("request %s: integracion MELI marcada como cancelada por %s (desvinculacion manual)",
             request_id, user["email"])
    return result


@router.get("/{request_id}/invoice-url")
def invoice_url(
    request_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    row = refund_requests_db.get_request(request_id)
    if not row:
        raise HTTPException(404, "Solicitud no encontrada")
    result = get_latest_subscription_invoice_for_dni(row["dropshipper_dni"])
    return result or {"url": None, "numero": "", "total": 0.0, "fecha": "", "tipo": ""}


@router.post("/{request_id}/revert-to-pending")
def revert_to_pending(
    request_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Vuelve una solicitud Transferida al estado Pendiente.

    Util para correccion de errores o pruebas. Borra los campos
    transferred_* (no se preserva audit). NO funciona desde estados
    terminales (integration_cancelled, rejected).
    """
    require_area(user, _AREAS)
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    if existing["status"] != "transferred":
        raise HTTPException(
            409,
            f"Solo se pueden revertir solicitudes 'transferred' a 'pending' (actual: {existing['status']})",
        )
    result = refund_requests_db.revert_to_pending(
        request_id, user_id=user["id"], user_email=user["email"],
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result


@router.delete("/{request_id}")
def delete_(
    request_id: int,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    """Borra una solicitud (hard delete). Solo admin.

    Pensado para limpiar registros de prueba o entradas duplicadas que
    no tienen valor historico. Si la solicitud ya esta en un estado
    terminal con audit util, considerar mantenerla en vez de borrar.
    """
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    ok = refund_requests_db.delete_request(request_id)
    if not ok:
        raise HTTPException(409, "No se pudo borrar")
    log.info("request %s borrada por admin %s", request_id, admin["email"])
    return {"deleted": True, "id": request_id}


@router.post("/{request_id}/reject")
def reject(
    request_id: int,
    body: RejectBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    if existing["status"] != "pending":
        raise HTTPException(
            409,
            f"Solo se pueden rechazar solicitudes en estado 'pending' (actual: {existing['status']})",
        )
    result = refund_requests_db.mark_rejected(
        request_id,
        user_id=user["id"],
        user_email=user["email"],
        reason=body.reason.strip(),
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result
