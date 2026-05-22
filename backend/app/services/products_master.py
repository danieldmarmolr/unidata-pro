"""
Tabla maestra por SKU para la vista /dashboard/productos.

Une en un solo dataset todas las dimensiones que normalmente viven separadas
en /productos/analytics: ABC, XYZ, lifecycle stage, DoI, returns%, growth 30d,
stock actual, ganancia / margen.

Diseñado para reemplazar el "Top 20 por revenue" con un dataset filtrable
+ sortable + exportable.
"""
from __future__ import annotations

import logging
from typing import Any

from app.db.engines import get_engine
from app.services._utils import q, resolve_window
from app.services.profit_engine import cost_index_unistore, calc_profit
from app.utils.tz import now_ar

log = logging.getLogger("unidata.products_master")


def _bucket_doi(doi: float | None) -> str | None:
    if doi is None:
        return None
    if doi < 30:
        return "rapido"
    if doi < 90:
        return "normal"
    if doi < 180:
        return "lento"
    return "muerto"


def _bucket_lifecycle(first_sale_days_ago: int | None, growth_pct: float | None) -> str:
    """Heuristica simple basada en edad y growth reciente."""
    if first_sale_days_ago is None:
        return "dormido"
    if first_sale_days_ago < 60:
        return "nuevo"
    if growth_pct is not None and growth_pct >= 30:
        return "growth"
    if growth_pct is not None and growth_pct <= -30:
        return "declive"
    if first_sale_days_ago > 365 and (growth_pct is None or abs(growth_pct) < 30):
        return "maduro"
    return "maduro"


def products_master_table(
    period: str = "90d",
    channel: str = "all",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Dataset completo por SKU con todas las dimensiones unidas.

    period: ventana para revenue, unidades, ordenes, growth (comparado vs misma ventana anterior).
    channel: 'all' | 'tn' | 'ml' (por ahora solo TN tiene cobertura completa).
    """
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    # Query maestra con todas las CTE.
    # - base: SKUs vendidos en el periodo + revenue/units/orders/customers/precio_avg
    # - growth: comparativo con la ventana anterior identica
    # - stock: snapshot Digip
    # - imagen/brand/categoria: TN Product + ProductImage
    # - first_sale: edad para lifecycle
    # - xyz_stats: stddev de ventas diarias dentro del periodo
    # - returns: devoluciones de Unidev (puede no joinear si schema no esta)
    rows = q(eng, """
        WITH base AS (
          SELECT oi.sku,
                 MAX(oi.name)                         AS name,
                 MAX(oi."productId")::text            AS product_id,
                 SUM(oi.quantity)::int                AS units,
                 SUM(oi.quantity * oi.price)::float   AS revenue,
                 COUNT(DISTINCT oi."orderId")::int    AS orders,
                 COUNT(DISTINCT o."customerId")::int  AS customers,
                 (SUM(oi.quantity * oi.price)::float / NULLIF(SUM(oi.quantity), 0)) AS precio_avg
          FROM tienda_nube."OrderItem" oi
          JOIN tienda_nube."Order" o ON o.id = oi."orderId"
          WHERE o."createdAt" >= NOW() - make_interval(days => :days)
            AND o."paymentStatus" = 'paid'
            AND oi.sku IS NOT NULL
            AND oi.sku NOT ILIKE '%PVA%'
          GROUP BY oi.sku
        ),
        prev AS (
          SELECT oi.sku,
                 SUM(oi.quantity * oi.price)::float AS revenue_prev
          FROM tienda_nube."OrderItem" oi
          JOIN tienda_nube."Order" o ON o.id = oi."orderId"
          WHERE o."createdAt" >= NOW() - make_interval(days => :days * 2)
            AND o."createdAt" <  NOW() - make_interval(days => :days)
            AND o."paymentStatus" = 'paid'
            AND oi.sku IS NOT NULL
          GROUP BY oi.sku
        ),
        first_sale AS (
          SELECT oi.sku, MIN(o."createdAt") AS first_sale_at
          FROM tienda_nube."OrderItem" oi
          JOIN tienda_nube."Order" o ON o.id = oi."orderId"
          WHERE o."paymentStatus" = 'paid' AND oi.sku IS NOT NULL
          GROUP BY oi.sku
        ),
        xyz_stats AS (
          SELECT sku,
                 COUNT(*)                  AS dias_con_ventas,
                 AVG(qty_dia)::float       AS mean_qty,
                 STDDEV_SAMP(qty_dia)::float AS std_qty
          FROM (
            SELECT oi.sku, DATE(o."createdAt") AS dia, SUM(oi.quantity)::float AS qty_dia
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY 1, 2
          ) d
          GROUP BY sku
        ),
        stock AS (
          SELECT "articuloCodigo" AS sku, SUM(unidades)::int AS stock_actual
          FROM digip."StockDetalle" GROUP BY 1
        ),
        prod AS (
          SELECT pv.sku,
                 MAX(p.id)::text             AS product_id,
                 MAX(p.name)                 AS name_tn,
                 COALESCE(MAX(p.brand),'')   AS brand,
                 COALESCE(MAX(pv.barcode),'') AS ean_tn,
                 (SELECT pi.src FROM tienda_nube."ProductImage" pi
                  WHERE pi."productId" = MAX(p.id)
                  ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
          FROM tienda_nube."ProductVariant" pv
          JOIN tienda_nube."Product" p ON p.id = pv."productId"
          WHERE pv.sku IS NOT NULL
          GROUP BY pv.sku
        )
        SELECT b.sku,
               COALESCE(prod.name_tn, b.name)        AS name,
               prod.brand                            AS brand,
               COALESCE(prod.ean_tn, '')             AS ean,
               COALESCE(prod.imagen, '')             AS imagen,
               b.units, b.revenue, b.orders, b.customers, b.precio_avg,
               COALESCE(s.stock_actual, 0)           AS stock_actual,
               (b.units::float / NULLIF(:days, 0))   AS ventas_dia_avg,
               COALESCE(p.revenue_prev, 0)           AS revenue_prev,
               fs.first_sale_at,
               EXTRACT(DAY FROM (NOW() - fs.first_sale_at))::int AS first_sale_days_ago,
               x.dias_con_ventas, x.mean_qty, x.std_qty
        FROM base b
        LEFT JOIN prev p       ON p.sku = b.sku
        LEFT JOIN first_sale fs ON fs.sku = b.sku
        LEFT JOIN xyz_stats x  ON x.sku = b.sku
        LEFT JOIN stock s      ON s.sku = b.sku
        LEFT JOIN prod         ON prod.sku = b.sku
        ORDER BY b.revenue DESC NULLS LAST
    """, p) or []

    # Returns rate por SKU (puede fallar si Unidev no tiene schema)
    returns_map: dict[str, dict] = {}
    try:
        ret_rows = q(eng, """
            WITH vendidas AS (
              SELECT oi.sku, SUM(oi.quantity)::int AS vendidas
              FROM tienda_nube."OrderItem" oi
              JOIN tienda_nube."Order" o ON o.id = oi."orderId"
              WHERE o."paymentStatus" = 'paid'
                AND o."createdAt" >= NOW() - INTERVAL '90 days'
                AND oi.sku IS NOT NULL
              GROUP BY oi.sku
            ),
            devueltas AS (
              SELECT di."productoSku" AS sku, SUM(di.cantidad)::int AS devueltas
              FROM unidev.devolucion_items di
              JOIN unidev.devoluciones d ON d.id = di."devolucionId"
              WHERE d."fechaCreacion" >= NOW() - INTERVAL '90 days'
                AND di."productoSku" IS NOT NULL
              GROUP BY di."productoSku"
            )
            SELECT v.sku, v.vendidas, COALESCE(d.devueltas, 0) AS devueltas
            FROM vendidas v
            LEFT JOIN devueltas d ON d.sku = v.sku
            WHERE v.vendidas > 0
        """) or []
        for r in ret_rows:
            sku, vendidas, devueltas = r
            v = int(vendidas or 0); dv = int(devueltas or 0)
            if v > 0:
                returns_map[sku] = {
                    "vendidas": v, "devueltas": dv,
                    "returns_rate_pct": round(dv / v * 100, 2),
                }
    except Exception as e:
        log.warning("returns join skipped: %s", e)

    cost_idx = cost_index_unistore()

    # Calcular ganancia, ABC cumsum, XYZ classes y lifecycle en Python
    total_rev = sum(float(r[6] or 0) for r in rows) or 1.0
    cumulative = 0.0
    items: list[dict] = []
    for i, r in enumerate(rows):
        (sku, name, brand, ean, imagen, units, revenue, orders, customers, precio_avg,
         stock_actual, ventas_dia_avg, revenue_prev, first_sale_at,
         first_sale_days_ago, dias_con_ventas, mean_qty, std_qty) = r

        rev_f = float(revenue or 0)
        units_i = int(units or 0)
        stock_i = int(stock_actual or 0)
        ventas_dia_f = float(ventas_dia_avg or 0)
        revenue_prev_f = float(revenue_prev or 0)

        # ABC
        cumulative += rev_f
        pct_acum = cumulative / total_rev * 100
        abc = "A" if pct_acum <= 80 else "B" if pct_acum <= 95 else "C"

        # XYZ
        mean_f = float(mean_qty or 0)
        std_f = float(std_qty or 0)
        cv = (std_f / mean_f) if mean_f > 0 else None
        xyz = None
        if cv is not None:
            if cv < 0.25:
                xyz = "X"
            elif cv < 0.50:
                xyz = "Y"
            else:
                xyz = "Z"

        # DoI
        doi: float | None = None
        if stock_i > 0 and ventas_dia_f > 0:
            doi = round(stock_i / ventas_dia_f, 1)
        bucket = _bucket_doi(doi)

        # Growth 30d (vs ventana anterior identica)
        growth_pct: float | None = None
        if revenue_prev_f > 0:
            growth_pct = round((rev_f - revenue_prev_f) / revenue_prev_f * 100, 1)
        elif rev_f > 0:
            growth_pct = 100.0  # SKU sin ventas previas

        # Lifecycle
        fs_days = int(first_sale_days_ago) if first_sale_days_ago is not None else None
        lifecycle = _bucket_lifecycle(fs_days, growth_pct)

        # Ganancia / margen via cost_idx
        ganancia: float | None = None
        margen_pct: float | None = None
        cost_rec = cost_idx.get((sku or "").strip().lower())
        if cost_rec and cost_rec.get("costo_con_iva") and units_i > 0 and rev_f > 0:
            sin_iva = float(cost_rec.get("costo_sin_iva") or 0)
            con_iva = float(cost_rec.get("costo_con_iva") or sin_iva)
            pb = calc_profit(
                ingreso_bruto=rev_f,
                costo_sin_iva=sin_iva * units_i,
                costo_con_iva=con_iva * units_i,
                is_cash=False,
                iva_aliquot_override=cost_rec.get("iva_aliquot"),
            )
            ganancia = round(pb.ganancia_neta, 0)
            margen_pct = round(pb.margen_pct, 1)

        # Returns
        ret = returns_map.get(sku, {})

        items.append({
            "rank": i + 1,
            "sku": sku,
            "name": (name or sku or "?")[:120],
            "brand": brand or "",
            "ean": ean or "",
            "imagen": imagen or "",
            "units": units_i,
            "revenue": round(rev_f, 0),
            "orders": int(orders or 0),
            "customers": int(customers or 0),
            "precio_avg": round(float(precio_avg or 0), 0),
            "ganancia": ganancia,
            "margen_pct": margen_pct,
            "abc": abc,
            "pct_acum": round(pct_acum, 2),
            "xyz": xyz,
            "cv": round(cv, 3) if cv is not None else None,
            "lifecycle": lifecycle,
            "doi": doi,
            "doi_bucket": bucket,
            "stock_actual": stock_i,
            "ventas_dia_avg": round(ventas_dia_f, 2),
            "growth_30d_pct": growth_pct,
            "revenue_prev": round(revenue_prev_f, 0),
            "returns_vendidas": ret.get("vendidas"),
            "returns_devueltas": ret.get("devueltas"),
            "returns_rate_pct": ret.get("returns_rate_pct"),
            "first_sale_days_ago": fs_days,
            "is_new_7d": fs_days is not None and fs_days <= 7,
            "is_stockout_risk_14d": (doi is not None and doi <= 14 and ventas_dia_f > 0),
        })

    # Resumen agregado
    summary = {
        "total_skus": len(items),
        "total_revenue": round(total_rev, 0),
        "total_ganancia": round(sum(it["ganancia"] or 0 for it in items), 0),
        "skus_con_costo": sum(1 for it in items if it["ganancia"] is not None),
        "skus_clase_a": sum(1 for it in items if it["abc"] == "A"),
        "skus_clase_b": sum(1 for it in items if it["abc"] == "B"),
        "skus_clase_c": sum(1 for it in items if it["abc"] == "C"),
        "skus_growth": sum(1 for it in items if (it["growth_30d_pct"] or 0) >= 30),
        "skus_declive": sum(1 for it in items if (it["growth_30d_pct"] or 0) <= -30),
        "skus_nuevos_7d": sum(1 for it in items if it["is_new_7d"]),
        "skus_stockout_risk": sum(1 for it in items if it["is_stockout_risk_14d"]),
    }

    return {
        "period": period,
        "channel": channel,
        "days": days,
        "summary": summary,
        "skus": items,
        "generated_at": now_ar().isoformat(),
    }
