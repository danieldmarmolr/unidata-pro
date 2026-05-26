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
    unit: str = "unistore",
) -> dict:
    """Dataset completo por SKU con todas las dimensiones unidas.

    period: ventana para revenue, unidades, ordenes, growth (comparado vs misma ventana anterior).
    channel: 'all' | 'tn' | 'ml' (por ahora solo TN tiene cobertura completa).
    unit: 'unistore' (default) o 'unidrop' (SKUs vendidos por dropshippers).
    """
    if unit == "unidrop":
        return _products_master_table_unidrop(period, from_iso, to_iso)
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
          -- digip."Stock" es 1 row por SKU con UnidadesDisponibles ya consolidado
          -- (vs StockDetalle.unidades que incluye reservado/bloqueado/a despachar).
          -- UnidadesDisponibles = lo que efectivamente se puede vender.
          SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock_actual
          FROM digip."Stock"
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


def _products_master_table_unidrop(
    period: str = "90d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Tabla maestra por SKU para Unidrop: agrega ML+TN dropshipper, calcula
    ABC, XYZ, growth_30d, lifecycle y ganancia Unidrop (profit_for_subscription
    asignado proporcionalmente al revenue del item dentro de la orden).

    Stock / DoI / returns no aplican (Unidrop no tiene stock propio ni
    devoluciones consolidadas)."""
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unidrop")
    p = {"days": days}

    # Base agregada por SKU del periodo (ML + TN union sumado)
    rows = q(eng, """
        WITH ml AS (
            SELECT oi."sellerSku" AS sku,
                   MAX(oi.title) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi."unitPrice")::float AS revenue,
                   COUNT(DISTINCT oi."orderId")::int AS orders,
                   COUNT(DISTINCT o."userId")::int AS dropshippers,
                   MIN(o."dateCreated") AS first_sale,
                   -- ganancia alocada: (item_rev / order_total) * profit_for_subscription
                   SUM(
                     CASE WHEN o."totalAmount" > 0 AND o."profit_for_subscription" IS NOT NULL
                          THEN (oi.quantity * oi."unitPrice")::float / o."totalAmount"::float * o."profit_for_subscription"::float
                          ELSE 0 END
                   )::float AS ganancia_alloc,
                   SUM(oi.quantity * COALESCE(oi."unitCost", 0))::float AS costo_ml
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE o."status" = 'paid' AND o."number" LIKE 'DROP-%'
              AND o."dateCreated" >= NOW() - make_interval(days => :days)
              AND oi."sellerSku" IS NOT NULL
            GROUP BY oi."sellerSku"
        ),
        tn AS (
            SELECT oi.sku AS sku,
                   MAX(oi.name) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue,
                   COUNT(DISTINCT tno.tienda_nube_id)::int AS orders,
                   COUNT(DISTINCT tno.user_id)::int AS dropshippers,
                   MIN(tno.created_at) AS first_sale,
                   0::float AS ganancia_alloc,
                   0::float AS costo_ml
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        ),
        u AS (
            SELECT * FROM ml UNION ALL SELECT * FROM tn
        )
        SELECT sku,
               MAX(name) AS name,
               SUM(units)::int AS units,
               SUM(revenue)::float AS revenue,
               SUM(orders)::int AS orders,
               SUM(dropshippers)::int AS dropshippers,
               MIN(first_sale) AS first_sale,
               SUM(ganancia_alloc)::float AS ganancia,
               SUM(costo_ml)::float AS costo
        FROM u
        GROUP BY sku
        ORDER BY SUM(revenue) DESC NULLS LAST
    """, p) or []

    # Periodo anterior identico para growth
    prev_map: dict[str, float] = {}
    for r in q(eng, """
        WITH ml AS (
            SELECT oi."sellerSku" AS sku, SUM(oi.quantity * oi."unitPrice")::float AS rev
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE o."status" = 'paid' AND o."number" LIKE 'DROP-%'
              AND o."dateCreated" >= NOW() - make_interval(days => :days * 2)
              AND o."dateCreated" <  NOW() - make_interval(days => :days)
              AND oi."sellerSku" IS NOT NULL
            GROUP BY oi."sellerSku"
        ),
        tn AS (
            SELECT oi.sku AS sku, SUM(oi.quantity * oi.price)::float AS rev
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days * 2)
              AND tno.created_at <  NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        )
        SELECT sku, SUM(rev)::float FROM (SELECT * FROM ml UNION ALL SELECT * FROM tn) z
        GROUP BY sku
    """, p) or []:
        prev_map[r[0]] = float(r[1] or 0)

    # XYZ stats: varianza de ventas diarias dentro del periodo
    xyz_map: dict[str, dict] = {}
    for r in q(eng, """
        SELECT sku, COUNT(*) AS dias, AVG(qty_dia)::float AS mean_q, STDDEV_SAMP(qty_dia)::float AS std_q
        FROM (
            SELECT oi."sellerSku" AS sku,
                   DATE(o."dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
                   SUM(oi.quantity)::float AS qty_dia
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE o."status" = 'paid' AND o."number" LIKE 'DROP-%'
              AND o."dateCreated" >= NOW() - make_interval(days => :days)
              AND oi."sellerSku" IS NOT NULL
            GROUP BY 1, 2
            UNION ALL
            SELECT oi.sku,
                   DATE(tno.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'),
                   SUM(oi.quantity)::float
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY 1, 2
        ) d
        GROUP BY sku
    """, p) or []:
        xyz_map[r[0]] = {"dias": int(r[1] or 0), "mean": float(r[2] or 0), "std": float(r[3] or 0)}

    total_rev = sum(float(r[3] or 0) for r in rows) or 1.0
    cumulative = 0.0
    items: list[dict] = []
    for i, r in enumerate(rows):
        sku, name, units, revenue, orders, dropshippers, first_sale, ganancia, costo = r
        rev_f = float(revenue or 0)
        units_i = int(units or 0)
        ganancia_f = float(ganancia or 0)
        costo_f = float(costo or 0)

        cumulative += rev_f
        pct_acum = cumulative / total_rev * 100
        abc = "A" if pct_acum <= 80 else "B" if pct_acum <= 95 else "C"

        x_stats = xyz_map.get(sku, {})
        mean_q = float(x_stats.get("mean") or 0)
        std_q = float(x_stats.get("std") or 0)
        cv = (std_q / mean_q) if mean_q > 0 else None
        xyz = None
        if cv is not None:
            xyz = "X" if cv < 0.25 else "Y" if cv < 0.50 else "Z"

        ventas_dia_f = (units_i / days) if days > 0 else 0.0

        rev_prev = prev_map.get(sku, 0.0)
        growth_pct: float | None
        if rev_prev > 0:
            growth_pct = round((rev_f - rev_prev) / rev_prev * 100, 1)
        elif rev_f > 0:
            growth_pct = 100.0
        else:
            growth_pct = None

        fs_days: int | None = None
        if first_sale:
            try:
                fs_days = max(0, (now_ar().date() - first_sale.date()).days)
            except Exception:
                fs_days = None
        lifecycle = _bucket_lifecycle(fs_days, growth_pct)

        margen_pct = (ganancia_f / rev_f * 100) if rev_f > 0 else None
        precio_avg = (rev_f / units_i) if units_i > 0 else 0.0

        items.append({
            "rank": i + 1,
            "sku": sku,
            "name": (name or sku or "?")[:120],
            "brand": "",
            "ean": "",
            "imagen": "",
            "units": units_i,
            "revenue": round(rev_f, 0),
            "orders": int(orders or 0),
            "customers": int(dropshippers or 0),  # repurposed: dropshippers count
            "precio_avg": round(precio_avg, 0),
            "ganancia": round(ganancia_f, 0) if ganancia_f > 0 else None,
            "margen_pct": round(margen_pct, 1) if margen_pct is not None else None,
            "abc": abc,
            "pct_acum": round(pct_acum, 2),
            "xyz": xyz,
            "cv": round(cv, 3) if cv is not None else None,
            "lifecycle": lifecycle,
            "doi": None,
            "doi_bucket": None,
            "stock_actual": 0,
            "ventas_dia_avg": round(ventas_dia_f, 2),
            "growth_30d_pct": growth_pct,
            "revenue_prev": round(rev_prev, 0),
            "returns_vendidas": None,
            "returns_devueltas": None,
            "returns_rate_pct": None,
            "first_sale_days_ago": fs_days,
            "is_new_7d": fs_days is not None and fs_days <= 7,
            "is_stockout_risk_14d": False,
        })

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
        "skus_stockout_risk": 0,
    }

    return {
        "period": period,
        "channel": "all",
        "unit": "unidrop",
        "days": days,
        "summary": summary,
        "skus": items,
        "generated_at": now_ar().isoformat(),
    }
