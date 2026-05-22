"""
Analisis omnicanal mayorista: Unistore vende a Unidrop, Unidrop revende a su
cliente final en TN y ML. Para cada SKU del catalogo, queremos ver:

- Precio retail Unistore TN (lo que Unistore le cobra al consumidor en su TN)
- Precio retail Unistore ML (lo que Fox Electronics cobra en MELI)
- Costo mayorista (lo que el dropshipper paga a Unistore = OrderItemMercadoLibre.unitCost en Unidrop)
- Precio retail Unidrop TN (precio del dropshipper a su cliente)
- Precio retail Unidrop ML (precio del dropshipper en MELI)

De esos 5 puntos sale la base de un analisis de elasticidad mayorista:
si Unistore sube el precio mayorista a Unidrop, ¿como reacciona el volumen
que compra Unidrop? (cruzar con cambios en costo_mayorista mes a mes).

Esta primera version arma SOLO la tabla cross-canal por SKU. La curva
precio-volumen mensual queda como TODO en docs/OMNICANAL_PRODUCTOS.md.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from app.db.engines import get_engine
from app.services._utils import q
from app.utils.tz import now_ar

log = logging.getLogger("unidata.wholesale")


def wholesale_sku_table(period_days: int = 90, limit: int = 200) -> dict:
    """Por SKU, los precios y volumenes en los 4 puntos del omnicanal.

    period_days: ventana de tiempo a considerar (default 90d).
    limit: top N SKUs por volumen total cross-canal (la tabla puede ser pesada).
    """
    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    # --- Unistore TN: precio retail propio + unidades
    uni_tn = q(eng_uni, """
        SELECT oi.sku,
               MAX(oi.name) AS name,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               AVG(oi.price)::float AS avg_price
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND oi.sku IS NOT NULL AND oi.sku NOT ILIKE '%PVA%'
        GROUP BY oi.sku
    """, {"days": period_days}) or []

    # --- Unistore MELI (Fox Electronics retail propio en MELI)
    uni_ml = q(eng_uni, """
        SELECT mi.seller_sku AS sku,
               MAX(mi.title) AS name,
               SUM(mi.quantity)::int AS units,
               SUM(mi.quantity * mi.unit_price)::float AS revenue,
               AVG(mi.unit_price)::float AS avg_price
        FROM meli.meli_order_items mi
        JOIN meli.meli_orders mo ON mo.id = mi.order_id
        WHERE mi.seller_sku IS NOT NULL
          AND mo.date_created >= NOW() - make_interval(days => :days)
          AND mo.status IN ('paid','confirmed','shipped','delivered')
        GROUP BY mi.seller_sku
    """, {"days": period_days}) or []

    # --- Unidrop TN: precio que el dropshipper le pone a su cliente
    drp_tn = []
    try:
        drp_tn = q(eng_drp, """
            SELECT oi.sku,
                   MAX(oi.name) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue,
                   AVG(oi.price)::float AS avg_price
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        """, {"days": period_days}) or []
    except Exception as e:
        log.warning("drp_tn fail: %s", e)

    # --- Unidrop MELI: precio retail (unitPrice) + costo mayorista (unitCost)
    drp_ml = []
    try:
        drp_ml = q(eng_drp, """
            SELECT oi."sellerSku" AS sku,
                   MAX(oi.title) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi."unitPrice")::float AS revenue_retail,
                   AVG(oi."unitPrice")::float AS avg_unit_price,
                   AVG(oi."unitCost")::float AS avg_unit_cost,
                   SUM(oi.quantity * oi."unitCost")::float AS revenue_mayorista
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" IS NOT NULL
              AND o."dateCreated" >= NOW() - make_interval(days => :days)
              AND o.estado IN ('paid','confirmed','shipped','delivered')
            GROUP BY oi."sellerSku"
        """, {"days": period_days}) or []
    except Exception as e:
        log.warning("drp_ml fail: %s", e)

    # --- Mergear por SKU
    by_sku: dict[str, dict] = {}

    def upsert(sku: str) -> dict:
        s = (sku or "").strip()
        if not s:
            return {}
        if s not in by_sku:
            by_sku[s] = {
                "sku": s,
                "name": None,
                "unistore_tn": {"units": 0, "revenue": 0.0, "avg_price": 0.0},
                "unistore_ml": {"units": 0, "revenue": 0.0, "avg_price": 0.0},
                "unidrop_tn":  {"units": 0, "revenue": 0.0, "avg_price": 0.0},
                "unidrop_ml":  {
                    "units": 0,
                    "revenue_retail": 0.0,
                    "revenue_mayorista": 0.0,
                    "avg_unit_price": 0.0,
                    "avg_unit_cost": 0.0,
                },
            }
        return by_sku[s]

    for sku, name, units, revenue, avg_price in uni_tn:
        d = upsert(sku)
        if not d: continue
        d["name"] = d["name"] or name
        d["unistore_tn"] = {
            "units": int(units or 0),
            "revenue": round(float(revenue or 0), 0),
            "avg_price": round(float(avg_price or 0), 0),
        }
    for sku, name, units, revenue, avg_price in uni_ml:
        d = upsert(sku)
        if not d: continue
        d["name"] = d["name"] or name
        d["unistore_ml"] = {
            "units": int(units or 0),
            "revenue": round(float(revenue or 0), 0),
            "avg_price": round(float(avg_price or 0), 0),
        }
    for sku, name, units, revenue, avg_price in drp_tn:
        d = upsert(sku)
        if not d: continue
        d["name"] = d["name"] or name
        d["unidrop_tn"] = {
            "units": int(units or 0),
            "revenue": round(float(revenue or 0), 0),
            "avg_price": round(float(avg_price or 0), 0),
        }
    for sku, name, units, rev_retail, avg_price, avg_cost, rev_mayorista in drp_ml:
        d = upsert(sku)
        if not d: continue
        d["name"] = d["name"] or name
        d["unidrop_ml"] = {
            "units": int(units or 0),
            "revenue_retail": round(float(rev_retail or 0), 0),
            "revenue_mayorista": round(float(rev_mayorista or 0), 0),
            "avg_unit_price": round(float(avg_price or 0), 0),
            "avg_unit_cost": round(float(avg_cost or 0), 0),
        }

    # --- Derivar metricas cross-canal
    skus_out = []
    for sku, d in by_sku.items():
        utn = d["unistore_tn"]; uml = d["unistore_ml"]
        dtn = d["unidrop_tn"];  dml = d["unidrop_ml"]
        units_total = utn["units"] + uml["units"] + dtn["units"] + dml["units"]
        if units_total == 0:
            continue

        # Spread retail entre precio Unistore y precio Unidrop
        unistore_avg = (utn["avg_price"] + uml["avg_price"]) / 2 if (utn["units"] + uml["units"] > 0) else 0
        unidrop_retail_avg = (dtn["avg_price"] + dml["avg_unit_price"]) / 2 if (dtn["units"] + dml["units"] > 0) else 0
        spread_pct = ((unidrop_retail_avg - unistore_avg) / unistore_avg * 100) if unistore_avg > 0 else None

        # Margen del dropshipper en MELI: (precio retail - costo mayorista) / precio retail
        margen_drp_ml_pct = None
        if dml["avg_unit_price"] > 0 and dml["avg_unit_cost"] > 0:
            margen_drp_ml_pct = round(
                (dml["avg_unit_price"] - dml["avg_unit_cost"]) / dml["avg_unit_price"] * 100, 1
            )

        # Distribucion de volumen
        units_unistore = utn["units"] + uml["units"]
        units_unidrop = dtn["units"] + dml["units"]
        share_unistore = round(units_unistore / units_total * 100, 1) if units_total > 0 else 0

        skus_out.append({
            "sku": sku,
            "name": d["name"] or sku,
            "units_total": units_total,
            "units_unistore": units_unistore,
            "units_unidrop": units_unidrop,
            "share_unistore_pct": share_unistore,
            "share_unidrop_pct": round(100 - share_unistore, 1),
            "unistore_tn": utn,
            "unistore_ml": uml,
            "unidrop_tn": dtn,
            "unidrop_ml": dml,
            "spread_retail_pct": round(spread_pct, 1) if spread_pct is not None else None,
            "margen_drp_ml_pct": margen_drp_ml_pct,
            "precio_mayorista_avg": dml["avg_unit_cost"],
            "precio_retail_unistore_avg": round(unistore_avg, 0),
            "precio_retail_unidrop_avg": round(unidrop_retail_avg, 0),
        })

    skus_out.sort(key=lambda x: -x["units_total"])
    skus_out = skus_out[:limit]

    # --- Resumen ejecutivo
    total_units = sum(x["units_total"] for x in skus_out)
    skus_con_mayorista = [x for x in skus_out if x["precio_mayorista_avg"] > 0]

    return {
        "period_days": period_days,
        "skus": skus_out,
        "summary": {
            "total_skus": len(skus_out),
            "total_units": total_units,
            "skus_con_dato_mayorista": len(skus_con_mayorista),
            "spread_retail_avg_pct": round(
                sum(x["spread_retail_pct"] or 0 for x in skus_out if x["spread_retail_pct"] is not None)
                / max(1, sum(1 for x in skus_out if x["spread_retail_pct"] is not None)),
                1,
            ),
            "margen_drp_avg_pct": round(
                sum(x["margen_drp_ml_pct"] or 0 for x in skus_out if x["margen_drp_ml_pct"] is not None)
                / max(1, sum(1 for x in skus_out if x["margen_drp_ml_pct"] is not None)),
                1,
            ),
        },
        "generated_at": now_ar().isoformat(),
        "todo": [
            "Curva precio-volumen mensual mayorista (regresion lineal por SKU)",
            "Detectar cambios de unitCost (PVP mayorista) y correlacionar con volumen Unidrop",
            "Sumar el canal Unidrop suscripciones MELI si existe relacion SKU",
            "Mapeo de equivalencias de SKU entre Unistore y Unidrop (algunos pueden diferir)",
        ],
    }
