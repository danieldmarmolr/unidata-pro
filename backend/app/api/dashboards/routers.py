"""Endpoints de los dashboards de las fases 2-7."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.services import customer_success as cs_svc
from app.services import devoluciones as dev_svc
from app.services import envios as envios_svc
from app.services import finanzas as finanzas_svc
from app.services import finanzas_unidrop as finanzas_drp_svc
from app.services import logistica as logistica_svc
from app.services import logistica_unidrop as logistica_drp_svc
from app.services import marketing as marketing_svc
from app.services import pagos as pagos_svc
from app.services import products as products_svc
from app.services import saas as saas_svc
from app.services import sales_unidrop as sales_drp_svc
from app.services import subscriptions_meli as subs_meli_svc
from app.services import dropshippers as dropshippers_svc
from app.services import geo as geo_svc
from app.services import story as story_svc
from app.services import today_snapshot as today_svc

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=64, ttl=60)


@router.get("/saas/unidrop")
def get_saas_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    segment: Annotated[Literal["all", "b2b", "b2c"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"saas-uni:{period}:{segment}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return saas_svc.saas_unidrop(period, segment, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/logistica/unistore")
def get_logistica_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    area: Annotated[str, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"log-uni:{period}:{area}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return logistica_svc.logistica_unistore(period, area, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/finanzas/unistore")
def get_finanzas_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"fin-uni:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return finanzas_svc.finanzas_unistore(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/marketing/unistore")
def get_marketing_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"mkt-uni:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unistore(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/marketing/unidrop")
def get_marketing_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"mkt-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/pagos/unidrop")
def get_pagos(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"pagos:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return pagos_svc.pagos_unidrop(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/sales/unidrop")
def get_sales_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"sales-drp:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return sales_drp_svc.sales_unidrop(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/logistica/unidrop")
def get_logistica_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"log-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return logistica_drp_svc.logistica_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/finanzas/unidrop")
def get_finanzas_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"fin-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return finanzas_drp_svc.finanzas_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/devoluciones")
def get_devoluciones(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    modelo: Annotated[Literal["all", "unistore", "unidrop", "unifull"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"dev:{period}:{modelo}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return dev_svc.devoluciones(period, modelo, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/subscriptions-meli")
def get_subs_meli(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    plan: Annotated[str, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"subs-meli:{period}:{plan}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return subs_meli_svc.subscriptions_meli(period, plan, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/cs/{unit}")
def get_cs(
    unit: str,
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    unit = unit.lower()
    key = f"cs:{unit}:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        if unit == "unistore":
            return cs_svc.cs_unistore(period, channel, from_iso=from_iso, to_iso=to_iso)
        if unit == "unidrop":
            return cs_svc.cs_unidrop(period, channel, from_iso=from_iso, to_iso=to_iso)
        return {}
    return _b()


@router.get("/geo")
def get_geo(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"geo:{period}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return geo_svc.geo_overview(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/geo/province/{province}")
def get_geo_province(
    province: str,
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"geo-prov:{province}:{period}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return geo_svc.province_detail(province, period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/story")
def get_story(_: Annotated[str, Depends(current_user)]) -> dict:
    key = "story-today"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return story_svc.today_story()
    return _b()


@router.get("/dropshippers")
def get_dropshippers(
    _: Annotated[str, Depends(current_user)],
    plan: Annotated[str, Query()] = "all",
    riesgo: Annotated[str, Query()] = "all",
    actividad: Annotated[str, Query()] = "all",
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(le=2000)] = 1000,
) -> dict:
    return dropshippers_svc.dropshippers_master(plan, riesgo, actividad, search, limit)


@router.get("/dropshippers/cohorts")
def get_dropshippers_cohorts(_: Annotated[str, Depends(current_user)]) -> dict:
    return dropshippers_svc.cohort_signups()


from app.services import lotes_analytics as lotes_svc


@router.get("/lotes")
def get_lotes(
    _: Annotated[str, Depends(current_user)],
    proveedor: Annotated[str | None, Query()] = None,
    origen: Annotated[str | None, Query()] = None,
    lote: Annotated[str | None, Query()] = None,
    fecha_desde: Annotated[str | None, Query()] = None,
    fecha_hasta: Annotated[str | None, Query()] = None,
) -> dict:
    """Gestion de Lotes - replica del PowerBI ERP Analytics.

    Devuelve KPIs agregados (Total Costos, Facturacion, Markup, Cobertura, Consumo)
    + lista de lotes con sus metricas individuales.
    """
    filters = {
        "proveedor": proveedor,
        "origen": origen,
        "lote": lote,
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
    }
    return lotes_svc.lotes_overview(filters)


@router.get("/lotes/{lote_id}/detail")
def get_lote_detail(
    lote_id: int,
    _: Annotated[str, Depends(current_user)],
) -> dict:
    """Detalle del lote: KPIs + items con su estado de consumo + atribucion de ventas."""
    detail = lotes_svc.lote_detail(lote_id)
    if not detail:
        from fastapi import HTTPException
        raise HTTPException(404, f"Lote {lote_id} no encontrado")
    return detail


@router.get("/today")
def get_today(
    _: Annotated[str, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop", "all"], Query()] = "all",
) -> dict:
    """Comparador HOY. Si unit=unistore o unidrop, muestra solo bloques de esa unidad.
    Default 'all' = vista cross-unidad (Gerencial)."""
    cache_key = f"today-snap-{unit}"
    @cached(_cache, key=lambda: cache_key)
    def _b() -> dict:
        scope = None if unit == "all" else unit
        return today_svc.today_snapshot(unit=scope)
    return _b()


@router.get("/products")
def get_products(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"prod:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.products_overview(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/products/sku/{sku}")
def get_product_detail(
    sku: str,
    _: Annotated[str, Depends(current_user)],
) -> dict:
    key = f"prod-sku:{sku}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.product_detail(sku)
    return _b()


@router.get("/customers/{customer_id}")
def get_customer_detail(
    customer_id: int,
    _: Annotated[str, Depends(current_user)],
) -> dict:
    key = f"cust:{customer_id}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.customer_detail(customer_id)
    return _b()


@router.get("/envios/unidrop")
def get_envios(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    courier: Annotated[Literal["all", "oca", "lightdata"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    key = f"env:{period}:{courier}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return envios_svc.envios_unidrop(period, courier, from_iso=from_iso, to_iso=to_iso)
    return _b()
