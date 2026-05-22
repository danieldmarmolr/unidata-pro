"""
Analisis omnicanal mayorista — vista enriquecida por SKU cross-canal.

Para cada SKU activo en el periodo devuelve:

1. Volumen + precio retail en los 4 canales (Unistore TN/ML, Unidrop TN/ML)
2. Costo de importacion Unistore (cost_index_unistore) — la base
3. Precio mayorista promedio que paga el dropshipper a Unistore
4. Markup mayorista Unistore: (precio_mayorista - costo_importacion) / costo_importacion
5. Markup retail Unistore: (precio_retail_propio - costo_importacion) / costo_importacion
6. Margen + ganancia retail Unistore (motor calc_profit)
7. Markup + margen del dropshipper (con su precio retail vs costo mayorista)
8. Ganancia cobrada Unistore mayorista = sum(precio_mayorista * qty) Unidrop ML + TN
9. Imagen + EAN + nombre del producto

Datos suficientes para que Unistore decida si subir/bajar el PVP mayorista
sin perder volumen, y para que los dropshippers vean dónde tienen margen.
"""
from __future__ import annotations

import logging

from app.db.engines import get_engine
from app.services._utils import q, resolve_window
from app.services.profit_engine import cost_index_unistore, calc_profit
from app.utils.tz import now_ar

log = logging.getLogger("unidata.wholesale")


def _avg(a: float, b: float, wa: int = 0, wb: int = 0) -> float:
    """Promedio ponderado por unidades. Si ambos pesos son 0, no hay datos."""
    if wa == 0 and wb == 0:
        return 0.0
    if wa == 0:
        return b
    if wb == 0:
        return a
    return (a * wa + b * wb) / (wa + wb)


def omnicanal_sku_table(
    period: str = "90d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Tabla omnicanal por SKU con todas las metricas comerciales."""
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    # --- 1) Unistore TN
    uni_tn = q(eng_uni, """
        SELECT oi.sku,
               MAX(oi.name)                       AS name,
               SUM(oi.quantity)::int              AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               (SUM(oi.quantity * oi.price)::float / NULLIF(SUM(oi.quantity), 0)) AS price_avg
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND oi.sku IS NOT NULL AND oi.sku NOT ILIKE '%PVA%'
        GROUP BY oi.sku
    """, {"days": days}) or []

    # --- 2) Unistore MELI (Fox Electronics retail propio)
    uni_ml = q(eng_uni, """
        SELECT mi.seller_sku AS sku,
               MAX(mi.title) AS name,
               SUM(mi.quantity)::int AS units,
               SUM(mi.quantity * mi.unit_price)::float AS revenue,
               (SUM(mi.quantity * mi.unit_price)::float / NULLIF(SUM(mi.quantity), 0)) AS price_avg
        FROM meli.meli_order_items mi
        JOIN meli.meli_orders mo ON mo.id = mi.order_id
        WHERE mi.seller_sku IS NOT NULL
          AND mo.date_created >= NOW() - make_interval(days => :days)
          AND mo.status IN ('paid','confirmed','shipped','delivered')
        GROUP BY mi.seller_sku
    """, {"days": days}) or []

    # --- 3) Unidrop TN: precio retail del dropshipper + costo mayorista (oi.cost)
    drp_tn = []
    try:
        drp_tn = q(eng_drp, """
            SELECT oi.sku,
                   MAX(oi.name) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue_retail,
                   (SUM(oi.quantity * oi.price)::float / NULLIF(SUM(oi.quantity), 0)) AS price_retail_avg,
                   SUM(oi.quantity * COALESCE(oi.cost, 0))::float AS revenue_mayorista,
                   (SUM(oi.quantity * COALESCE(oi.cost, 0))::float / NULLIF(SUM(oi.quantity), 0)) AS cost_avg
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        """, {"days": days}) or []
    except Exception as e:
        log.warning("drp_tn fail: %s", e)

    # --- 4) Unidrop MELI: precio retail (unitPrice) + costo mayorista (unitCost)
    drp_ml = []
    try:
        drp_ml = q(eng_drp, """
            SELECT oi."sellerSku" AS sku,
                   MAX(oi.title) AS name,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi."unitPrice")::float AS revenue_retail,
                   (SUM(oi.quantity * oi."unitPrice")::float / NULLIF(SUM(oi.quantity), 0)) AS price_retail_avg,
                   SUM(oi.quantity * oi."unitCost")::float AS revenue_mayorista,
                   (SUM(oi.quantity * oi."unitCost")::float / NULLIF(SUM(oi.quantity), 0)) AS cost_avg
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" IS NOT NULL
              AND o."dateCreated" >= NOW() - make_interval(days => :days)
              AND o.status IN ('paid','partially_refunded')
            GROUP BY oi."sellerSku"
        """, {"days": days}) or []
    except Exception as e:
        log.warning("drp_ml fail: %s", e)

    # --- Merge inicial: registrar todos los SKUs activos
    by_sku: dict[str, dict] = {}

    def upsert(sku: str) -> dict | None:
        s = (sku or "").strip()
        if not s:
            return None
        if s not in by_sku:
            by_sku[s] = {
                "sku": s,
                "name": None,
                "unistore_tn": {"units": 0, "revenue": 0.0, "price_avg": 0.0},
                "unistore_ml": {"units": 0, "revenue": 0.0, "price_avg": 0.0},
                "unidrop_tn":  {"units": 0, "revenue_retail": 0.0, "price_retail_avg": 0.0,
                                "revenue_mayorista": 0.0, "cost_avg": 0.0},
                "unidrop_ml":  {"units": 0, "revenue_retail": 0.0, "price_retail_avg": 0.0,
                                "revenue_mayorista": 0.0, "cost_avg": 0.0},
            }
        return by_sku[s]

    for sku, name, units, revenue, price_avg in uni_tn:
        d = upsert(sku)
        if d is None: continue
        d["name"] = d["name"] or name
        d["unistore_tn"] = {
            "units": int(units or 0),
            "revenue": round(float(revenue or 0), 0),
            "price_avg": round(float(price_avg or 0), 0),
        }
    for sku, name, units, revenue, price_avg in uni_ml:
        d = upsert(sku)
        if d is None: continue
        d["name"] = d["name"] or name
        d["unistore_ml"] = {
            "units": int(units or 0),
            "revenue": round(float(revenue or 0), 0),
            "price_avg": round(float(price_avg or 0), 0),
        }
    for sku, name, units, rev_retail, price_retail_avg, rev_may, cost_avg in drp_tn:
        d = upsert(sku)
        if d is None: continue
        d["name"] = d["name"] or name
        d["unidrop_tn"] = {
            "units": int(units or 0),
            "revenue_retail": round(float(rev_retail or 0), 0),
            "price_retail_avg": round(float(price_retail_avg or 0), 0),
            "revenue_mayorista": round(float(rev_may or 0), 0),
            "cost_avg": round(float(cost_avg or 0), 0),
        }
    for sku, name, units, rev_retail, price_retail_avg, rev_may, cost_avg in drp_ml:
        d = upsert(sku)
        if d is None: continue
        d["name"] = d["name"] or name
        d["unidrop_ml"] = {
            "units": int(units or 0),
            "revenue_retail": round(float(rev_retail or 0), 0),
            "price_retail_avg": round(float(price_retail_avg or 0), 0),
            "revenue_mayorista": round(float(rev_may or 0), 0),
            "cost_avg": round(float(cost_avg or 0), 0),
        }

    # --- Enriquecimiento: imagen + EAN del catalogo Unistore TN
    sku_list = list(by_sku.keys())
    images_ean: dict[str, dict] = {}
    if sku_list:
        # Postgres no maneja bien IN con miles de elementos; chunked = OK
        CHUNK = 500
        for i in range(0, len(sku_list), CHUNK):
            chunk = sku_list[i:i + CHUNK]
            try:
                rows = q(eng_uni, """
                    SELECT pv.sku,
                           COALESCE(MAX(pv.barcode), '') AS ean,
                           MAX(p.name) AS name_tn,
                           (SELECT pi.src FROM tienda_nube."ProductImage" pi
                            WHERE pi."productId" = MAX(p.id)
                            ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
                    FROM tienda_nube."ProductVariant" pv
                    JOIN tienda_nube."Product" p ON p.id = pv."productId"
                    WHERE pv.sku = ANY(:skus)
                    GROUP BY pv.sku
                """, {"skus": chunk}) or []
                for sku, ean, name_tn, imagen in rows:
                    images_ean[sku] = {
                        "ean": ean or "",
                        "name_tn": name_tn,
                        "imagen": imagen or "",
                    }
            except Exception as e:
                log.warning("image/ean chunk %d fail: %s", i, e)

    # --- Cost index Unistore (importacion)
    cost_idx = cost_index_unistore()

    # --- Calcular metricas derivadas por SKU
    items_out = []
    for sku, d in by_sku.items():
        utn = d["unistore_tn"]; uml = d["unistore_ml"]
        dtn = d["unidrop_tn"];  dml = d["unidrop_ml"]
        units_total = utn["units"] + uml["units"] + dtn["units"] + dml["units"]
        if units_total == 0:
            continue

        # Costo de importacion Unistore (lo que cuesta meter una unidad al pais)
        cost_rec = cost_idx.get(sku.strip().lower())
        costo_import_sin_iva = None
        costo_import_con_iva = None
        if cost_rec:
            costo_import_sin_iva = float(cost_rec.get("costo_sin_iva") or 0) or None
            costo_import_con_iva = float(cost_rec.get("costo_con_iva") or costo_import_sin_iva or 0) or None

        # Precio retail Unistore ponderado por unidades
        units_uni = utn["units"] + uml["units"]
        if units_uni > 0:
            rev_uni = utn["revenue"] + uml["revenue"]
            precio_retail_unistore = rev_uni / units_uni
        else:
            precio_retail_unistore = 0.0

        # Precio retail Unidrop ponderado por unidades
        units_drp = dtn["units"] + dml["units"]
        if units_drp > 0:
            rev_drp = dtn["revenue_retail"] + dml["revenue_retail"]
            precio_retail_unidrop = rev_drp / units_drp
        else:
            precio_retail_unidrop = 0.0

        # Costo mayorista (lo que paga el dropshipper a Unistore) ponderado por unidades
        if units_drp > 0:
            rev_may = dtn["revenue_mayorista"] + dml["revenue_mayorista"]
            precio_mayorista_avg = rev_may / units_drp if rev_may > 0 else 0.0
        else:
            precio_mayorista_avg = 0.0
            rev_may = 0.0

        # Markups y margenes
        markup_retail_unistore_pct = None
        markup_mayorista_pct = None
        markup_drp_pct = None
        margen_retail_unistore_pct = None
        margen_drp_pct = None
        ganancia_retail_unistore = None
        ganancia_mayorista_unistore = round(rev_may, 0) if rev_may > 0 else 0.0

        # Markup retail Unistore: (precio_retail - costo_importacion) / costo_importacion
        if costo_import_con_iva and precio_retail_unistore > 0:
            markup_retail_unistore_pct = round(
                (precio_retail_unistore - costo_import_con_iva) / costo_import_con_iva * 100, 1
            )

        # Markup mayorista Unistore: (precio_mayorista - costo_importacion) / costo_importacion
        if costo_import_con_iva and precio_mayorista_avg > 0:
            markup_mayorista_pct = round(
                (precio_mayorista_avg - costo_import_con_iva) / costo_import_con_iva * 100, 1
            )

        # Markup dropshipper: (precio_retail_drp - costo_mayorista) / costo_mayorista
        if precio_mayorista_avg > 0 and precio_retail_unidrop > 0:
            markup_drp_pct = round(
                (precio_retail_unidrop - precio_mayorista_avg) / precio_mayorista_avg * 100, 1
            )
            # Margen dropshipper: (retail - mayorista) / retail
            margen_drp_pct = round(
                (precio_retail_unidrop - precio_mayorista_avg) / precio_retail_unidrop * 100, 1
            )

        # Ganancia retail Unistore via calc_profit
        if costo_import_con_iva and units_uni > 0 and (utn["revenue"] + uml["revenue"]) > 0:
            rev_uni_total = utn["revenue"] + uml["revenue"]
            pb = calc_profit(
                ingreso_bruto=rev_uni_total,
                costo_sin_iva=(costo_import_sin_iva or 0) * units_uni,
                costo_con_iva=costo_import_con_iva * units_uni,
                is_cash=False,
                iva_aliquot_override=cost_rec.get("iva_aliquot") if cost_rec else None,
            )
            ganancia_retail_unistore = round(pb.ganancia_neta, 0)
            margen_retail_unistore_pct = round(pb.margen_pct, 1)

        # Spread retail: Unidrop vs Unistore
        spread_retail_pct = None
        if precio_retail_unistore > 0 and precio_retail_unidrop > 0:
            spread_retail_pct = round(
                (precio_retail_unidrop - precio_retail_unistore) / precio_retail_unistore * 100, 1
            )

        # Distribucion de volumen
        share_unistore = round(units_uni / units_total * 100, 1) if units_total > 0 else 0

        enr = images_ean.get(sku, {})

        items_out.append({
            "sku": sku,
            "name": (d["name"] or enr.get("name_tn") or sku)[:140],
            "ean": enr.get("ean", ""),
            "imagen": enr.get("imagen", ""),

            # Volumen
            "units_total": units_total,
            "units_unistore": units_uni,
            "units_unidrop": units_drp,
            "share_unistore_pct": share_unistore,
            "share_unidrop_pct": round(100 - share_unistore, 1),

            # Por canal (detalle)
            "unistore_tn": utn,
            "unistore_ml": uml,
            "unidrop_tn": dtn,
            "unidrop_ml": dml,

            # Costo base
            "costo_importacion": round(costo_import_con_iva, 0) if costo_import_con_iva else None,
            "costo_importacion_sin_iva": round(costo_import_sin_iva, 0) if costo_import_sin_iva else None,

            # Precios promedio cross
            "precio_retail_unistore_avg": round(precio_retail_unistore, 0),
            "precio_retail_unidrop_avg": round(precio_retail_unidrop, 0),
            "precio_mayorista_avg": round(precio_mayorista_avg, 0),

            # Markups
            "markup_retail_unistore_pct": markup_retail_unistore_pct,
            "markup_mayorista_pct": markup_mayorista_pct,
            "markup_drp_pct": markup_drp_pct,

            # Margenes
            "margen_retail_unistore_pct": margen_retail_unistore_pct,
            "margen_drp_pct": margen_drp_pct,

            # Spread comparativo
            "spread_retail_pct": spread_retail_pct,

            # Ganancias absolutas
            "ganancia_retail_unistore": ganancia_retail_unistore,
            "ganancia_mayorista_unistore": ganancia_mayorista_unistore,
            "ganancia_total_unistore": (
                (ganancia_retail_unistore or 0) + (ganancia_mayorista_unistore or 0)
                if (ganancia_retail_unistore is not None or ganancia_mayorista_unistore)
                else None
            ),

            # Revenue totales del SKU
            "revenue_unistore_retail": round(utn["revenue"] + uml["revenue"], 0),
            "revenue_unidrop_retail": round(dtn["revenue_retail"] + dml["revenue_retail"], 0),
            "revenue_total_grupo": round(
                utn["revenue"] + uml["revenue"] + dtn["revenue_retail"] + dml["revenue_retail"], 0
            ),
        })

    items_out.sort(key=lambda x: -x["units_total"])

    # --- Resumen ejecutivo cross-canal
    total_units = sum(x["units_total"] for x in items_out)
    total_units_uni = sum(x["units_unistore"] for x in items_out)
    total_units_drp = sum(x["units_unidrop"] for x in items_out)
    revenue_unistore_retail_total = sum(x["revenue_unistore_retail"] for x in items_out)
    revenue_unidrop_retail_total = sum(x["revenue_unidrop_retail"] for x in items_out)
    ganancia_retail_uni_total = sum(x["ganancia_retail_unistore"] or 0 for x in items_out)
    ganancia_mayorista_uni_total = sum(x["ganancia_mayorista_unistore"] or 0 for x in items_out)
    ganancia_total_uni = ganancia_retail_uni_total + ganancia_mayorista_uni_total
    skus_con_cost_idx = sum(1 for x in items_out if x["costo_importacion"] is not None)
    skus_con_dato_mayorista = sum(1 for x in items_out if x["precio_mayorista_avg"] > 0)

    margen_drp_vals = [x["margen_drp_pct"] for x in items_out if x["margen_drp_pct"] is not None]
    markup_mayorista_vals = [x["markup_mayorista_pct"] for x in items_out if x["markup_mayorista_pct"] is not None]
    spread_vals = [x["spread_retail_pct"] for x in items_out if x["spread_retail_pct"] is not None]

    summary = {
        "total_skus": len(items_out),
        "skus_con_cost_idx": skus_con_cost_idx,
        "skus_con_dato_mayorista": skus_con_dato_mayorista,
        "total_units": total_units,
        "total_units_unistore": total_units_uni,
        "total_units_unidrop": total_units_drp,
        "revenue_unistore_retail_total": round(revenue_unistore_retail_total, 0),
        "revenue_unidrop_retail_total": round(revenue_unidrop_retail_total, 0),
        "ganancia_retail_unistore_total": round(ganancia_retail_uni_total, 0),
        "ganancia_mayorista_unistore_total": round(ganancia_mayorista_uni_total, 0),
        "ganancia_total_unistore": round(ganancia_total_uni, 0),
        "margen_drp_avg_pct": round(sum(margen_drp_vals) / max(1, len(margen_drp_vals)), 1) if margen_drp_vals else 0,
        "markup_mayorista_avg_pct": round(sum(markup_mayorista_vals) / max(1, len(markup_mayorista_vals)), 1) if markup_mayorista_vals else 0,
        "spread_retail_avg_pct": round(sum(spread_vals) / max(1, len(spread_vals)), 1) if spread_vals else 0,
    }

    return {
        "period": period,
        "days": days,
        "skus": items_out,
        "summary": summary,
        "generated_at": now_ar().isoformat(),
        "column_glossary": _column_glossary(),
        "todo": [
            "Curva precio-volumen mayorista mensual por SKU (regresion)",
            "Detectar cambios escalon de unitCost y correlacionar con volumen Unidrop",
            "Mapeo de equivalencias de SKU cross-canal",
            "Comparar elasticidad retail vs mayorista por SKU",
        ],
    }


def _column_glossary() -> list[dict]:
    """Diccionario que el frontend usa para mostrar tooltips por columna."""
    return [
        {"key": "units_total", "label": "Unidades totales", "desc": "Suma cross-canal Unistore TN + Unistore ML + Unidrop TN + Unidrop ML."},
        {"key": "share_uni_drp", "label": "Mix Unistore/Unidrop", "desc": "% del volumen del SKU que mueve cada origen. Mide quien depende mas del SKU."},
        {"key": "costo_importacion", "label": "Costo importacion", "desc": "Costo unitario Unistore con IVA, segun costs.db (cost_index). Base para todos los markups."},
        {"key": "precio_retail_unistore_avg", "label": "Precio retail Unistore", "desc": "Promedio ponderado por unidades de TN propia + ML Fox Electronics."},
        {"key": "precio_retail_unidrop_avg", "label": "Precio retail Unidrop", "desc": "Promedio ponderado por unidades del precio que los dropshippers le ponen al consumidor final (TN + ML)."},
        {"key": "precio_mayorista_avg", "label": "Precio mayorista", "desc": "Promedio que el dropshipper paga a Unistore. ML usa OrderItemMercadoLibre.unitCost, TN usa tienda_nube_order_items.cost."},
        {"key": "markup_retail_unistore_pct", "label": "Markup retail Unistore %", "desc": "(precio_retail_unistore - costo_importacion) / costo_importacion. Cuanto vez sobre tu costo cobras directo al consumidor."},
        {"key": "markup_mayorista_pct", "label": "Markup mayorista %", "desc": "(precio_mayorista - costo_importacion) / costo_importacion. Cuanto vez sobre tu costo le cobras al dropshipper."},
        {"key": "markup_drp_pct", "label": "Markup dropshipper %", "desc": "(precio_retail_unidrop - precio_mayorista) / precio_mayorista. Cuanto le saca el dropshipper sobre lo que te paga."},
        {"key": "margen_retail_unistore_pct", "label": "Margen retail Unistore %", "desc": "Ganancia neta calc_profit (descontando IVA, comisiones, gateway) / revenue retail Unistore."},
        {"key": "margen_drp_pct", "label": "Margen dropshipper %", "desc": "(precio_retail_unidrop - precio_mayorista) / precio_retail_unidrop. Visto desde el lado del cliente final."},
        {"key": "spread_retail_pct", "label": "Spread retail %", "desc": "Cuanto mas caro (o barato) vende el dropshipper vs el precio de Unistore directo. Si es positivo, Unistore es opcion mas barata."},
        {"key": "ganancia_retail_unistore", "label": "Ganancia retail Unistore", "desc": "Ganancia neta total del retail propio (TN + ML) en el periodo. Motor calc_profit."},
        {"key": "ganancia_mayorista_unistore", "label": "Ganancia mayorista Unistore", "desc": "Total cobrado a dropshippers en el periodo = sum(precio_mayorista * unidades) cross TN+ML Unidrop."},
        {"key": "ganancia_total_unistore", "label": "Ganancia total Unistore", "desc": "Ganancia retail + ganancia mayorista del SKU en el periodo."},
    ]


# Compat: la version anterior se llamaba wholesale_sku_table — alias
def wholesale_sku_table(period_days: int = 90, limit: int = 200) -> dict:
    """Wrapper de compat por si el front viejo todavia llama al endpoint anterior.
    Mapeamos period_days al closest period bucket."""
    period_map = {7: "7d", 30: "30d", 90: "90d", 180: "12m", 365: "12m"}
    period = period_map.get(period_days, "90d")
    return omnicanal_sku_table(period=period)
