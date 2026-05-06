"""
Logica de queries para los dashboards.
Cada funcion es resiliente: si una sub-query falla devuelve None y se loggea,
pero no rompe el dashboard completo.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from sqlalchemy.engine import Engine

from app.db.engines import get_engine
from app.services._utils import q as _q, scalar as _scalar

log = logging.getLogger("unidata.dashboards")


# =========================================================
#                  EXECUTIVE OVERVIEW
# =========================================================

def executive_overview() -> dict:
    """
    Construye el dashboard gerencial cross-unidad.
    Devuelve dict listo para serializar como ExecutiveOverview.
    """
    uni = get_engine("unistore")
    drop = get_engine("unidrop")

    # ---------- Cards ----------
    cards: list[dict] = []

    # Card 1: GMV Unistore mes actual (TN + ML, solo orders pagadas)
    gmv_uni_tn = _scalar(uni, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= date_trunc('month', NOW())
    """) or 0
    gmv_uni_ml = _scalar(uni, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= date_trunc('month', NOW())
          AND status IN ('paid','confirmed','shipped','delivered')
    """) or 0
    gmv_uni = float(gmv_uni_tn) + float(gmv_uni_ml)

    # vs mes anterior - mismo dia del mes
    gmv_uni_tn_prev = _scalar(uni, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND "createdAt" <  date_trunc('month', NOW())
          AND EXTRACT(DAY FROM "createdAt") <= EXTRACT(DAY FROM NOW())
    """) or 0
    gmv_uni_ml_prev = _scalar(uni, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= date_trunc('month', NOW() - INTERVAL '1 month')
          AND date_created <  date_trunc('month', NOW())
          AND EXTRACT(DAY FROM date_created) <= EXTRACT(DAY FROM NOW())
          AND status IN ('paid','confirmed','shipped','delivered')
    """) or 0
    gmv_uni_prev = float(gmv_uni_tn_prev) + float(gmv_uni_ml_prev)
    delta_gmv = ((gmv_uni - gmv_uni_prev) / gmv_uni_prev * 100) if gmv_uni_prev > 0 else None

    cards.append({
        "label": "GMV Unistore (mes en curso)",
        "value": round(gmv_uni, 0),
        "prefix": "$ ",
        "suffix": "",
        "delta": round(delta_gmv, 1) if delta_gmv is not None else None,
        "hint": f"TN: {gmv_uni_tn:,.0f}  /  ML: {gmv_uni_ml:,.0f}",
    })

    # Card 2: Ordenes Unistore mes actual
    orders_uni = _scalar(uni, """
        SELECT (
            (SELECT COUNT(*) FROM tienda_nube."Order"
              WHERE "createdAt" >= date_trunc('month', NOW())) +
            (SELECT COUNT(*) FROM meli.meli_orders
              WHERE date_created >= date_trunc('month', NOW()))
        )
    """) or 0
    cards.append({
        "label": "Ordenes Unistore (mes)",
        "value": int(orders_uni),
        "hint": "TN + Mercado Libre",
    })

    # Card 3: Tiendas TN conectadas en Unidrop
    stores_drop = _scalar(drop, """
        SELECT COUNT(*) FROM public."TiendaNubeCredential"
        WHERE COALESCE("isActive", true) IS TRUE
    """) or _scalar(drop, """
        SELECT COUNT(*) FROM public."TiendaNubeCredential"
    """) or 0
    cards.append({
        "label": "Tiendas conectadas (Unidrop)",
        "value": int(stores_drop),
        "hint": "TiendaNube credenciales activas",
    })

    # Card 4: Usuarios Unidrop con suscripcion vigente
    subs_drop = _scalar(drop, """
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription IS NOT NULL
          AND end_date_subscription > NOW()
    """) or 0
    total_users_drop = _scalar(drop, 'SELECT COUNT(*) FROM public."User"') or 0
    cards.append({
        "label": "Suscripciones activas (Unidrop)",
        "value": int(subs_drop),
        "hint": f"sobre {int(total_users_drop):,} usuarios totales",
    })

    # Card 5: Volumen procesado por Talo (Unidrop, mes en curso)
    talo_amount = _scalar(drop, """
        SELECT COALESCE(SUM(amount), 0) FROM public."PaymentTransaction"
        WHERE "createdAt" >= date_trunc('month', NOW())
          AND status IN ('completed','succeeded','approved','paid')
    """)
    if talo_amount is None:
        talo_amount = _scalar(drop, """
            SELECT COALESCE(SUM(amount), 0) FROM public."PaymentTransaction"
            WHERE "createdAt" >= date_trunc('month', NOW())
        """) or 0
    cards.append({
        "label": "Volumen pagos Talo (mes)",
        "value": round(float(talo_amount), 0),
        "prefix": "$ ",
        "hint": "PaymentTransaction Unidrop",
    })

    # ---------- Series temporales: 12 meses ----------
    revenue_series: list[dict] = []

    tn_series = _q(uni, """
        SELECT date_trunc('month', "createdAt")::date AS mes,
               SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END)::float AS gmv
        FROM tienda_nube."Order"
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    revenue_series.append({
        "label": "Unistore - Tienda Nube",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in tn_series],
    })

    ml_series = _q(uni, """
        SELECT date_trunc('month', date_created)::date AS mes,
               SUM(COALESCE(total_amount,0))::float AS gmv
        FROM meli.meli_orders
        WHERE date_created >= date_trunc('month', NOW() - INTERVAL '11 months')
          AND status IN ('paid','confirmed','shipped','delivered')
        GROUP BY 1 ORDER BY 1
    """) or []
    revenue_series.append({
        "label": "Unistore - Mercado Libre",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in ml_series],
    })

    drop_orders_series = _q(drop, """
        SELECT date_trunc('month', "createdAt")::date AS mes,
               COUNT(*)::float AS orders
        FROM public.tienda_nube_orders
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """)
    if drop_orders_series is None:
        # fallback: contar por la tabla webhook
        drop_orders_series = _q(drop, """
            SELECT date_trunc('month', "createdAt")::date AS mes,
                   COUNT(*)::float AS orders
            FROM mercado_libre_dev."WebhookOrder"
            WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
            GROUP BY 1 ORDER BY 1
        """) or []
    revenue_series.append({
        "label": "Unidrop - Ordenes procesadas",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in drop_orders_series],
    })

    # ---------- Salud de integraciones ----------
    integrations: list[dict] = []
    today = dt.datetime.now(dt.timezone.utc)

    def _health(unit_label: str, name: str, last_ts) -> dict:
        if not last_ts:
            return {"name": name, "unit": unit_label, "last_event_at": None, "days_since_last": None, "status": "error"}
        if isinstance(last_ts, dt.datetime):
            ts = last_ts
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=dt.timezone.utc)
            days = (today - ts).days
        else:
            days = None
            ts = None
        if days is None:
            status = "error"
        elif days <= 1:
            status = "ok"
        elif days <= 3:
            status = "warn"
        else:
            status = "error"
        return {
            "name": name,
            "unit": unit_label,
            "last_event_at": ts.isoformat() if ts else None,
            "days_since_last": days,
            "status": status,
        }

    integrations.append(_health("unistore", "Tienda Nube (orders)",
        _scalar(uni, 'SELECT MAX("createdAt") FROM tienda_nube."Order"')))
    integrations.append(_health("unistore", "Mercado Libre (orders)",
        _scalar(uni, "SELECT MAX(date_created) FROM meli.meli_orders")))
    integrations.append(_health("unistore", "Digip (pedidos)",
        _scalar(uni, 'SELECT MAX("createdAt") FROM digip."Pedido"')))
    integrations.append(_health("unistore", "Contabilium (sales orders)",
        _scalar(uni, 'SELECT MAX("createdAt") FROM contabilium."SalesOrder"')))
    integrations.append(_health("unidrop", "Mercado Libre webhooks",
        _scalar(drop, 'SELECT MAX("createdAt") FROM mercado_libre_dev."WebhookOrder"')))
    integrations.append(_health("unidrop", "Pagos Talo",
        _scalar(drop, 'SELECT MAX("createdAt") FROM public."PaymentTransaction"')))
    integrations.append(_health("unidrop", "Usuarios nuevos",
        _scalar(drop, 'SELECT MAX("createdAt") FROM public."User"')))

    # ---------- Alertas ----------
    alerts: list[str] = []

    # Pedidos Unistore con paymentStatus paid pero sin Fulfillment hace > 5 dias
    stuck = _scalar(uni, """
        SELECT COUNT(*)
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."shippingStatus" IS DISTINCT FROM 'fulfilled'
          AND o."createdAt" < NOW() - INTERVAL '5 days'
    """)
    if stuck and int(stuck) > 0:
        alerts.append(f"{int(stuck)} pedidos Unistore pagados sin fulfillment hace mas de 5 dias")

    # Suscripciones Unidrop a vencer en proximos 7 dias
    expiring = _scalar(drop, """
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    """)
    if expiring and int(expiring) > 0:
        alerts.append(f"{int(expiring)} suscripciones Unidrop vencen en los proximos 7 dias")

    # Publicaciones ML con error de stock o precio
    pub_errors = _scalar(drop, """
        SELECT COUNT(*) FROM mercado_libre_dev."PublicationUserMercadoLibre"
        WHERE "priceUpdateError" IS NOT NULL OR ("missingSkus" IS NOT NULL AND CAST("missingSkus" AS text) <> '[]' AND CAST("missingSkus" AS text) <> '')
    """)
    if pub_errors and int(pub_errors) > 0:
        alerts.append(f"{int(pub_errors)} publicaciones ML de Unidrop con error de stock/precio")

    # Integraciones con > 3 dias de retraso
    laggy = [i for i in integrations if i["status"] == "error"]
    for it in laggy:
        if it["days_since_last"] is not None:
            alerts.append(f"Integracion '{it['name']}' ({it['unit']}) sin datos hace {it['days_since_last']} dias")
        else:
            alerts.append(f"Integracion '{it['name']}' ({it['unit']}) sin lectura disponible")

    if not alerts:
        alerts.append("Sin alertas activas. Todo viene corriendo en orden.")

    return {
        "cards": cards,
        "revenue_by_channel": revenue_series,
        "integration_health": integrations,
        "top_alerts": alerts[:8],
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
