"""Endpoint del panel Gerencia 360 (cross-unidad, ganancia real)."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user, require_area
from app.services.executive_profit import gerencia_profit_overview
from app.services.executive_360 import gerencia_360_blocks

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

# Cache 5 min: iterar SKUs + traer cost_idx + 4 queries cross-unidad es caro.
_cache: TTLCache = TTLCache(maxsize=64, ttl=300)
_cache_360: TTLCache = TTLCache(maxsize=64, ttl=300)


@router.get("/gerencia")
def get_gerencia(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Bloque 'Ganancia real' del panel Gerencia 360 (Fase 1)."""
    require_area(user, ["finanzas", "administracion"])

    key = f"gerencia:{period}:{from_iso}:{to_iso}"

    @cached(_cache, key=lambda: key)
    def _build() -> dict:
        return gerencia_profit_overview(period=period, from_iso=from_iso, to_iso=to_iso)

    return _build()


@router.get("/gerencia/360")
def get_gerencia_360(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
) -> dict:
    """Bloques enriquecidos: dropshippers + customer intelligence + forecast + cash flow + ops."""
    require_area(user, ["finanzas", "administracion"])

    key = f"gerencia360:{period}"

    @cached(_cache_360, key=lambda: key)
    def _build() -> dict:
        return gerencia_360_blocks(period=period)

    return _build()
