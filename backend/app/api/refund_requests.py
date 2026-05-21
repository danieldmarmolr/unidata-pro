"""
Endpoints AUTENTICADOS para gestion de solicitudes de devolucion de
suscripcion MELI (cola del area Finanzas).

GET    /api/refund-requests                       -> listar
GET    /api/refund-requests/{id}                  -> detalle
POST   /api/refund-requests/{id}/mark-transferred -> Finanzas marca como transferido
POST   /api/refund-requests/{id}/cancel-integration -> dispara DELETE en api.unidrop.com.ar
POST   /api/refund-requests/{id}/reject           -> rechazar
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import refund_requests_db
from app.services.refund_requests.unidrop_api_client import unassign_meli_subscription
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
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    require_area(user, _AREAS)
    try:
        items = refund_requests_db.list_requests(
            status=status_filter, search=search, limit=limit,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "count": len(items)}


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
    require_area(user, _AREAS)
    existing = refund_requests_db.get_request(request_id)
    if not existing:
        raise HTTPException(404, "Solicitud no encontrada")
    if existing["status"] != "transferred":
        raise HTTPException(
            409,
            f"Solo se puede cancelar la integracion despues de marcar como transferido (actual: {existing['status']})",
        )

    try:
        api_response = unassign_meli_subscription(existing["dropshipper_email"])
    except RuntimeError as e:
        log.error("unidrop_api unassign fallo para request %s: %s", request_id, e)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Unidrop API rechazo la desasignacion: {e}",
        )

    audit = f"HTTP {api_response['status_code']}: {api_response['body'][:500]}"
    result = refund_requests_db.mark_integration_cancelled(
        request_id,
        user_id=user["id"],
        user_email=user["email"],
        api_response=audit,
    )
    if not result:
        raise HTTPException(
            409,
            "Unidrop API respondio OK pero no se pudo actualizar el registro (estado cambio concurrentemente)",
        )
    log.info("request %s: integracion MELI cancelada por %s", request_id, user["email"])
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
    return result or {"url": None, "numero": "", "total": 0.0, "fecha": ""}


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
