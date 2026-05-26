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
from app.services import subscription_churn
from app.services.gerencia_explain import explain_metric
from app.services.meta_explain import explain_meta_unidrop

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

# Cache 5 min: iterar SKUs + traer cost_idx + 4 queries cross-unidad es caro.
_cache: TTLCache = TTLCache(maxsize=64, ttl=300)
_cache_360: TTLCache = TTLCache(maxsize=64, ttl=300)
_cache_series: TTLCache = TTLCache(maxsize=8, ttl=600)  # serie 90d: TTL largo, es muy cara
_cache_consolidated: TTLCache = TTLCache(maxsize=8, ttl=600)
_cache_commercial: TTLCache = TTLCache(maxsize=32, ttl=600)
_cache_churn: TTLCache = TTLCache(maxsize=8, ttl=180)
_cache_explain: TTLCache = TTLCache(maxsize=128, ttl=300)
_cache_meta_explain: TTLCache = TTLCache(maxsize=32, ttl=300)


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


@router.get("/gerencia/explain/{metric}")
def get_gerencia_explain(
    metric: str,
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Breakdown estructurado de cada KPI de Gerencia (formula + steps + fuentes + warnings).

    Metricas soportadas: ganancia-consolidada · margen-consolidado · cobertura-costos ·
    deuda-talo · unistore-{revenue,ganancia,costo,margen} · unidrop-{volumen,costo-mercaderia,
    margen-bruto,comisiones,subs-meli,mayorista,meta-ads,egresos,ingresos,ganancia-neta,margen}."""
    require_area(user, ["finanzas", "administracion"])

    key = f"explain:{metric}:{period}:{from_iso}:{to_iso}"

    @cached(_cache_explain, key=lambda: key)
    def _build() -> dict:
        return explain_metric(metric=metric, period=period, from_iso=from_iso, to_iso=to_iso)

    return _build()


@router.get("/gerencia/meta-explain")
def get_gerencia_meta_explain(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m"], Query()] = "30d",
) -> dict:
    """Cruce Meta Ads x Unidrop con los 2 modelos de atribucion lado a lado:
    period-based (lo que hoy se resta en Gerencia) vs cohort-attributed
    (revenue de la cohort firmada en el periodo en sus primeros 30d).
    Devuelve KPIs comparativos + funnel + recomendacion textual."""
    require_area(user, ["finanzas", "administracion"])

    key = f"meta-explain:{period}"

    @cached(_cache_meta_explain, key=lambda: key)
    def _build() -> dict:
        return explain_meta_unidrop(period=period)

    return _build()


@router.get("/gerencia/churn-suscripciones")
def get_gerencia_churn(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["30d", "90d", "6m", "1y"], Query()] = "30d",
    granularity: Annotated[Literal["day", "week", "month", "quarter", "year"], Query()] = "month",
) -> dict:
    """Churn de suscripciones MELI: cancelaciones, errores del form y razones.
    `period` filtra KPIs y tablas. `granularity` controla la serie temporal."""
    require_area(user, ["finanzas", "administracion", "cs"])

    key = f"churn:{period}:{granularity}"

    @cached(_cache_churn, key=lambda: key)
    def _build() -> dict:
        return subscription_churn.get_churn_overview(period=period, granularity=granularity)

    return _build()


@router.get("/gerencia/churn-suscripciones/drill-down")
def get_gerencia_churn_drill(
    user: Annotated[dict, Depends(current_user)],
    period_start: Annotated[str, Query(min_length=10, max_length=10)],
    period_end: Annotated[str, Query(min_length=10, max_length=10)],
) -> dict:
    """Drill-down: solicitudes de un periodo especifico clickeado en el chart.
    `period_end` es exclusivo. Sin cache (rangos arbitrarios)."""
    require_area(user, ["finanzas", "administracion", "cs"])
    return subscription_churn.get_drill_down(period_start=period_start, period_end=period_end)


@router.get("/gerencia/explain/{metric}")
def get_gerencia_explain(
    metric: str,
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Breakdown estructurado de cada KPI de Gerencia (formula + steps + fuentes + warnings).

    Metricas soportadas: ganancia-consolidada, margen-consolidado, cobertura-costos,
    deuda-talo, unistore-{revenue,ganancia,costo,margen}, unidrop-{volumen,
    costo-mercaderia,margen-bruto,comisiones,subs-meli,mayorista,meta-ads,egresos,
    ingresos,ganancia-neta,margen}, meta-{spend,cac-signup,cac-sub,roas-cohort,
    ltv-30d,roas-period}."""
    require_area(user, ["finanzas", "administracion"])

    key = f"explain:{metric}:{period}:{from_iso}:{to_iso}"

    @cached(_cache_explain, key=lambda: key)
    def _build() -> dict:
        return explain_metric(metric=metric, period=period, from_iso=from_iso, to_iso=to_iso)

    return _build()


@router.get("/gerencia/meta-explain")
def get_gerencia_meta_explain(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m"], Query()] = "30d",
) -> dict:
    """Cruce Meta Ads x Unidrop con los 2 modelos de atribucion lado a lado:
    period-based (lo que hoy se resta en Gerencia) vs cohort-attributed
    (revenue de la cohort firmada en el periodo en sus primeros 30d).
    Devuelve KPIs comparativos + funnel + recomendacion textual."""
    require_area(user, ["finanzas", "administracion"])

    key = f"meta-explain:{period}"

    @cached(_cache_meta_explain, key=lambda: key)
    def _build() -> dict:
        return explain_meta_unidrop(period=period)

    return _build()


@router.post("/gerencia/churn-suscripciones/analyze")
def post_gerencia_churn_analyze(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["30d", "90d", "6m", "1y"], Query()] = "30d",
    granularity: Annotated[Literal["day", "week", "month", "quarter", "year"], Query()] = "week",
    force: Annotated[bool, Query()] = False,
) -> dict:
    """Genera (o devuelve cache 1h) un analisis LLM Gemini sobre el churn del
    periodo. Persiste en subscription_churn_insights. force=true ignora cache."""
    require_area(user, ["finanzas", "administracion", "cs"])
    from app.services import subscription_churn_llm
    return subscription_churn_llm.analyze(
        period=period,
        granularity=granularity,
        force=force,
        generated_by_id=user.get("id"),
        generated_by_email=user.get("email"),
    )


@router.get("/gerencia/churn-suscripciones/insights")
def get_gerencia_churn_insights(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["30d", "90d", "6m", "1y"], Query()] = "30d",
    granularity: Annotated[Literal["day", "week", "month", "quarter", "year"], Query()] = "week",
) -> dict:
    """Devuelve el ultimo analisis LLM persistido (sin regenerar)."""
    require_area(user, ["finanzas", "administracion", "cs"])
    from app.db import churn_insights_db
    latest = churn_insights_db.get_latest(period=period, granularity=granularity)
    if not latest:
        return {"has_insight": False, "period": period, "granularity": granularity}
    return {"has_insight": True, **latest}
