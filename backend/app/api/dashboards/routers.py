"""Endpoints de los dashboards de las fases 2-7."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user, require_area
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
from app.services import orders_global_unidrop as orders_global_svc

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=64, ttl=60)


@router.get("/saas/unidrop")
def get_saas_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    segment: Annotated[Literal["all", "b2b", "b2c"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["ventas", "marketing"])
    key = f"saas-uni:{period}:{segment}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return saas_svc.saas_unidrop(period, segment, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/logistica/unistore")
def get_logistica_unistore(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    area: Annotated[str, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["logistica"])
    key = f"log-uni:{period}:{area}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return logistica_svc.logistica_unistore(period, area, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/finanzas/unistore")
def get_finanzas_unistore(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["finanzas", "administracion"])
    key = f"fin-uni:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return finanzas_svc.finanzas_unistore(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/marketing/unistore")
def get_marketing_unistore(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["marketing"])
    key = f"mkt-uni:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unistore(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/marketing/unidrop")
def get_marketing_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["marketing"])
    key = f"mkt-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/pagos/unidrop")
def get_pagos(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["finanzas", "administracion"])
    key = f"pagos:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return pagos_svc.pagos_unidrop(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/sales/unidrop")
def get_sales_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["ventas"])
    key = f"sales-drp:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return sales_drp_svc.sales_unidrop(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


_orders_global_cache: TTLCache = TTLCache(maxsize=64, ttl=90)


@router.get("/unidrop/orders")
def get_unidrop_orders_global(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "7d",
    channel: Annotated[Literal["all", "ml", "tn"], Query()] = "all",
    shipping_type: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=300)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Vista global de órdenes Unidrop: todas las órdenes ML + TN de todos los dropshippers."""
    require_area(user, ["ventas", "cs"])
    key = f"ord-global:{period}:{channel}:{shipping_type}:{status}:{search}:{limit}:{offset}:{from_iso}:{to_iso}"
    cached_val = _orders_global_cache.get(key)
    if cached_val is not None:
        return cached_val
    result = orders_global_svc.orders_global_unidrop(
        period=period, channel=channel, shipping_type=shipping_type,
        status_filter=status, search_drop=search, limit=limit, offset=offset,
        from_iso=from_iso, to_iso=to_iso,
    )
    _orders_global_cache[key] = result
    return result


@router.get("/logistica/unidrop")
def get_logistica_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["logistica"])
    key = f"log-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return logistica_drp_svc.logistica_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/finanzas/unidrop")
def get_finanzas_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["finanzas", "administracion"])
    key = f"fin-drp:{period}::{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return finanzas_drp_svc.finanzas_unidrop(period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/devoluciones")
def get_devoluciones(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    modelo: Annotated[Literal["all", "unistore", "unidrop", "unifull"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["cs", "logistica"])
    key = f"dev:{period}:{modelo}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return dev_svc.devoluciones(period, modelo, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/subscriptions-meli")
def get_subs_meli(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    plan: Annotated[str, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["finanzas", "administracion", "ventas"])
    key = f"subs-meli:{period}:{plan}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return subs_meli_svc.subscriptions_meli(period, plan, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/cs/{unit}")
def get_cs(
    unit: str,
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["cs"])
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
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    unit: Annotated[Literal["unistore", "unidrop", "unidev"], Query()] = "unistore",
) -> dict:
    """Distribucion geografica (ranking por provincia) por unidad de negocio.
    unistore = ventas TN del retail. unidrop = ventas dropshippers TN.
    unidev = casos de devolucion abiertos."""
    key = f"geo:{period}:{from_iso}:{to_iso}:{unit}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return geo_svc.geo_overview(period, from_iso=from_iso, to_iso=to_iso, unit=unit)
    return _b()


@router.get("/geo/province/{province}")
def get_geo_province(
    province: str,
    user: Annotated[dict, Depends(current_user)],
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
def get_story(user: Annotated[dict, Depends(current_user)]) -> dict:
    key = "story-today"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return story_svc.today_story()
    return _b()


_dropshippers_cache: TTLCache = TTLCache(maxsize=256, ttl=180)  # 3 min


@router.get("/dropshippers")
def get_dropshippers(
    user: Annotated[dict, Depends(current_user)],
    plan: Annotated[str, Query()] = "all",
    riesgo: Annotated[str, Query()] = "all",
    actividad: Annotated[str, Query()] = "all",
    canal: Annotated[Literal["all", "meli", "tn", "ambos", "sin_canal"], Query()] = "all",
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(le=20000)] = 500,
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Listado de dropshippers Unidrop con caching agresivo (3 min TTL).
    Default limit reducido a 500 - la UI hace pagination/filter del lado cliente.
    """
    require_area(user, ["ventas", "cs"])
    cache_key = f"dropshippers:{plan}:{riesgo}:{actividad}:{canal}:{search or ''}:{limit}:{period}:{from_iso or ''}:{to_iso or ''}"
    cached_val = _dropshippers_cache.get(cache_key)
    if cached_val is not None:
        return cached_val
    result = dropshippers_svc.dropshippers_master(
        plan, riesgo, actividad, search, limit, canal=canal,
        period=period, from_iso=from_iso, to_iso=to_iso,
    )
    _dropshippers_cache[cache_key] = result
    return result


@router.get("/dropshippers/cohorts")
def get_dropshippers_cohorts(user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, ["ventas", "cs"])
    return dropshippers_svc.cohort_signups()


_drop_detail_cache: TTLCache = TTLCache(maxsize=512, ttl=120)  # 2 min


@router.get("/dropshippers/{user_id}")
def get_dropshipper_detail(
    user_id: int,
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Vista 360 de un dropshipper Unidrop con cache 2 min."""
    require_area(user, ["ventas", "cs"])
    cache_key = f"drop-detail:{user_id}:{period}:{from_iso or ''}:{to_iso or ''}"
    cached_val = _drop_detail_cache.get(cache_key)
    if cached_val is not None:
        return cached_val
    result = dropshippers_svc.dropshipper_detail(user_id, period=period, from_iso=from_iso, to_iso=to_iso)
    _drop_detail_cache[cache_key] = result
    return result


_drop_unified_cache: TTLCache = TTLCache(maxsize=512, ttl=120)  # 2 min


@router.get("/dropshippers/{user_id}/unified-orders")
def get_dropshipper_unified_orders(
    user_id: int,
    user: Annotated[dict, Depends(current_user)],
    intent_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 2000,
) -> dict:
    """Vista unificada de ordenes ML + TN. Si intent_id es no-null, filtra a las
    ordenes de ese PaymentIntent (click-to-filter del frontend)."""
    require_area(user, ["ventas", "cs"])
    cache_key = f"drop-unified:{user_id}:{intent_id or ''}:{limit}"
    cached_val = _drop_unified_cache.get(cache_key)
    if cached_val is not None:
        return cached_val
    items = dropshippers_svc.dropshipper_unified_orders(user_id, limit=limit, intent_id=intent_id)
    result = {"items": items, "total": len(items), "intent_id": intent_id}
    _drop_unified_cache[cache_key] = result
    return result


# ============================================================
# Descarga de etiquetas de envio (PDF)
# ============================================================
import base64
import binascii
from fastapi import HTTPException
from fastapi.responses import Response
from sqlalchemy import text as _sql_text
from app.db.engines import get_engine as _get_engine


@router.get("/orders/ml/{ext_id}/label")
def download_ml_label(
    ext_id: str,
    user: Annotated[dict, Depends(current_user)],
) -> Response:
    """Descarga la etiqueta PDF de una orden MELI (FLEX, ML FLEX, PR, Punto de Retiro).

    Source: mercado_libre_dev.OrderMercadoLibre.etiqueta_pdf_base64.
    Devuelve application/pdf con header Content-Disposition para forzar download.
    """
    require_area(user, ["ventas", "cs", "logistica"])
    eng = _get_engine("unidrop")
    with eng.connect() as c:
        row = c.execute(_sql_text("""
            SELECT etiqueta_pdf_base64, number
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE id::text = :ext
            LIMIT 1
        """), {"ext": str(ext_id)}).first()
    if not row or not row[0]:
        raise HTTPException(404, f"Etiqueta no disponible para la orden ML {ext_id}")
    try:
        pdf_bytes = base64.b64decode(row[0])
    except binascii.Error:
        raise HTTPException(500, "PDF mal codificado en la BD")
    fname = (row[1] or f"orden-ml-{ext_id}") + ".pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/orders/tn/{internal_id}/label")
def download_tn_label(
    internal_id: str,
    user: Annotated[dict, Depends(current_user)],
) -> Response:
    """Descarga la etiqueta PDF de una orden Tiendanube (OCA, Lightdata).

    Prueba en este orden:
    1. oca_shipments.etiqueta_pdf_base64 (por order_tienda_nube_id)
    2. lightdata_shipments.etiqueta_pdf_base64 (por orden_tn_id)
    """
    require_area(user, ["ventas", "cs", "logistica"])
    eng = _get_engine("unidrop")
    with eng.connect() as c:
        # Try OCA first
        oca = c.execute(_sql_text("""
            SELECT etiqueta_pdf_base64
            FROM public.oca_shipments
            WHERE order_tienda_nube_id::text = :tn AND etiqueta_pdf_base64 IS NOT NULL
            LIMIT 1
        """), {"tn": str(internal_id)}).first()
        pdf_b64 = oca[0] if oca else None
        carrier = "OCA" if oca else None
        if not pdf_b64:
            ld = c.execute(_sql_text("""
                SELECT etiqueta_pdf_base64
                FROM public.lightdata_shipments
                WHERE orden_tn_id::text = :tn AND etiqueta_pdf_base64 IS NOT NULL
                LIMIT 1
            """), {"tn": str(internal_id)}).first()
            pdf_b64 = ld[0] if ld else None
            carrier = "Lightdata" if ld else None
        # Get TN number for filename
        tn_num = c.execute(_sql_text("""
            SELECT number FROM public.tienda_nube_orders
            WHERE tienda_nube_id::text = :tn LIMIT 1
        """), {"tn": str(internal_id)}).first()
    if not pdf_b64:
        raise HTTPException(404, f"Etiqueta no disponible para la orden TN {internal_id}")
    try:
        pdf_bytes = base64.b64decode(pdf_b64)
    except binascii.Error:
        raise HTTPException(500, "PDF mal codificado en la BD")
    fname = (tn_num[0] if tn_num and tn_num[0] else f"orden-tn-{internal_id}") + f"-{carrier or 'envio'}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ============================================================
# UNIDROP END CONSUMER 360 (compradores finales de los dropshippers)
# ============================================================
from app.services import end_consumers_unidrop as ec_unidrop_svc


@router.get("/unidrop/end-consumer/{dni}")
def get_unidrop_end_consumer(
    dni: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Vista 360 del CLIENTE FINAL Unidrop (la persona que compra al dropshipper).

    Pivot por DNI (`tienda_nube_orders.contact_identification`). Agrega ordenes
    cross-dropshipper para ver el journey completo del comprador.
    """
    require_area(user, ["ventas", "cs"])
    return ec_unidrop_svc.end_consumer_detail_unidrop(dni)


# ============================================================
# BUSQUEDA DE CLIENTES Y DROPSHIPPERS
# ============================================================
from app.services import search_customers as search_svc


@router.get("/search/unistore-customers")
def search_unistore_customers(
    user: Annotated[dict, Depends(current_user)],
    q: Annotated[str, Query(min_length=1, max_length=120)] = "",
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "12m",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    only_active: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    """Busqueda rapida de clientes Unistore por texto (nombre/email/tel/id).
    Con period + only_active=true devuelve solo los que compraron en la ventana."""
    require_area(user, ["cs", "ventas"])
    return search_svc.search_unistore_customers(
        q, period=period, from_iso=from_iso, to_iso=to_iso,
        only_active_in_period=only_active, limit=limit,
    )


@router.get("/search/unidrop-dropshippers")
def search_unidrop_dropshippers(
    user: Annotated[dict, Depends(current_user)],
    q: Annotated[str, Query(min_length=1, max_length=120)] = "",
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "12m",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    only_active: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    """Busqueda rapida de dropshippers Unidrop por texto (nombre/fantasy/email/dni/cuit)."""
    require_area(user, ["cs", "ventas"])
    return search_svc.search_unidrop_dropshippers(
        q, period=period, from_iso=from_iso, to_iso=to_iso,
        only_active_in_period=only_active, limit=limit,
    )


from app.services import lotes_analytics as lotes_svc
from app.services import cohorts_analytics as cohorts_svc
from app.services import rfm_analytics as rfm_svc
from app.services import stock_heatmap as stock_svc
from app.services import envios_unistore as envios_uni_svc
from app.services import envios_meli_unidrop as envios_meli_svc
from app.services import notifications as notif_svc
from app.services import customer_vip as vip_svc
from app.services import product_analytics as prod_analytics_svc
from app.services import sku_optimizer as sku_opt_svc
from app.services import rfm_flows as rfm_flows_svc
from app.services import forecast_batch as forecast_svc
from app.services import cancel_nlp as cancel_nlp_svc
from app.services import dev_nlp as dev_nlp_svc
from app.services import sku_omnichannel as sku_omni_svc


@router.get("/sku-omnichannel/{sku}")
def get_sku_omnichannel(
    sku: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Vista 360 de un SKU en los 4 canales del grupo:
    Unistore TN, Unistore MELI (Fox Electronics), Unidrop TN, Unidrop MELI.
    UNIDATA orquesta las consultas a las 2 bases con sus 4 esquemas distintos."""
    require_area(user, ["ventas", "compras"])
    key = f"sku-omnichannel-{sku}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return sku_omni_svc.sku_omnichannel(sku)
    return _b()


@router.get("/sku-optimizer")
def get_sku_optimizer(
    user: Annotated[dict, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """SKU Optimizer: combos + reposicion urgente + liquidar + pricing.
    unit=unistore (default): TN retail + digip stock.
    unit=unidrop: TN de dropshippers; reposicion y liquidar referencian
    stock de Unistore (no propio)."""
    require_area(user, ["ventas", "compras"])
    key = f"sku-optimizer-{unit}-v1"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return sku_opt_svc.sku_optimizer_overview(unit=unit)
    return _b()


@router.get("/rfm-flows")
def get_rfm_flows(
    user: Annotated[dict, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """Migracion de segmentos RFM mes a mes (Sankey).
    unit=unistore: clientes finales TN
    unit=unidrop:  dropshippers Unidrop (PaymentIntent ground truth)"""
    require_area(user, ["cs", "marketing"])
    key = f"rfm-flows-{unit}-v2"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        if unit == "unidrop":
            return rfm_flows_svc.rfm_flows_mom_unidrop()
        return rfm_flows_svc.rfm_flows_mom()
    return _b()


@router.get("/rfm-flows/customers")
def get_rfm_flows_customers(
    user: Annotated[dict, Depends(current_user)],
    from_seg: Annotated[str, Query(alias="from")],
    to_seg: Annotated[str, Query(alias="to")],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """Lista de customers (clientes o dropshippers) para una transicion FROM->TO."""
    require_area(user, ["cs", "marketing"])
    if unit == "unidrop":
        return rfm_flows_svc.rfm_flows_customers_unidrop(from_seg, to_seg, limit=limit)
    return rfm_flows_svc.rfm_flows_customers(from_seg, to_seg, limit=limit)


@router.get("/forecast-batch")
def get_forecast_batch(
    user: Annotated[dict, Depends(current_user)],
    top_n: Annotated[int, Query(ge=10, le=500)] = 100,
) -> dict:
    """Forecast batch: prediccion 30d/60d para top SKUs por demanda.
    Devuelve PO sugerida si stock < forecast. Metodo: velocidad 90d + tendencia."""
    require_area(user, ["ventas", "compras"])
    key = f"forecast-batch:{top_n}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return forecast_svc.forecast_all_skus(top_n=top_n)
    return _b()


@router.get("/cancel-nlp")
def get_cancel_nlp(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Clustering simple de motivos de cancelacion (90d).
    Cruza cancel_reason enum + lexicon manual sobre notas libres."""
    require_area(user, ["cs", "it_data"])
    key = "cancel-nlp-v1"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return cancel_nlp_svc.cancellations_analysis()
    return _b()


@router.get("/dev-nlp")
def get_dev_nlp(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=7, le=365)] = 90,
) -> dict:
    """Clustering de causas de devoluciones (Unidev) usando lexicon manual.
    Analiza devolucion_items_fallas.descripcion (texto libre) y agrupa en
    causas operativas + top SKUs afectados por causa."""
    require_area(user, ["cs", "it_data"])
    key = f"dev-nlp-{period_days}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return dev_nlp_svc.devoluciones_nlp(period_days=period_days)
    return _b()


@router.get("/products/abc")
def get_products_abc(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "90d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """Clasificacion ABC (Pareto 80/15/5) por revenue.
    unit=unistore: TN del retail. unit=unidrop: TN de dropshippers."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.abc_analysis(period, from_iso, to_iso, unit=unit)


@router.get("/products/abc-xyz")
def get_products_abc_xyz(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "90d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Matriz ABC x XYZ (importancia x volatilidad) con accion sugerida por cuadrante."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.abc_xyz_matrix(period, from_iso, to_iso)


@router.get("/products/rotation")
def get_products_rotation(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
) -> dict:
    """Days of Inventory por SKU. Buckets: rapido / normal / lento / muerto."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.inventory_rotation(period=period)


@router.get("/products/stockout-risk")
def get_products_stockout(
    user: Annotated[dict, Depends(current_user)],
    threshold_days: Annotated[int, Query(ge=1, le=180)] = 14,
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
) -> dict:
    """SKUs en riesgo de agotamiento en menos de threshold_days dias."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.stockout_risk(threshold_days, period)


@router.get("/products/cross-sell")
def get_products_cross_sell(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "90d",
    top_n: Annotated[int, Query(ge=5, le=100)] = 30,
) -> dict:
    """Top pares de SKUs comprados juntos (market basket simple)."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.cross_sell_pairs(period=period, top_n=top_n)


@router.get("/products/trends")
def get_products_trends(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=7, le=180)] = 30,
) -> dict:
    """SKUs con growth/decline > 30% comparando periodo actual vs anterior identico."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.product_trends(period_days)


@router.get("/products/returns-rate")
def get_products_returns_rate(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=7, le=365)] = 90,
) -> dict:
    """% de devoluciones por SKU sobre ventas (calidad / expectativa)."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.returns_rate_by_sku(period_days)


@router.get("/products/abc-margen")
def get_products_abc_margen(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "90d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """ABC pero por margen estimado (no solo revenue)."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.abc_margin(period, from_iso, to_iso)


@router.get("/products/lifecycle")
def get_products_lifecycle(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=30, le=730)] = 180,
) -> dict:
    """Lifecycle stage por SKU: nuevo / growth / maduro / declive / dormido."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.product_lifecycle(period_days)


@router.get("/products/price-elasticity")
def get_products_price_elasticity(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=60, le=730)] = 180,
) -> dict:
    """Elasticidad-precio por SKU usando regresion simple."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.price_elasticity(period_days)


@router.get("/products/cannibalization")
def get_products_cannibalization(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=30, le=365)] = 90,
) -> dict:
    """Pares de SKUs donde uno sustituye al otro en mismos clientes."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.cannibalization_pairs(period_days)


@router.get("/products/forecast/{sku}")
def get_products_forecast(
    sku: str,
    user: Annotated[dict, Depends(current_user)],
    days_history: Annotated[int, Query(ge=14, le=365)] = 90,
    days_ahead: Annotated[int, Query(ge=7, le=180)] = 30,
) -> dict:
    """Forecast ventas proximos N dias por SKU (linear regression + exp smoothing)."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.forecast_sku(sku, days_history, days_ahead)


@router.get("/products/stockout-simulator")
def get_products_stockout_sim(
    user: Annotated[dict, Depends(current_user)],
    demand_change_pct: Annotated[float, Query(ge=-100, le=500)] = 0,
    days_to_simulate: Annotated[int, Query(ge=7, le=180)] = 30,
) -> dict:
    """Simula stockouts si la demanda cambia X% en los proximos N dias."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.stockout_simulator(demand_change_pct, days_to_simulate)


@router.get("/products/affinity")
def get_products_affinity(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=30, le=365)] = 90,
    min_support: Annotated[int, Query(ge=2, le=50)] = 5,
    top_n: Annotated[int, Query(ge=10, le=200)] = 50,
) -> dict:
    """Lift + confidence para pares de SKUs (mejor que co-ocurrencia simple)."""
    require_area(user, ["ventas", "compras"])
    return prod_analytics_svc.affinity_score_pairs(period_days, min_support, top_n)


@router.get("/customers-vip")
def get_customers_vip(
    user: Annotated[dict, Depends(current_user)],
    tier: Annotated[Literal["all", "gold", "silver", "bronze"], Query()] = "all",
) -> dict:
    """Lista de clientes Unistore VIP con tier y razon. Drilldown compatible.

    Reglas: cliente VIP si lifetime >= 300k OR orden_max >= 300k OR
    (>=4 ordenes Y ticket promedio >= 75k). Tiers: bronze 300k-1M /
    silver 1M-5M / gold > 5M lifetime."""
    require_area(user, ["cs", "ventas"])
    return vip_svc.list_vip_customers(tier)


@router.get("/customers-vip/overview")
def get_customers_vip_overview(user: Annotated[dict, Depends(current_user)]) -> dict:
    """KPI summary: count + lifetime por tier para cards gerenciales."""
    require_area(user, ["cs", "ventas"])
    return vip_svc.vip_overview()


@router.get("/customers/{customer_id}/vip-status")
def get_customer_vip_status(
    customer_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Status VIP de un customer especifico (para mostrar en perfil 360)."""
    require_area(user, ["cs", "ventas"])
    return vip_svc.get_customer_vip_status(customer_id)


@router.get("/notifications")
def get_notifications(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Notificaciones in-app derivadas de business rules en runtime.
    Sin tabla de notifications - se calculan por request con cache de 60s."""
    cache_key = "notifications-all"
    @cached(_cache, key=lambda: cache_key)
    def _b() -> dict:
        return notif_svc.get_notifications()
    return _b()


@router.get("/envios-meli-unidrop")
def get_envios_meli_unidrop(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Distribucion de ordenes MELI de Unidrop por modo de envio:
    Mercado Envios FULL / ME2 / Cross Docking / Drop Off / Flex / Pickup / Personalizado."""
    require_area(user, ["logistica"])
    return envios_meli_svc.envios_meli_unidrop(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/envios-unistore")
def get_envios_unistore(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Distribucion de ordenes Unistore por canal de envio:
    OCA / Correo Argentino / Unifast / Retiro / Moto / Andreani / Personalizado."""
    require_area(user, ["logistica"])
    return envios_uni_svc.envios_unistore_overview(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/stock-heatmap")
def get_stock_heatmap(
    user: Annotated[dict, Depends(current_user)],
    top_skus: Annotated[int, Query(ge=10, le=100)] = 30,
) -> dict:
    """Heatmap de stock SKU x area de deposito (Digip).
    Identifica concentracion logistica y zonas con bajo surtido."""
    require_area(user, ["logistica", "compras"])
    return stock_svc.stock_heatmap(top_skus=top_skus)


@router.get("/rfm")
def get_rfm(
    user: Annotated[dict, Depends(current_user)],
    period_days: Annotated[int, Query(ge=30, le=730)] = 365,
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """RFM Segmentation - Champions / Loyal / At Risk / etc.
    unit=unistore: clientes finales TN paid (tienda_nube.Customer/Order).
    unit=unidrop:  dropshippers (public.User) por ventas combinadas MELI + TN.
    Devuelve segments + top_by_segment + actions (que hacer con cada segmento)."""
    require_area(user, ["cs", "marketing"])
    if unit == "unidrop":
        result = rfm_svc.rfm_overview_unidrop(period_days=period_days)
    else:
        result = rfm_svc.rfm_overview(period_days=period_days)
    # _customers_by_segment es interno (usado por rfm_segment_customers), no se expone
    return {k: v for k, v in result.items() if not k.startswith("_")}


@router.get("/rfm/segment-customers")
def get_rfm_segment_customers(
    user: Annotated[dict, Depends(current_user)],
    segment: Annotated[str, Query()],
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
    period_days: Annotated[int, Query(ge=30, le=730)] = 365,
) -> dict:
    """Lista COMPLETA de clientes en un segmento RFM con email/contacto.
    Usado por modal RFM para exportar CSV / generar accion CS."""
    require_area(user, ["cs", "marketing"])
    return rfm_svc.rfm_segment_customers(segment, unit=unit, period_days=period_days)


@router.get("/cohorts")
def get_cohorts(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """Cohortes - clasifica clientes (Unistore) o dropshippers (Unidrop) por
    estado de actividad: Nuevo / Segunda / Conv. a Recurrente / Recurrente /
    Recuperado / Posible churn / Perdidos.

    'Posible churn' (clientes recurrentes que excedieron 1.5x su gap promedio
    o 60d) y 'Perdidos' (>365d sin compras) son alertas accionables.
    """
    require_area(user, ["cs", "ventas"])
    return cohorts_svc.cohorts_overview(period, from_iso, to_iso, unit=unit)


@router.get("/cohorts/customers")
def get_cohort_customers(
    user: Annotated[dict, Depends(current_user)],
    state: Annotated[str, Query()],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    """Drill: lista de clientes/dropshippers en el estado dado para abrir en modal."""
    require_area(user, ["cs", "ventas"])
    return cohorts_svc.cohort_customers(state, period, from_iso, to_iso, unit=unit)


@router.get("/lotes")
def get_lotes(
    user: Annotated[dict, Depends(current_user)],
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
    require_area(user, ["compras", "finanzas"])
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
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Detalle del lote: KPIs + items con su estado de consumo + atribucion de ventas."""
    require_area(user, ["compras", "finanzas"])
    detail = lotes_svc.lote_detail(lote_id)
    if not detail:
        from fastapi import HTTPException
        raise HTTPException(404, f"Lote {lote_id} no encontrado")
    return detail


@router.get("/today")
def get_today(
    user: Annotated[dict, Depends(current_user)],
    unit: Annotated[Literal["unistore", "unidrop", "all"], Query()] = "all",
    context: Annotated[Literal["default", "cs", "productos", "logistica"], Query()] = "default",
) -> dict:
    """Comparador HOY. Si unit=unistore o unidrop, muestra solo bloques de esa unidad.
    Default 'all' = vista cross-unidad (Gerencial).

    context: cambia los bloques segun la pagina origen:
    - 'default': GMV, ordenes, ticket promedio, devoluciones (vista ventas/gerencial)
    - 'cs': customers nuevos, recurrentes, cancelaciones, refunds (Customer Success)
    """
    cache_key = f"today-snap-{unit}-{context}"
    @cached(_cache, key=lambda: cache_key)
    def _b() -> dict:
        scope = None if unit == "all" else unit
        ctx = None if context == "default" else context
        return today_svc.today_snapshot(unit=scope, context=ctx)
    return _b()


@router.get("/products")
def get_products(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["ventas", "compras"])
    key = f"prod:{period}:{channel}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.products_overview(period, channel, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/products/sku/{sku}")
def get_product_detail(
    sku: str,
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Product 360 con periodo filtrable (afecta solo la seccion
    recent_orders; el resto de KPIs son lifetime)."""
    require_area(user, ["ventas", "compras"])
    key = f"prod-sku:{sku}:{period}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.product_detail(sku, period=period, from_iso=from_iso, to_iso=to_iso)
    return _b()


@router.get("/customers/{customer_id}")
def get_customer_detail(
    customer_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "ventas"])
    key = f"cust:{customer_id}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.customer_detail(customer_id)
    return _b()


@router.get("/customers/{customer_id}/journey")
def get_customer_journey(
    customer_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Timeline + cadencia personal con promedio ponderado.
    Para el sidebar storytelling de la vista 360."""
    require_area(user, ["cs", "ventas"])
    key = f"cust-journey:{customer_id}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return products_svc.customer_journey(customer_id)
    return _b()


@router.get("/envios/unidrop")
def get_envios(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    courier: Annotated[Literal["all", "oca", "lightdata"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    require_area(user, ["logistica"])
    key = f"env:{period}:{courier}:{from_iso}:{to_iso}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return envios_svc.envios_unidrop(period, courier, from_iso=from_iso, to_iso=to_iso)
    return _b()
