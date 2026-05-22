"""
CRUD de targets operativos por KPI de Logistica.

GET es publico a cualquier user autenticado.
PATCH/DELETE requieren admin, gerencia, o area=it_data / logistica.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path

from app.auth.security import current_user
from app.db import logistics_targets_db as lt

router = APIRouter(prefix="/api/logistics-targets", tags=["logistics-targets"])

Unit = Literal["unistore", "unidrop"]


def _can_edit(user: dict) -> bool:
    if user.get("is_admin"):
        return True
    role = (user.get("role") or "").lower()
    if role in ("admin", "gerencia"):
        return True
    area = (user.get("area_slug") or "").lower()
    return area in ("it_data", "logistica")


def _require_edit(user: dict) -> None:
    if not _can_edit(user):
        raise HTTPException(
            status_code=403,
            detail="Necesitas admin / gerencia / area=it_data o logistica para editar targets",
        )


@router.get("/{unit}")
def list_targets(
    unit: Annotated[Unit, Path()],
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    return {"unit": unit, "items": lt.list_for_unit(unit)}


@router.patch("/{unit}/{kpi_key}")
def upsert_target(
    unit: Annotated[Unit, Path()],
    kpi_key: Annotated[str, Path()],
    user: Annotated[dict, Depends(current_user)],
    payload: Annotated[dict, Body()],
) -> dict:
    _require_edit(user)
    target_value = payload.get("target_value")
    if target_value is None:
        raise HTTPException(status_code=400, detail="target_value es obligatorio")
    try:
        target_value = float(target_value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="target_value debe ser numero")

    direction = payload.get("direction", "lower_is_better")
    note = payload.get("note")

    try:
        return lt.upsert(
            unit=unit,
            kpi_key=kpi_key,
            target_value=target_value,
            direction=direction,
            note=note,
            updated_by_id=int(user["id"]),
            updated_by_email=user.get("email", ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{unit}/{kpi_key}")
def delete_target(
    unit: Annotated[Unit, Path()],
    kpi_key: Annotated[str, Path()],
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _require_edit(user)
    deleted = lt.delete_target(unit, kpi_key)
    return {"deleted": deleted}
