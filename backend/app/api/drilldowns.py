"""Endpoints de drill-down — devuelven detalle al hacer click en KPIs/celdas."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.services import drilldowns as svc

router = APIRouter(prefix="/api/drilldowns", tags=["drilldowns"])


@router.get("/products/{product_id}/orders")
def product_orders(
    product_id: str,
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
) -> dict:
    return svc.orders_by_product("unistore", product_id, period)


@router.get("/provinces/{province}/orders")
def province_orders(
    province: str,
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.orders_by_province("unistore", province, period, from_iso=from_iso, to_iso=to_iso)


@router.get("/customers/{customer_id}/orders")
def customer_orders(
    customer_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    return svc.orders_by_customer_unistore(customer_id)


@router.get("/payment-accounts/{account_id}/transactions")
def account_transactions(
    account_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    return svc.transactions_by_account(account_id)


@router.get("/orders/{order_id}/items")
def order_items(
    order_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    return svc.stuck_order_detail(order_id)


@router.get("/orders/{order_id}/detail")
def order_full_detail(
    order_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    return svc.order_detail_full(order_id)


# ===== SaaS / Unidrop user lists =====
_SEG_LITERAL = Literal["all", "b2b", "b2c"]


@router.get("/saas/users-all")
def drill_users_all(
    _: Annotated[dict, Depends(current_user)],
    segment: Annotated[_SEG_LITERAL, Query()] = "all",
) -> dict:
    return svc.saas_users_all(segment)


@router.get("/saas/users-active")
def drill_users_active(
    _: Annotated[dict, Depends(current_user)],
    segment: Annotated[_SEG_LITERAL, Query()] = "all",
) -> dict:
    return svc.saas_users_active(segment)


@router.get("/saas/users-new")
def drill_users_new(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    segment: Annotated[_SEG_LITERAL, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.saas_users_new(period, segment, from_iso=from_iso, to_iso=to_iso)


@router.get("/saas/users-churned")
def drill_users_churned(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    segment: Annotated[_SEG_LITERAL, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.saas_users_churned(period, segment, from_iso=from_iso, to_iso=to_iso)


@router.get("/saas/users-expiring")
def drill_users_expiring(
    _: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query()] = 7,
    segment: Annotated[_SEG_LITERAL, Query()] = "all",
) -> dict:
    return svc.saas_users_expiring(days, segment)


@router.get("/saas/tn-credentials")
def drill_tn_credentials(_: Annotated[dict, Depends(current_user)]) -> dict:
    return svc.tn_credentials_active()


# ===== Generic period drills =====
_PERIOD_LITERAL = Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"]


@router.get("/orders/paid")
def drill_orders_paid(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.tn_orders_paid(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/orders/all")
def drill_orders_all(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.tn_orders_all(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/orders/cancelled")
def drill_orders_cancelled(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.tn_orders_cancelled(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/orders/stuck")
def drill_orders_stuck(_: Annotated[dict, Depends(current_user)]) -> dict:
    return svc.tn_orders_stuck()


# ============================================
# UNIDROP drilldowns (NO mezclar con Unistore)
# ============================================

@router.get("/unidrop/orders-tn")
def drill_unidrop_orders_tn(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Ordenes TN de dropshippers Unidrop pagadas en periodo."""
    return svc.unidrop_orders_tn_paid(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/unidrop/orders-ml")
def drill_unidrop_orders_ml(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """Ordenes ML de dropshippers Unidrop pagadas en periodo."""
    return svc.unidrop_orders_ml_paid(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/unidrop/dropshippers-active-today")
def drill_dropshippers_active_today(_: Annotated[dict, Depends(current_user)]) -> dict:
    """Dropshippers con ventas hoy (TN o MELI Unidrop), ordenados por GMV desc."""
    return svc.unidrop_dropshippers_active_today()


@router.get("/unidrop/intents-processed")
def drill_unidrop_intents(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    """PaymentIntent PROCESSED del periodo: lo facturado a Unidrop via Talo."""
    return svc.unidrop_intents_processed(period, from_iso=from_iso, to_iso=to_iso)


@router.get("/products/published")
def drill_products_published(_: Annotated[dict, Depends(current_user)]) -> dict:
    return svc.tn_products_published()


@router.get("/products/no-movement")
def drill_no_movement(
    _: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query()] = 90,
) -> dict:
    return svc.tn_skus_no_movement(days)


@router.get("/products/stock-critico")
def drill_stock_critico(_: Annotated[dict, Depends(current_user)]) -> dict:
    return svc.tn_stock_critico()


@router.get("/talo/transactions")
def drill_talo(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    status: Annotated[str | None, Query()] = None,
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.talo_transactions(period, status=status, from_iso=from_iso, to_iso=to_iso)


@router.get("/subs-meli/active")
def drill_subs_meli(
    _: Annotated[dict, Depends(current_user)],
    plan: Annotated[str | None, Query()] = None,
) -> dict:
    return svc.subs_meli_active(plan)


@router.get("/subs-meli/intents")
def drill_subs_meli_intents(
    _: Annotated[dict, Depends(current_user)],
    plan: Annotated[str, Query()] = "all",
    status: Annotated[str, Query()] = "all",
) -> dict:
    from app.services import crm as crm_svc
    return crm_svc.subs_intents_by_plan_status(plan, status)


@router.get("/crm/subscribers")
def drill_crm_subscribers(
    _: Annotated[dict, Depends(current_user)],
    filter_status: Annotated[str, Query(alias="status")] = "all",
    plan: Annotated[str, Query()] = "all",
    riesgo: Annotated[str, Query()] = "all",
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(le=2000)] = 1000,
) -> dict:
    from app.services import crm as crm_svc
    return crm_svc.crm_subscribers(filter_status, plan, riesgo, search, limit)


@router.get("/devoluciones/list")
def drill_devoluciones(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[_PERIOD_LITERAL, Query()] = "30d",
    modelo: Annotated[str, Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> dict:
    return svc.devoluciones_list(period, modelo, from_iso=from_iso, to_iso=to_iso)


# ===== Customer Success drilldowns =====

@router.get("/cs/customers-by-status")
def drill_cs_customers_by_status(
    _: Annotated[dict, Depends(current_user)],
    status: Annotated[str, Query()],
) -> dict:
    """Lista de customers Unistore en un estado de ciclo de vida dado.
    Valido: Nuevo / 2da compra / Convertido a Recurrente / Recurrente / Recuperado."""
    return svc.cs_customers_by_status(status)


@router.get("/cs/customers-by-rfm")
def drill_cs_customers_by_rfm(
    _: Annotated[dict, Depends(current_user)],
    segment: Annotated[str, Query()],
) -> dict:
    """Lista de customers Unistore en un segmento RFM dado.
    Valido: Champions / Fieles / Nuevos potenciales / En riesgo / Perdidos / Standard."""
    return svc.cs_customers_by_rfm(segment)
