"""Endpoint del dashboard gerencial (cross-unidad)."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.services.dashboards import executive_overview

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=64, ttl=60)


@router.get("/executive")
def get_executive(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"executive:{period}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _build() -> dict:
        return executive_overview(period=period, from_iso=from_iso, to_iso=to_iso)
    return _build()
