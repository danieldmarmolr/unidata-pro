"""
GET    /api/marketing/meta/overview      → KPIs + daily series + accounts breakdown
GET    /api/marketing/meta/campaigns     → campañas con spend/impressions/clicks
GET    /api/marketing/meta/adsets        → adsets (filtrable por campaign_id)
GET    /api/marketing/meta/ads           → ads (filtrable por adset_id)
POST   /api/marketing/meta/sync          → admin trigger manual del sync
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.security import current_user, require_admin, require_area
from app.db import meta_sync_runs_db
from app.services import meta_ads as meta_svc

router = APIRouter(prefix="/api/marketing/meta", tags=["meta-ads"])


@router.get("/overview")
def get_overview(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y", "all"], Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
) -> dict:
    """KPIs agregados de spend Meta Ads + daily series + accounts."""
    return meta_svc.overview(period=period, unit=unit)


@router.get("/campaigns")
def get_campaigns(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y", "all"], Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    items = meta_svc.campaigns(period=period, unit=unit, limit=limit)
    return {"items": items, "count": len(items), "period": period, "unit": unit}


@router.get("/adsets")
def get_adsets(
    _: Annotated[dict, Depends(current_user)],
    campaign_id: Annotated[str | None, Query()] = None,
    period: Annotated[Literal["7d", "30d", "90d", "1y", "all"], Query()] = "30d",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    items = meta_svc.adsets(campaign_id=campaign_id, period=period, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/ads")
def get_ads(
    _: Annotated[dict, Depends(current_user)],
    adset_id: Annotated[str | None, Query()] = None,
    period: Annotated[Literal["7d", "30d", "90d", "1y", "all"], Query()] = "30d",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    items = meta_svc.ads(adset_id=adset_id, period=period, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/unidrop-impact")
def get_unidrop_impact(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y", "all"], Query()] = "30d",
) -> dict:
    """Cross-data Meta Ads × Unidrop:
    - CAC dropshipper / CAC suscripcion / ROAS
    - Daily overlay (spend + signups + revenue)
    - Funnel impresiones → clicks → signups → suscripciones
    """
    return meta_svc.unidrop_impact(period=period)


# ─── Avanzado: breakdowns / hourly / atribucion / cohort ──────────────────────


BreakdownType = Literal[
    "age", "gender", "publisher_platform", "platform_position",
    "device_platform", "country", "region",
]


@router.get("/breakdown")
def get_breakdown(
    _: Annotated[dict, Depends(current_user)],
    type: Annotated[BreakdownType, Query()] = "age",
    period: Annotated[Literal["7d", "30d", "90d"], Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    return meta_svc.breakdown(period=period, unit=unit, breakdown_type=type, limit=limit)


@router.get("/hourly")
def get_hourly(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d"], Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
) -> dict:
    return meta_svc.hourly_performance(period=period, unit=unit)


@router.get("/sales-attribution")
def get_sales_attribution(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y"], Query()] = "30d",
) -> dict:
    """Revenue PI atribuido al cohort de signups en el periodo + LTV inicial + activation."""
    return meta_svc.sales_attribution(period=period)


@router.get("/top-products")
def get_top_products(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y"], Query()] = "30d",
    limit: Annotated[int, Query(ge=5, le=100)] = 20,
) -> dict:
    """Top SKUs vendidos por dropshippers del cohort firmado en el periodo (ML + TN)."""
    return meta_svc.top_attributed_products(period=period, limit=limit)


@router.get("/cohort-retention")
def get_cohort_retention(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["30d", "90d", "1y"], Query()] = "90d",
) -> dict:
    """Retention 30/60/90d del cohort de signups en el periodo."""
    return meta_svc.cohort_retention(period=period)


@router.get("/signups-per-day")
def get_signups_per_day(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "1y"], Query()] = "30d",
) -> list:
    """Per-day list of new Unidrop users with subscription + revenue context."""
    return meta_svc.signups_per_day(period=period)


@router.get("/campaign-daily")
def get_campaign_daily(
    _: Annotated[dict, Depends(current_user)],
    campaign_id: Annotated[str, Query()],
    period: Annotated[Literal["7d", "30d", "90d", "1y"], Query()] = "30d",
) -> list:
    """Daily spend/clicks/impressions for a specific campaign."""
    return meta_svc.campaign_daily_spend(campaign_id=campaign_id, period=period)


@router.get("/same-time")
def get_same_time(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d"], Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
) -> dict:
    """Compara KPIs Meta + signups vs periodo previo equivalente."""
    return meta_svc.same_time_compare(period=period, unit=unit)


@router.get("/today-vs-yesterday")
def get_today_vs_yesterday(
    _: Annotated[dict, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
) -> dict:
    """Hoy (parcial) vs Ayer (cerrado): spend / impressions / clicks + delta %."""
    return meta_svc.today_vs_yesterday(unit=unit)


@router.get("/spend-pace")
def get_spend_pace(
    _: Annotated[dict, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop", "unidev"] | None, Query()] = None,
) -> dict:
    """Pace de spend por campaña activa: actual vs esperado linealizado por hora AR."""
    items = meta_svc.spend_pace(unit=unit)
    return {"items": items, "count": len(items)}


@router.get("/mkt-unidrop-relationship")
def get_mkt_unidrop_relationship(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["30d", "90d", "1y"], Query()] = "90d",
) -> dict:
    """Quality del cohort semana a semana + relacion con spend Meta:
    CAC signup, CAC sub, LTV 30d, sub rate, activation, retention.
    """
    return meta_svc.mkt_unidrop_relationship(period=period)


@router.post("/sync")
def trigger_sync(
    user: Annotated[dict, Depends(require_admin)],
    historical_days: Annotated[int, Query(ge=1, le=730)] = 30,
) -> dict:
    """Dispara sync ASYNC en background. Retorna run_id; el frontend pollea
    GET /sync-runs/{id} para ver progreso.

    Pull inicial: usar 365 (12 meses).
    Daily incremental: 30 cubre re-statements de Meta (atribución se ajusta).

    Si ya hay un sync activo del mismo kind se reusa su run_id (idempotente).
    """
    dispatch = meta_svc.start_sync_async(
        kind="sync_all",
        historical_days=historical_days,
        started_by_id=user.get("id"),
        started_by_email=user.get("email"),
    )
    return {"kind": "sync_all", **dispatch}


@router.post("/sync-breakdowns")
def trigger_sync_breakdowns(
    user: Annotated[dict, Depends(require_admin)],
    historical_days: Annotated[int, Query(ge=1, le=180)] = 30,
) -> dict:
    """Dispara sync ASYNC de breakdowns (age, gender, placement, geo, hourly).
    Retorna run_id; el frontend pollea GET /sync-runs/{id}.
    """
    dispatch = meta_svc.start_sync_async(
        kind="sync_breakdowns",
        historical_days=historical_days,
        started_by_id=user.get("id"),
        started_by_email=user.get("email"),
    )
    return {"kind": "sync_breakdowns", **dispatch}


@router.get("/sync-runs/{run_id}")
def get_sync_run(
    _: Annotated[dict, Depends(current_user)],
    run_id: int,
) -> dict:
    """Devuelve estado del sync run. Status: pending | running | done | error."""
    run = meta_sync_runs_db.get_run(run_id)
    if run is None:
        raise HTTPException(404, "Run no encontrado")
    return run


@router.get("/sync-runs")
def list_sync_runs(
    _: Annotated[dict, Depends(current_user)],
    kind: Annotated[Literal["sync_all", "sync_breakdowns"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict:
    """Lista runs recientes (default 10) — historial de sync para el panel."""
    items = meta_sync_runs_db.list_runs(kind=kind, limit=limit)
    return {"items": items}
