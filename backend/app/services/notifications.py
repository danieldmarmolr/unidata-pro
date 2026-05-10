"""
Notificaciones in-app del usuario en el header bell.

Las notificaciones son derivadas en runtime de business rules sobre datos
en vivo. NO se persisten en una tabla — se calculan por request (con cache
corto). Esto las mantiene siempre frescas sin overhead de "marcar como leida".

Reglas:
1. Suscripciones MELI por vencer (<7d) — Unidrop
2. Tokens MELI con requiresReauth=true — Unidrop
3. Pedidos atascados (paid sin fulfillment > 5d) — Unistore
4. Cancelaciones del dia > 5 — Unistore
5. Devoluciones abiertas — Unidev
6. Customers con deuda Talo > umbral — Unidrop
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import scalar

log = logging.getLogger("unidata.notifications")


def _safe(fn):
    """Wrap calls que pueden fallar (engine offline, schema mismatch).
    Devuelve 0 si algo se rompe."""
    try:
        return fn()
    except Exception as e:
        log.debug("notification rule fail: %s", e)
        return 0


def get_notifications() -> dict:
    """Devuelve la lista de notificaciones activas + count."""
    items: list[dict] = []

    try:
        uni = get_engine("unistore")
    except Exception:
        uni = None
    try:
        drop = get_engine("unidrop")
    except Exception:
        drop = None

    # 1. Suscripciones MELI por vencer (proximos 7 dias) - Unidrop
    if drop:
        n = _safe(lambda: int(scalar(drop, """
            SELECT COUNT(*) FROM public."User"
            WHERE end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '7 days'
              AND COALESCE("isActive", TRUE) = TRUE
        """) or 0))
        if n > 0:
            items.append({
                "id": "subs_to_expire",
                "severity": "warning",
                "icon": "calendar",
                "title": f"{n} suscripciones por vencer",
                "body": f"{n} dropshippers tienen su plan MELI por vencer en los proximos 7 dias",
                "href": "/dashboard/dropshippers?riesgo=token_expira",
                "drill": {
                    "endpoint": "/api/drilldowns/saas/users-expiring?days=7",
                    "title": "Suscripciones por vencer (7d)",
                    "filename": "subs_vencer_7d.csv",
                },
                "count": n,
            })

    # 2. Tokens MELI con re-auth requerido - Unidrop
    if drop:
        n = _safe(lambda: int(scalar(drop, """
            SELECT COUNT(*) FROM mercado_libre_dev."MercadoLibreUserAccount"
            WHERE "requiresReauth" = TRUE
        """) or 0))
        if n > 0:
            items.append({
                "id": "meli_reauth",
                "severity": "error",
                "icon": "alert",
                "title": f"{n} cuentas MELI requieren reconectar",
                "body": "Estas cuentas no pueden recibir nuevas ordenes hasta que el dropshipper renueve el token",
                "href": "/dashboard/dropshippers?riesgo=token_expira",
                "count": n,
            })

    # 3. Pedidos atascados Unistore (paid sin fulfillment > 5d)
    if uni:
        n = _safe(lambda: int(scalar(uni, """
            SELECT COUNT(*) FROM tienda_nube."Order" o
            WHERE o."paymentStatus" = 'paid'
              AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
              AND o."createdAt" < NOW() - INTERVAL '5 days'
        """) or 0))
        if n > 0:
            items.append({
                "id": "stuck_orders",
                "severity": "warning",
                "icon": "alert",
                "title": f"{n} pedidos atascados",
                "body": "Pedidos Unistore pagados sin fulfillment hace mas de 5 dias",
                "href": "/dashboard/logistica",
                "drill": {
                    "endpoint": "/api/drilldowns/orders/stuck",
                    "title": "Pedidos atascados (>5d)",
                    "filename": "stuck.csv",
                },
                "count": n,
            })

    # 4. Cancelaciones del dia anormales (> 5)
    if uni:
        n = _safe(lambda: int(scalar(uni, """
            SELECT COUNT(*) FROM tienda_nube."Order"
            WHERE "status" = 'cancelled'
              AND COALESCE("cancelledAt", "createdAt")::date = CURRENT_DATE
        """) or 0))
        if n > 5:
            items.append({
                "id": "cancellations_today",
                "severity": "warning",
                "icon": "x",
                "title": f"{n} cancelaciones hoy",
                "body": "Por encima del umbral diario (>5) - revisar motivos",
                "href": "/dashboard/cs",
                "drill": {
                    "endpoint": "/api/drilldowns/orders/cancelled?period=today",
                    "title": "Cancelaciones de hoy",
                    "filename": "cancelled_today.csv",
                },
                "count": n,
            })

    # 5. Devoluciones abiertas
    if uni:
        n = _safe(lambda: int(scalar(uni, """
            SELECT COUNT(*) FROM unidev.devoluciones
            WHERE estado_general IN ('abierta','pendiente','en_revision')
        """) or 0))
        if n > 0:
            items.append({
                "id": "open_returns",
                "severity": "info",
                "icon": "rotate",
                "title": f"{n} devoluciones abiertas",
                "body": "Casos pendientes de resolucion",
                "href": "/dashboard/devoluciones",
                "count": n,
            })

    # 6. VIP Gold inactivos > 60 dias (Unistore)
    if uni:
        n = _safe(lambda: int(scalar(uni, """
            SELECT COUNT(*) FROM (
                SELECT c.id,
                       SUM(o.total)::float AS lifetime,
                       EXTRACT(DAY FROM (NOW() - MAX(o."createdAt")))::int AS recency
                FROM tienda_nube."Customer" c
                INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
                WHERE o."paymentStatus" = 'paid'
                GROUP BY c.id
                HAVING SUM(o.total) >= 5000000
                  AND EXTRACT(DAY FROM (NOW() - MAX(o."createdAt"))) > 60
            ) x
        """) or 0))
        if n > 0:
            items.append({
                "id": "vip_gold_inactive",
                "severity": "error",
                "icon": "alert",
                "title": f"{n} VIP Gold inactivos >60d",
                "body": "Clientes top tier sin comprar hace mas de 60 dias - retencion critica",
                "href": "/dashboard/cs",
                "drill": {
                    "endpoint": "/api/dashboards/customers-vip?tier=gold",
                    "title": "VIP Gold (revisar inactivos)",
                    "filename": "vip_gold_inactivos.csv",
                },
                "count": n,
            })

    # 7. VIPs Silver+ inactivos > 90 dias
    if uni:
        n = _safe(lambda: int(scalar(uni, """
            SELECT COUNT(*) FROM (
                SELECT c.id,
                       SUM(o.total)::float AS lifetime,
                       EXTRACT(DAY FROM (NOW() - MAX(o."createdAt")))::int AS recency
                FROM tienda_nube."Customer" c
                INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
                WHERE o."paymentStatus" = 'paid'
                GROUP BY c.id
                HAVING SUM(o.total) >= 1000000 AND SUM(o.total) < 5000000
                  AND EXTRACT(DAY FROM (NOW() - MAX(o."createdAt"))) > 90
            ) x
        """) or 0))
        if n > 0:
            items.append({
                "id": "vip_silver_inactive",
                "severity": "warning",
                "icon": "alert",
                "title": f"{n} VIP Silver inactivos >90d",
                "body": "Clientes premium sin comprar hace mas de 90 dias",
                "href": "/dashboard/cs",
                "drill": {
                    "endpoint": "/api/dashboards/customers-vip?tier=silver",
                    "title": "VIP Silver (revisar inactivos)",
                    "filename": "vip_silver_inactivos.csv",
                },
                "count": n,
            })

    # 8. Dropshippers con deuda Talo activa
    if drop:
        n = _safe(lambda: int(scalar(drop, """
            SELECT COUNT(DISTINCT cpa."userId")
            FROM public."PaymentIntent" pi
            INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
            WHERE pi."status" <> 'PROCESSED'
              AND COALESCE(pi."pendingAmount", 0) > 0
        """) or 0))
        if n > 0:
            items.append({
                "id": "talo_debt",
                "severity": "info",
                "icon": "wallet",
                "title": f"{n} dropshippers con deuda Talo",
                "body": "Pagos pendientes que requieren cobranza",
                "href": "/dashboard/dropshippers?riesgo=con_deuda",
                "count": n,
            })

    # Ordenar por severidad: error > warning > info
    severity_order = {"error": 0, "warning": 1, "info": 2}
    items.sort(key=lambda x: severity_order.get(x.get("severity", "info"), 9))

    return {
        "items": items,
        "total": len(items),
        "errors": sum(1 for i in items if i.get("severity") == "error"),
        "warnings": sum(1 for i in items if i.get("severity") == "warning"),
        "infos": sum(1 for i in items if i.get("severity") == "info"),
        "generated_at": now_ar().isoformat(),
    }
