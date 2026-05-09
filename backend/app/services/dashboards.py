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
from app.services._utils import q as _q, scalar as _scalar, resolve_window

log = logging.getLogger("unidata.dashboards")


# =========================================================
#                  EXECUTIVE OVERVIEW
# =========================================================

def executive_overview(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """
    Construye el dashboard gerencial cross-unidad usando la ventana del filtro.
    """
    uni = get_engine("unistore")
    drop = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    win_params = {"from_ts": win["from_ts"], "to_ts": win["to_ts"], "days": win["days"]}
    period_label = period.upper() if period in ("today", "yesterday") else period

    # ---------- Cards ----------
    cards: list[dict] = []

    # Card 1: GMV Unistore mes actual (TN + ML, solo orders pagadas)
    gmv_uni_tn = _scalar(uni, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
    """, win_params) or 0
    gmv_uni_ml = _scalar(uni, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= :from_ts AND date_created < :to_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, win_params) or 0
    gmv_uni = float(gmv_uni_tn) + float(gmv_uni_ml)

    # vs mes anterior - mismo dia del mes
    gmv_uni_tn_prev = _scalar(uni, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= (:from_ts - make_interval(days => :days))
              AND "createdAt" <  :from_ts
    """, win_params) or 0
    gmv_uni_ml_prev = _scalar(uni, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= (:from_ts - make_interval(days => :days))
              AND date_created <  :from_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, win_params) or 0
    gmv_uni_prev = float(gmv_uni_tn_prev) + float(gmv_uni_ml_prev)
    delta_gmv = ((gmv_uni - gmv_uni_prev) / gmv_uni_prev * 100) if gmv_uni_prev > 0 else None

    cards.append({
        "label": f"GMV Unistore ({period_label})",
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
              WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts) +
            (SELECT COUNT(*) FROM meli.meli_orders
              WHERE date_created >= :from_ts AND date_created < :to_ts)
        )
    """, win_params) or 0
    cards.append({
        "label": f"Ordenes Unistore ({period_label})",
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
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
          AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
    """, win_params)
    if talo_amount is None:
        talo_amount = _scalar(drop, """
            SELECT COALESCE(SUM(amount), 0) FROM public."PaymentTransaction"
            WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
        """, win_params) or 0
    cards.append({
        "label": f"Volumen pagos Talo ({period_label})",
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

    # Pedidos Unistore con paymentStatus paid hace > 5 dias y aun en estado abierto
    stuck = _scalar(uni, """
        SELECT COUNT(*)
        FROM tienda_nube."Order" o
        WHERE o."paymentStatus" = 'paid'
          AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
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

    # =====================================================
    # EXTENDED STRATEGIC VIEW
    # =====================================================
    # ---------- Cards adicionales ----------

    # AOV mes Unistore
    aov_uni = _scalar(uni, """
        SELECT COALESCE(AVG(NULLIF(total,0)), 0)::float
        FROM tienda_nube."Order"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
          AND "paymentStatus" = 'paid'
    """, win_params) or 0
    cards.append({
        "label": "AOV Unistore (mes)",
        "value": round(float(aov_uni), 0),
        "prefix": "$ ",
        "hint": "Ticket promedio TN paid",
    })

    # % cancel Unistore mes
    cancel_pct = _scalar(uni, """
        SELECT CASE WHEN COUNT(*)=0 THEN 0
               ELSE 100.0 * COUNT(*) FILTER (WHERE status='cancelled') / COUNT(*) END
        FROM tienda_nube."Order"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
    """, win_params) or 0
    cards.append({
        "label": "% cancelaciones (mes)",
        "value": round(float(cancel_pct), 1),
        "suffix": "%",
        "hint": "Sobre todas las orders TN del mes",
    })

    # MRR Unidrop estimado (subs activas * 25k aprox por defecto)
    # mejor: cobros confirmados de PaymentTransactionSubscription mes
    mrr_drop = _scalar(drop, """
        SELECT COALESCE(SUM(amount),0)::float FROM mercado_libre_dev."PaymentTransactionSubscription"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
          AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
    """, win_params) or 0
    cards.append({
        "label": "MRR Unidrop (mes)",
        "value": round(float(mrr_drop), 0),
        "prefix": "$ ",
        "hint": "Cobros de suscripciones MELI",
    })

    # Devoluciones mes (Unidev)
    dev_count = 0
    dev_amount = 0.0
    try:
        dev_eng = get_engine("unidev")
        dev_count = int(_scalar(dev_eng, """
            SELECT COUNT(*) FROM public.devoluciones
            WHERE fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
        """, win_params) or 0)
        dev_amount = float(_scalar(dev_eng, """
            SELECT COALESCE(SUM(di.cantidad_solicitada * di.monto_unitario), 0)::float
            FROM public.devoluciones d
            JOIN public.devolucion_items di ON di.devolucion_id = d.devolucion_id
            WHERE d.fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
        """, win_params) or 0)
    except Exception as e:
        log.warning("dev metrics fail: %s", e)

    cards.append({
        "label": "Devoluciones (mes)",
        "value": dev_count,
        "hint": f"$ {dev_amount:,.0f} en monto" if dev_amount else "",
    })

    # ---------- Revenue mix (todas las fuentes) ----------
    revenue_mix = [
        {"category": "TN orders (Unistore)", "value": round(float(gmv_uni_tn), 0)},
        {"category": "ML orders (Unistore)", "value": round(float(gmv_uni_ml), 0)},
        {"category": "Talo pagos (Unidrop)", "value": round(float(talo_amount or 0), 0)},
        {"category": "Subs MELI (Unidrop)", "value": round(float(mrr_drop), 0)},
    ]

    # ---------- Health por unidad ----------
    unit_health: list[dict] = []

    # Unistore
    uni_orders_prev = _scalar(uni, """
        SELECT (
            (SELECT COUNT(*) FROM tienda_nube."Order"
             WHERE "createdAt" >= (:from_ts - make_interval(days => :days))
              AND "createdAt" <  :from_ts) +
            (SELECT COUNT(*) FROM meli.meli_orders
             WHERE date_created >= (:from_ts - make_interval(days => :days))
              AND date_created <  :from_ts)
        )
    """, win_params) or 0
    unit_health.append({
        "unit": "unistore",
        "label": "Unistore",
        "color": "#7a3eae",
        "metrics": [
            {"label": "GMV mes", "value": round(gmv_uni, 0), "prefix": "$ ", "delta": round(delta_gmv, 1) if delta_gmv is not None else None},
            {"label": "Orders mes", "value": int(orders_uni), "delta": round((int(orders_uni)-int(uni_orders_prev))/int(uni_orders_prev)*100,1) if int(uni_orders_prev)>0 else None},
            {"label": "AOV", "value": round(float(aov_uni), 0), "prefix": "$ "},
            {"label": "% cancel", "value": round(float(cancel_pct), 1), "suffix": "%"},
        ],
    })

    # Unidrop
    new_users_drop = _scalar(drop, """
        SELECT COUNT(*) FROM public."User"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
    """, win_params) or 0
    expiring_soon = _scalar(drop, """
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '15 days'
    """) or 0
    unit_health.append({
        "unit": "unidrop",
        "label": "Unidrop",
        "color": "#a259ff",
        "metrics": [
            {"label": "Suscripciones activas", "value": int(subs_drop)},
            {"label": "MRR mes", "value": round(float(mrr_drop), 0), "prefix": "$ "},
            {"label": "Usuarios nuevos mes", "value": int(new_users_drop)},
            {"label": "Vencen <15d", "value": int(expiring_soon)},
        ],
    })

    # Unidev
    dev_open = 0
    dev_resolved = 0
    try:
        dev_eng = get_engine("unidev")
        dev_open = int(_scalar(dev_eng, """
            SELECT COUNT(*) FROM public.devoluciones
            WHERE estado_general NOT IN ('resuelto','cerrado','cancelado','aprobada')
        """) or 0)
        dev_resolved = int(_scalar(dev_eng, """
            SELECT COUNT(*) FROM public.devoluciones
            WHERE estado_general IN ('resuelto','cerrado','aprobada')
              AND fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
        """, win_params) or 0)
    except Exception:
        pass
    unit_health.append({
        "unit": "unidev",
        "label": "Unidev (Devoluciones)",
        "color": "#ec4899",
        "metrics": [
            {"label": "Devoluciones mes", "value": dev_count},
            {"label": "Monto mes", "value": round(dev_amount, 0), "prefix": "$ "},
            {"label": "Abiertas", "value": dev_open},
            {"label": "Resueltas mes", "value": dev_resolved},
        ],
    })

    # ---------- Top productos cross-canal (TN + ML) ----------
    top_cross_rows = _q(uni, """
        WITH tn_p AS (
            SELECT oi.sku,
                   MAX(oi.name) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '30 days'
              AND oi.sku IS NOT NULL
              AND oi.sku NOT ILIKE '%PVA%'
            GROUP BY oi.sku
        ),
        ml_p AS (
            SELECT mi.seller_sku AS sku,
                   MAX(mi.title) AS name,
                   SUM(mi.quantity)::int AS units,
                   SUM(mi.unit_price * mi.quantity)::float AS revenue
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mo.date_created >= NOW() - INTERVAL '30 days'
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mi.seller_sku IS NOT NULL
            GROUP BY mi.seller_sku
        ),
        merged AS (
            SELECT sku, name, units, revenue, 'tn' AS src FROM tn_p
            UNION ALL
            SELECT sku, name, units, revenue, 'ml' AS src FROM ml_p
        )
        SELECT sku,
               MAX(name) AS name,
               SUM(units)::int AS units,
               SUM(revenue)::float AS revenue,
               SUM(CASE WHEN src='tn' THEN revenue ELSE 0 END)::float AS rev_tn,
               SUM(CASE WHEN src='ml' THEN revenue ELSE 0 END)::float AS rev_ml
        FROM merged
        GROUP BY sku
        ORDER BY revenue DESC LIMIT 15
    """) or []
    top_products_cross = [{
        "category": (r[1] or r[0] or "?")[:60],
        "value": float(r[3] or 0),
        "extra": {
            "sku": r[0],
            "units": int(r[2] or 0),
            "tn": round(float(r[4] or 0), 0),
            "ml": round(float(r[5] or 0), 0),
        },
    } for r in top_cross_rows]

    # ---------- Lifecycle de customers Unistore ----------
    lifecycle_rows = _q(uni, """
        WITH base AS (
            SELECT "customerId" AS cid,
                   COUNT(*) FILTER (WHERE "paymentStatus"='paid') AS paid_orders,
                   SUM(CASE WHEN "paymentStatus"='paid' THEN total ELSE 0 END)::float AS revenue
            FROM tienda_nube."Order"
            WHERE "customerId" IS NOT NULL
            GROUP BY 1
        )
        SELECT
            CASE
                WHEN paid_orders >= 4 THEN 'Recurrente'
                WHEN paid_orders = 3 THEN 'Convertido a Recurrente'
                WHEN paid_orders = 2 THEN '2da compra'
                WHEN paid_orders = 1 THEN 'Nuevo'
                ELSE 'Sin compras pagas'
            END AS estado,
            COUNT(*)::int AS clientes,
            SUM(revenue)::float AS revenue
        FROM base
        GROUP BY 1 ORDER BY 2 DESC
    """) or []
    lifecycle_mix = [{
        "category": r[0],
        "value": int(r[1] or 0),
        "extra": {"revenue": round(float(r[2] or 0), 0)},
    } for r in lifecycle_rows]

    return {
        "cards": cards,
        "revenue_by_channel": revenue_series,
        "revenue_mix": revenue_mix,
        "unit_health": unit_health,
        "top_products_cross": top_products_cross,
        "lifecycle_mix": lifecycle_mix,
        "integration_health": integrations,
        "top_alerts": alerts[:8],
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
