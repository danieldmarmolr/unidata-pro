"""
Dashboard de Ventas - Unistore (Tienda Nube + Mercado Libre).
Cruza tienda_nube.Order/OrderItem/OrderShippingAddress + meli.meli_orders.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from sqlalchemy.engine import Engine

from app.db.engines import get_engine
from app.services._utils import q as _q, scalar as _scalar

log = logging.getLogger("unidata.sales")

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def sales_unistore(period: str = "30d", channel: str = "all") -> dict:
    """
    period: 7d | 30d | 90d | 12m
    channel: all | tn | ml
    """
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unistore")
    p = {"days": days}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    # ---------- KPIs ----------
    cards: list[dict] = []

    gmv_tn = float(_scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0.0

    gmv_ml = float(_scalar(eng, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0

    gmv_total = gmv_tn + gmv_ml

    # vs periodo anterior (mismo span de dias, ventana inmediatamente previa)
    prev_p = {"days": days, "days2": days * 2}
    gmv_tn_prev = float(_scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, prev_p) or 0) if include_tn else 0.0
    gmv_ml_prev = float(_scalar(eng, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= NOW() - make_interval(days => :days2)
          AND date_created <  NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, prev_p) or 0) if include_ml else 0.0
    gmv_prev = gmv_tn_prev + gmv_ml_prev
    delta_gmv = ((gmv_total - gmv_prev) / gmv_prev * 100) if gmv_prev > 0 else None

    cards.append({
        "label": f"GMV ultimos {period}",
        "value": round(gmv_total, 0),
        "prefix": "$ ",
        "delta": round(delta_gmv, 1) if delta_gmv is not None else None,
        "hint": f"TN: {gmv_tn:,.0f} / ML: {gmv_ml:,.0f}",
    })

    # Ordenes
    orders_tn = int(_scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0
    orders_ml = int(_scalar(eng, """
        SELECT COUNT(*) FROM meli.meli_orders
        WHERE date_created >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_ml else 0
    total_orders = orders_tn + orders_ml

    orders_tn_prev = int(_scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, prev_p) or 0) if include_tn else 0
    orders_ml_prev = int(_scalar(eng, """
        SELECT COUNT(*) FROM meli.meli_orders
        WHERE date_created >= NOW() - make_interval(days => :days2)
          AND date_created <  NOW() - make_interval(days => :days)
    """, prev_p) or 0) if include_ml else 0
    orders_prev = orders_tn_prev + orders_ml_prev
    delta_orders = ((total_orders - orders_prev) / orders_prev * 100) if orders_prev > 0 else None

    cards.append({
        "label": "Ordenes",
        "value": total_orders,
        "delta": round(delta_orders, 1) if delta_orders is not None else None,
        "hint": f"TN: {orders_tn:,} / ML: {orders_ml:,}",
    })

    # AOV (sobre orders pagadas)
    aov_tn = float(_scalar(eng, """
        SELECT COALESCE(AVG(NULLIF(total,0)),0) FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND "paymentStatus"='paid'
    """, p) or 0) if include_tn else 0.0
    aov_ml = float(_scalar(eng, """
        SELECT COALESCE(AVG(NULLIF(total_amount,0)),0) FROM meli.meli_orders
        WHERE date_created >= NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    aov = (aov_tn + aov_ml) / (1 if (aov_tn>0 and aov_ml>0) and channel == "all" else 1)
    if channel == "all" and aov_tn>0 and aov_ml>0:
        aov = (aov_tn + aov_ml) / 2
    elif channel == "tn":
        aov = aov_tn
    elif channel == "ml":
        aov = aov_ml
    cards.append({
        "label": "Ticket promedio (AOV)",
        "value": round(aov, 0),
        "prefix": "$ ",
        "hint": "Sobre ordenes pagadas",
    })

    # Tasa de pago TN
    paid_rate = None
    paid_orders_tn = int(_scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND "paymentStatus"='paid'
    """, p) or 0)
    if orders_tn > 0:
        paid_rate = paid_orders_tn / orders_tn * 100
    cards.append({
        "label": "% Pago confirmado (TN)",
        "value": round(paid_rate, 1) if paid_rate is not None else 0,
        "suffix": "%",
        "hint": f"{paid_orders_tn:,} de {orders_tn:,}",
    })

    # Top canal
    if channel == "all":
        top_chan = "Tienda Nube" if gmv_tn >= gmv_ml else "Mercado Libre"
        share = (max(gmv_tn, gmv_ml) / gmv_total * 100) if gmv_total > 0 else 0
        cards.append({
            "label": "Canal lider",
            "value": top_chan,
            "hint": f"{share:.1f}% del GMV del periodo",
        })

    # ---------- Series mensuales 12m por canal ----------
    series: list[dict] = []
    if include_tn:
        rows = _q(eng, """
            SELECT date_trunc('month', "createdAt")::date AS mes,
                   SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END)::float
            FROM tienda_nube."Order"
            WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
            GROUP BY 1 ORDER BY 1
        """) or []
        series.append({
            "label": "Tienda Nube",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
        })
    if include_ml:
        rows = _q(eng, """
            SELECT date_trunc('month', date_created)::date AS mes,
                   SUM(COALESCE(total_amount,0))::float
            FROM meli.meli_orders
            WHERE date_created >= date_trunc('month', NOW() - INTERVAL '11 months')
              AND status IN ('paid','confirmed','shipped','delivered')
            GROUP BY 1 ORDER BY 1
        """) or []
        series.append({
            "label": "Mercado Libre",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
        })

    # ---------- Daily revenue del periodo (TN + ML combinado, segun canal) ----------
    daily: list[dict] = []
    parts: list[str] = []
    if include_tn:
        parts.append("""
            SELECT date_trunc('day', "createdAt") AS day,
                   CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM tienda_nube."Order"
            WHERE "createdAt" >= NOW() - make_interval(days => :days)
        """)
    if include_ml:
        parts.append("""
            SELECT date_trunc('day', date_created) AS day,
                   COALESCE(total_amount,0) AS rev
            FROM meli.meli_orders
            WHERE date_created >= NOW() - make_interval(days => :days)
              AND status IN ('paid','confirmed','shipped','delivered')
        """)
    if parts:
        body = " UNION ALL ".join(parts)
        daily_rows = _q(eng, f"""
            SELECT day::date, COALESCE(SUM(rev),0)::float
            FROM ({body}) x
            GROUP BY 1 ORDER BY 1
        """, p) or []
        daily = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "", "value": float(r[1] or 0)} for r in daily_rows]

    # ---------- Distribucion paymentStatus (TN) ----------
    payment_status: list[dict] = []
    if include_tn:
        rows = _q(eng, """
            SELECT COALESCE("paymentStatus",'desconocido') AS status, COUNT(*)::int
            FROM tienda_nube."Order"
            WHERE "createdAt" >= NOW() - make_interval(days => :days)
            GROUP BY 1 ORDER BY 2 DESC
        """, p) or []
        payment_status = [{"category": r[0], "value": float(r[1])} for r in rows]

    # ---------- Top productos ----------
    # Usamos OrderItem.name (denormalizado) y agrupamos por (productId, name)
    # Filtrando solo orders pagadas TN. Para ML intentamos OrderItemMercadoLibre.
    top_products: list[dict] = []
    if include_tn:
        rows = _q(eng, """
            SELECT oi."productId"::text AS product_id,
                   oi.name AS name,
                   MAX(oi.sku) AS sku,
                   SUM(COALESCE(oi.quantity,0))::int AS units,
                   SUM(COALESCE(oi.quantity,0) * COALESCE(oi.price,0))::float AS revenue,
                   COUNT(DISTINCT oi."orderId")::int AS orders
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."createdAt" >= NOW() - make_interval(days => :days)
              AND o."paymentStatus" = 'paid'
            GROUP BY 1, 2
            ORDER BY revenue DESC
            LIMIT 15
        """, p) or []
        top_products.extend([{
            "product_id": r[0], "name": r[1] or "(sin nombre)",
            "sku": r[2], "units": int(r[3] or 0),
            "revenue": float(r[4] or 0), "orders": int(r[5] or 0),
        } for r in rows])

    # ---------- Top provincias TN ----------
    top_provinces: list[dict] = []
    if include_tn:
        rows = _q(eng, """
            SELECT COALESCE(NULLIF(TRIM(osa.province), ''), 'Sin provincia') AS prov,
                   SUM(COALESCE(o.total,0))::float AS rev,
                   COUNT(*)::int AS orders
            FROM tienda_nube."Order" o
            JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
            WHERE o."createdAt" >= NOW() - make_interval(days => :days)
              AND o."paymentStatus" = 'paid'
            GROUP BY 1
            ORDER BY rev DESC
            LIMIT 10
        """, p) or []
        top_provinces = [{
            "category": r[0],
            "value": float(r[1] or 0),
            "extra": {"orders": int(r[2] or 0)},
        } for r in rows]

    return {
        "period": period,
        "channel": channel,
        "cards": cards,
        "revenue_by_channel": series,
        "payment_status": payment_status,
        "top_products": top_products,
        "top_provinces": top_provinces,
        "daily_revenue": daily,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
