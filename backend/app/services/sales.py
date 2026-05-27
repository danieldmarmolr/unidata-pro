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
from app.services._utils import q as _q, scalar as _scalar, resolve_window

log = logging.getLogger("unidata.sales")

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def sales_unistore(
    period: str = "30d",
    channel: str = "all",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """
    period: today | yesterday | 7d | 30d | 90d | 12m | custom
    channel: all | tn | ml
    from_iso / to_iso: ISO date strings for period='custom'
    """
    eng = get_engine("unistore")

    window = resolve_window(period, from_iso, to_iso)
    from_ts = window["from_ts"]
    to_ts = window["to_ts"]
    # Ventana previa del mismo span — para calcular delta vs periodo anterior.
    # Funciona para HOY/AYER/Personalizado/7d/30d/etc sin casos especiales.
    span = to_ts - from_ts
    prev_from_ts = from_ts - span
    prev_to_ts = from_ts

    p = {"from_ts": from_ts, "to_ts": to_ts}
    prev_p = {"prev_from": prev_from_ts, "prev_to": prev_to_ts}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    # Label del periodo usado en las cards (mismo formato que muestra el topbar)
    period_label = {
        "today": "hoy", "yesterday": "ayer", "7d": "7d",
        "30d": "30d", "90d": "90d", "12m": "12m",
        "custom": "rango",
    }.get(period, period)

    # ---------- KPIs ----------
    cards: list[dict] = []

    gmv_tn = float(_scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
    """, p) or 0) if include_tn else 0.0

    gmv_ml = float(_scalar(eng, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= :from_ts AND date_created < :to_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0

    gmv_total = gmv_tn + gmv_ml

    gmv_tn_prev = float(_scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END), 0)
        FROM tienda_nube."Order"
        WHERE "createdAt" >= :prev_from AND "createdAt" < :prev_to
    """, prev_p) or 0) if include_tn else 0.0
    gmv_ml_prev = float(_scalar(eng, """
        SELECT COALESCE(SUM(COALESCE(total_amount,0)), 0)
        FROM meli.meli_orders
        WHERE date_created >= :prev_from AND date_created < :prev_to
          AND status IN ('paid','confirmed','shipped','delivered')
    """, prev_p) or 0) if include_ml else 0.0
    gmv_prev = gmv_tn_prev + gmv_ml_prev
    delta_gmv = ((gmv_total - gmv_prev) / gmv_prev * 100) if gmv_prev > 0 else None

    cards.append({
        "label": f"GMV ultimos {period_label}",
        "value": round(gmv_total, 0),
        "prefix": "$ ",
        "delta": round(delta_gmv, 1) if delta_gmv is not None else None,
        "hint": f"TN: {gmv_tn:,.0f} / ML: {gmv_ml:,.0f}",
    })

    # Ordenes
    orders_tn = int(_scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
    """, p) or 0) if include_tn else 0
    orders_ml = int(_scalar(eng, """
        SELECT COUNT(*) FROM meli.meli_orders
        WHERE date_created >= :from_ts AND date_created < :to_ts
    """, p) or 0) if include_ml else 0
    total_orders = orders_tn + orders_ml

    orders_tn_prev = int(_scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Order"
        WHERE "createdAt" >= :prev_from AND "createdAt" < :prev_to
    """, prev_p) or 0) if include_tn else 0
    orders_ml_prev = int(_scalar(eng, """
        SELECT COUNT(*) FROM meli.meli_orders
        WHERE date_created >= :prev_from AND date_created < :prev_to
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
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
          AND "paymentStatus"='paid'
    """, p) or 0) if include_tn else 0.0
    aov_ml = float(_scalar(eng, """
        SELECT COALESCE(AVG(NULLIF(total_amount,0)),0) FROM meli.meli_orders
        WHERE date_created >= :from_ts AND date_created < :to_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    if channel == "all" and aov_tn > 0 and aov_ml > 0:
        aov = (aov_tn + aov_ml) / 2
    elif channel == "tn":
        aov = aov_tn
    elif channel == "ml":
        aov = aov_ml
    else:
        aov = aov_tn + aov_ml
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
        WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
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

    # ---------- Daily revenue del periodo (enriquecido por canal) ----------
    # Usamos from_ts/to_ts para mayor precision en custom/today/yesterday.
    daily_params = {"from_ts": from_ts, "to_ts": to_ts}

    # Acumular por fecha (str YYYY-MM-DD)
    daily_map: dict[str, dict] = {}

    if include_tn:
        tn_rows = _q(eng, """
            WITH orders AS (
              SELECT date_trunc('day', o."createdAt")::date AS day,
                     COUNT(*) FILTER (WHERE o."paymentStatus"='paid')::int AS orders_paid,
                     COALESCE(SUM(CASE WHEN o."paymentStatus"='paid' THEN o.total ELSE 0 END), 0)::float AS revenue,
                     COUNT(*) FILTER (WHERE o."paymentStatus" IN ('refunded','voided','abandoned'))::int AS devoluciones
              FROM tienda_nube."Order" o
              WHERE o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
              GROUP BY 1
            ),
            items AS (
              SELECT date_trunc('day', o."createdAt")::date AS day,
                     COALESCE(SUM(oi.quantity), 0)::int AS units,
                     COUNT(DISTINCT oi.sku)::int AS skus
              FROM tienda_nube."OrderItem" oi
              JOIN tienda_nube."Order" o ON o.id = oi."orderId"
              WHERE o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
                AND o."paymentStatus" = 'paid'
              GROUP BY 1
            )
            SELECT COALESCE(ord.day, it.day) AS day,
                   COALESCE(ord.revenue, 0) AS revenue_tn,
                   COALESCE(ord.orders_paid, 0) AS orders_tn,
                   COALESCE(ord.devoluciones, 0) AS devoluciones,
                   COALESCE(it.units, 0) AS units,
                   COALESCE(it.skus, 0) AS skus,
                   CASE WHEN COALESCE(ord.orders_paid, 0) > 0
                        THEN COALESCE(ord.revenue, 0) / ord.orders_paid
                        ELSE 0 END AS ticket_avg_tn
            FROM orders ord FULL OUTER JOIN items it ON it.day = ord.day
            ORDER BY 1
        """, daily_params) or []
        for r in tn_rows:
            if not r[0]:
                continue
            d = r[0].strftime("%Y-%m-%d")
            daily_map[d] = {
                "date": d,
                "revenue_tn": float(r[1] or 0),
                "orders_tn": int(r[2] or 0),
                "devoluciones": int(r[3] or 0),
                "units": int(r[4] or 0),
                "skus": int(r[5] or 0),
                "ticket_avg": float(r[6] or 0),
                "revenue_ml": 0.0,
                "orders_ml": 0,
            }

    if include_ml:
        ml_rows = _q(eng, """
            SELECT date_trunc('day', date_created)::date AS day,
                   COALESCE(SUM(total_amount), 0)::float AS revenue_ml,
                   COUNT(*)::int AS orders_ml
            FROM meli.meli_orders
            WHERE date_created >= :from_ts AND date_created < :to_ts
              AND status IN ('paid','confirmed','shipped','delivered')
            GROUP BY 1 ORDER BY 1
        """, daily_params) or []
        for r in ml_rows:
            if not r[0]:
                continue
            d = r[0].strftime("%Y-%m-%d")
            if d in daily_map:
                daily_map[d]["revenue_ml"] = float(r[1] or 0)
                daily_map[d]["orders_ml"] = int(r[2] or 0)
            else:
                daily_map[d] = {
                    "date": d,
                    "revenue_tn": 0.0,
                    "orders_tn": 0,
                    "devoluciones": 0,
                    "units": 0,
                    "skus": 0,
                    "ticket_avg": 0.0,
                    "revenue_ml": float(r[1] or 0),
                    "orders_ml": int(r[2] or 0),
                }

    daily: list[dict] = []
    for pt in sorted(daily_map.values(), key=lambda x: x["date"]):
        pt["value"] = pt["revenue_tn"] + pt["revenue_ml"]
        pt["orders"] = pt["orders_tn"] + pt["orders_ml"]
        daily.append(pt)

    # ---------- Distribucion paymentStatus (TN) ----------
    payment_status: list[dict] = []
    if include_tn:
        rows = _q(eng, """
            SELECT COALESCE("paymentStatus",'desconocido') AS status, COUNT(*)::int
            FROM tienda_nube."Order"
            WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
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
            WHERE o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
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
            WHERE o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
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

    # ---------- Top productos con MARKUP (costo desde Costos de Importacion) ----------
    # Como Order.OrderItem.cost esta vacio, levantamos el costo del ultimo lote
    # por SKU desde costs_db (Supabase, local_persistence) y lo cruzamos en
    # Python (son DBs distintas, no podemos JOIN directo).
    top_markup: list[dict] = []
    cost_data_available = False
    try:
        from app.db import costs_db
        latest_costs = costs_db.current_costs(limit=10000) or []
        # Index por sku lowercase (es como costs_db indexa)
        cost_by_sku: dict[str, dict] = {}
        for c in latest_costs:
            sku_key = (c.get("sku") or "").strip().lower()
            if not sku_key:
                continue
            # Preferimos costo_unit_ars (incluye logistica/iva), fallback a precio_ars
            costo_unit = c.get("costo_unit_ars") or c.get("costo_con_iva_unit_ars") or 0
            if costo_unit:
                cost_by_sku[sku_key] = {
                    "costo_unit_ars": float(costo_unit),
                    "lote": c.get("lote"),
                    "imported_at": c.get("imported_at"),
                }
        # Enrich top_products
        for tp in top_products:
            sku = (tp.get("sku") or "").strip().lower()
            if not sku:
                continue
            c = cost_by_sku.get(sku)
            if not c:
                continue
            costo_unit = c["costo_unit_ars"]
            units = int(tp.get("units") or 0)
            revenue = float(tp.get("revenue") or 0)
            costo_total = costo_unit * units
            if revenue and costo_total:
                markup_abs = revenue - costo_total
                markup_pct = round(markup_abs / costo_total * 100, 1) if costo_total else 0
                top_markup.append({
                    "category": tp.get("name") or tp.get("sku") or "?",
                    "value": revenue,
                    "extra": {
                        "sku": tp.get("sku"),
                        "units": units,
                        "revenue": revenue,
                        "costo": round(costo_total, 0),
                        "costo_unit": round(costo_unit, 2),
                        "markup_abs": round(markup_abs, 0),
                        "markup_pct": f"{markup_pct:+.1f}%",
                        "lote": c.get("lote"),
                    },
                })
        if top_markup:
            cost_data_available = True
            # Ordenamos por markup_abs DESC (los mas rentables primero)
            top_markup.sort(key=lambda x: -float(x["extra"].get("markup_abs") or 0))
    except Exception as e:
        log.warning("sales_unistore markup enrich fail: %s", e)

    return {
        "period": period,
        "channel": channel,
        "cards": cards,
        "revenue_by_channel": series,
        "payment_status": payment_status,
        "top_products": top_products,
        "top_provinces": top_provinces,
        "top_markup": top_markup,
        "cost_data_available": cost_data_available,
        "daily_revenue": daily,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
