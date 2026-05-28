"""Endpoints AUTENTICADOS para gestion de devoluciones de Mercado Libre
(cola del area Finanzas).

GET    /api/ml-return-actions                       -> listar devoluciones (con filtros + tab)
GET    /api/ml-return-actions/{ml_order_id}         -> detalle
POST   /api/ml-return-actions/{ml_order_id}/mark-transferred -> Finanzas marca transferencia
POST   /api/ml-return-actions/{ml_order_id}/reject  -> rechazar
POST   /api/ml-return-actions/{ml_order_id}/revert-to-pending -> revertir transfer
GET    /api/ml-return-actions/{ml_order_id}/invoice-url -> link factura
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import ml_return_actions_db
from app.services import ml_returns_finance

log = logging.getLogger("unidata.api.ml_return_actions")

router = APIRouter(prefix="/api/ml-return-actions", tags=["ml-return-actions"])

_AREAS = ["finanzas", "administracion"]


class TransferBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    amount_arg: float | None = Field(default=None, ge=0)
    return_idx: int = Field(default=1, ge=1)


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=5, max_length=1000)
    return_idx: int = Field(default=1, ge=1)


class RevertBody(BaseModel):
    return_idx: int = Field(default=1, ge=1)


@router.get("")
def list_(
    user: Annotated[dict, Depends(current_user)],
    # tab tolerante: si llega un valor no soportado, el service cae a "todas" en
    # vez de tirar 422 (asi el frontend evoluciona mas rapido que el backend
    # sin romper la pantalla)
    tab: Annotated[str, Query()] = "todas",
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    require_area(user, _AREAS)
    return ml_returns_finance.list_ml_returns(
        tab=tab, search=search, limit=limit, offset=offset,
    )


@router.get("/{ml_order_id}")
def detail(
    ml_order_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    row = ml_returns_finance.get_ml_return(ml_order_id)
    if not row:
        raise HTTPException(404, "Devolucion no encontrada")
    return row


@router.post("/{ml_order_id}/mark-transferred")
def mark_transferred(
    ml_order_id: int,
    body: TransferBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    detail_row = ml_returns_finance.get_ml_return(ml_order_id)
    if not detail_row:
        raise HTTPException(404, "Devolucion no encontrada")
    action = detail_row.get("finance_action")
    if action and action.get("status") != "pending":
        raise HTTPException(
            409,
            f"Solo se pueden marcar como transferidas las devoluciones en estado pendiente (actual: {action.get('status')})",
        )
    drop = detail_row.get("dropshipper") or {}
    result = ml_return_actions_db.mark_transferred(
        ml_order_id,
        return_idx=body.return_idx,
        user_id=user["id"],
        user_email=user["email"],
        note=(body.note or "").strip() or None,
        amount_arg=body.amount_arg,
        dropshipper_user_id=drop.get("user_id"),
        dropshipper_dni=drop.get("dni") or None,
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result


@router.post("/{ml_order_id}/reject")
def reject(
    ml_order_id: int,
    body: RejectBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    detail_row = ml_returns_finance.get_ml_return(ml_order_id)
    if not detail_row:
        raise HTTPException(404, "Devolucion no encontrada")
    action = detail_row.get("finance_action")
    if action and action.get("status") != "pending":
        raise HTTPException(
            409,
            f"Solo se pueden rechazar devoluciones en estado pendiente (actual: {action.get('status')})",
        )
    drop = detail_row.get("dropshipper") or {}
    result = ml_return_actions_db.mark_rejected(
        ml_order_id,
        return_idx=body.return_idx,
        user_id=user["id"],
        user_email=user["email"],
        reason=body.reason.strip(),
        dropshipper_user_id=drop.get("user_id"),
        dropshipper_dni=drop.get("dni") or None,
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result


@router.post("/{ml_order_id}/revert-to-pending")
def revert_to_pending(
    ml_order_id: int,
    body: RevertBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    action = ml_return_actions_db.get_action(ml_order_id, body.return_idx)
    if not action:
        raise HTTPException(404, "No hay accion registrada")
    if action.get("status") != "transferred":
        raise HTTPException(
            409,
            f"Solo se pueden revertir devoluciones 'transferred' a 'pending' (actual: {action.get('status')})",
        )
    result = ml_return_actions_db.revert_to_pending(
        ml_order_id,
        return_idx=body.return_idx,
        user_id=user["id"],
        user_email=user["email"],
    )
    if not result:
        raise HTTPException(409, "No se pudo actualizar (estado cambio concurrentemente)")
    return result


@router.get("/{ml_order_id}/invoice-url")
def invoice_url(
    ml_order_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, _AREAS)
    row = ml_returns_finance.get_ml_return(ml_order_id)
    if not row:
        raise HTTPException(404, "Devolucion no encontrada")
    inv = row.get("invoice") or {}
    return {
        "url": inv.get("link") or None,
        "numero": inv.get("numero") or "",
        "total": float(inv.get("total") or 0),
        "fecha": inv.get("fecha") or "",
        "tipo": inv.get("tipo") or "",
    }
