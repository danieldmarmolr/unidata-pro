"""Endpoint del panel Gerencia 360 (cross-unidad, ganancia real)."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user, require_area
from app.services.executive_profit import (
    gerencia_profit_overview, profit_daily_series, profit_daily_consolidated,
)
from app.services.executive_360 import gerencia_360_blocks
from app.services.commercial_breakdown import commercial_breakdown

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

# Cache 5 min: iterar SKUs + traer cost_idx + 4 queries cross-unidad es caro.
_cache: TTLCache = TTLCache(maxsize=64, ttl=300)
_cache_360: TTLCache = TTLCache(maxsize=64, ttl=300)
_cache_series: TTLCache = TTLCache(maxsize=8, ttl=600)  # serie 90d: TTL largo, es muy cara
_cache_consolidated: TTLCache = TTLCache(maxsize=8, ttl=600)
_cache_commercial: TTLCache = TTLCache(maxsize=32, ttl=600)


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


@router.get("/gerencia/profit-series")
def get_gerencia_profit_series(
    user: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query(ge=7, le=180)] = 90,
) -> dict:
    """Serie diaria de ganancia Unistore (TN+ML) — endpoint separado por costo."""
    require_area(user, ["finanzas", "administracion"])

    key = f"gerencia-series:{days}"

    @cached(_cache_series, key=lambda: key)
    def _build() -> dict:
        return profit_daily_series(days=days)

    return _build()


@router.get("/gerencia/profit-consolidated")
def get_gerencia_profit_consolidated(
    user: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query(ge=14, le=180)] = 90,
    horizon: Annotated[int, Query(ge=7, le=60)] = 28,
) -> dict:
    """Serie diaria consolidada (Unistore TN+ML + Unidrop retencion neta + total)
    + forecasts multi-metodo (8) con MAPE comparativo para elegir el mejor."""
    require_area(user, ["finanzas", "administracion"])

    key = f"gerencia-consolidated:{days}:{horizon}"

    @cached(_cache_consolidated, key=lambda: key)
    def _build() -> dict:
        return profit_daily_consolidated(days=days, forecast_horizon=horizon)

    return _build()


@router.get("/gerencia/commercial")
def get_gerencia_commercial(
    user: Annotated[dict, Depends(current_user)],
    granularity: Annotated[Literal["day", "week", "month", "quarter"], Query()] = "month",
    period_months: Annotated[int, Query(ge=1, le=36)] = 12,
    top_n_skus: Annotated[int, Query(ge=5, le=100)] = 20,
    top_n_customers: Annotated[int, Query(ge=5, le=100)] = 20,
) -> dict:
    """Desglose comercial: serie temporal granular por canal + share + top SKUs
    y clientes por ganancia neta. Granularidad ajustable (day/week/month/quarter)."""
    require_area(user, ["finanzas", "administracion"])

    key = f"commercial:{granularity}:{period_months}:{top_n_skus}:{top_n_customers}"

    @cached(_cache_commercial, key=lambda: key)
    def _build() -> dict:
        return commercial_breakdown(
            granularity=granularity,
            period_months=period_months,
            top_n_skus=top_n_skus,
            top_n_customers=top_n_customers,
        )

    return _build()
