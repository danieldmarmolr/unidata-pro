"""
Heatmap de stock por SKU x area de deposito.

Replica el panel cross-DB del PowerBI (p6-7): los SKUs top en stock cruzados
con las areas de deposito (Digip). Permite identificar:
- SKUs concentrados en una sola area (riesgo logistico)
- Areas con poco surtido vs areas con catalogo completo
- SKUs sin stock en zonas comerciales clave

NOTA: usa StockDetalle (stock fisico per area, incluye reservado/bloqueado).
La distribucion por area solo existe en StockDetalle; digip.Stock es agregado
por SKU sin dimension area. El KPI canonico "stock disponible" del sistema
sigue siendo digip.Stock.unidadesDisponibles — el heatmap es una vista
operativa complementaria de distribucion fisica.
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.stock_heatmap")


def stock_heatmap(top_skus: int = 30, min_units: int = 5) -> dict:
    """Devuelve grilla SKU x area con unidades disponibles.

    - top_skus: cantidad de SKUs a mostrar (los de mayor stock total)
    - min_units: filtrar areas con menos de N unidades para no ensuciar
    """
    eng = get_engine("unistore")

    # Areas (columnas)
    areas_rows = q(eng, """
        SELECT COALESCE("areaDescripcion", '(sin area)') AS area,
               SUM(unidades)::int AS total
        FROM digip."StockDetalle"
        GROUP BY 1
        HAVING SUM(unidades) > 0
        ORDER BY total DESC
        LIMIT 12
    """) or []
    areas = [r[0] for r in areas_rows]
    area_totals = {r[0]: int(r[1] or 0) for r in areas_rows}

    if not areas:
        return _empty(top_skus)

    # Top SKUs por stock total (filas)
    skus_rows = q(eng, """
        SELECT sd."articuloCodigo" AS sku,
               COALESCE(MAX(p.name), sd."articuloCodigo") AS nombre,
               COALESCE(MAX(p.brand), '') AS brand,
               SUM(sd.unidades)::int AS total
        FROM digip."StockDetalle" sd
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = sd."articuloCodigo"
        LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
        GROUP BY sd."articuloCodigo"
        HAVING SUM(sd.unidades) > 0
        ORDER BY total DESC
        LIMIT :n
    """, {"n": top_skus}) or []

    if not skus_rows:
        return _empty(top_skus)

    sku_keys = [r[0] for r in skus_rows]

    # Grilla SKU x area
    cells_rows = q(eng, """
        SELECT "articuloCodigo" AS sku,
               COALESCE("areaDescripcion", '(sin area)') AS area,
               SUM(unidades)::int AS units
        FROM digip."StockDetalle"
        WHERE "articuloCodigo" = ANY(:skus)
        GROUP BY 1, 2
    """, {"skus": sku_keys}) or []

    grid: dict[str, dict[str, int]] = {}
    for sku, area, units in cells_rows:
        if sku not in grid:
            grid[sku] = {}
        grid[sku][area] = int(units or 0)

    # Build rows en mismo orden de skus_rows
    rows_out = []
    for sku, nombre, brand, total in skus_rows:
        cells = grid.get(sku, {})
        rows_out.append({
            "sku": sku,
            "nombre": (nombre or sku)[:60],
            "brand": brand or "",
            "total": int(total or 0),
            "cells": [
                {"area": a, "units": int(cells.get(a, 0))}
                for a in areas
            ],
        })

    # Max para escala de color
    max_units = max(
        (c["units"] for r in rows_out for c in r["cells"]),
        default=1,
    ) or 1

    return {
        "areas": [
            {"name": a, "total": area_totals.get(a, 0)} for a in areas
        ],
        "skus": rows_out,
        "max_units": max_units,
        "total_stock": sum(area_totals.values()),
        "top_skus_param": top_skus,
        "generated_at": now_ar().isoformat(),
    }


def _empty(top_skus: int) -> dict:
    return {
        "areas": [],
        "skus": [],
        "max_units": 0,
        "total_stock": 0,
        "top_skus_param": top_skus,
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Vista "Por SKU" - tabla operativa de stock + ventas + ganancia + riesgo
# Replica el panel PowerBI "Heatmap por SKU de acuerdo al Stock Actual"
# ============================================================

def stock_heatmap_by_sku(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Devuelve una fila por SKU con columnas operativas:
    sku, nombre, imagen, uv (unidades vendidas en periodo), uv_diaria_avg,
    uv_diaria_std (desviacion estandar diaria), stock (unidadesDisponibles),
    precio_avg, costo_avg, markup (ganancia neta post-fees post-IVA per unit),
    markup_pct (markup/costo), total_markup (markup * uv = ganancia total),
    tiempo_riesgo_dias (stock / uv_diaria_avg) y facturacion (revenue periodo).

    Solo SKUs con ventas en el periodo o con stock disponible > 0.
    Ordenado por facturacion descendente.
    """
    from app.services._utils import resolve_window
    from app.services.profit_engine import cost_index_unistore, calc_profit

    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    # 1) Ventas agregadas por SKU (TN) en el periodo + stddev diaria + precio promedio.
    # NOTA: el SELECT externo NO joinea OrderItem (eso explotaba la cardinalidad
    # con miles de filas por SKU). El nombre / imagen / brand vienen del enrich
    # batch que hacemos despues con todos los SKUs en una sola query.
    sales_rows = q(eng, """
        WITH daily AS (
            SELECT oi.sku,
                   DATE(o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
                   SUM(oi.quantity)::int AS qty_dia,
                   SUM(oi.quantity * oi.price)::float AS rev_dia,
                   MAX(oi.name) AS last_name
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :days)
              AND oi.sku IS NOT NULL
              AND oi.sku NOT ILIKE '%PVA%'
            GROUP BY 1, 2
        )
        SELECT d.sku,
               MAX(d.last_name) AS nombre_item,
               SUM(d.qty_dia)::int AS uv,
               SUM(d.rev_dia)::float AS facturacion,
               (SUM(d.qty_dia)::float / NULLIF(:days, 0)) AS uv_diaria_avg,
               COALESCE(STDDEV_SAMP(d.qty_dia), 0)::float AS uv_diaria_std,
               (SUM(d.rev_dia)::float / NULLIF(SUM(d.qty_dia), 0)) AS precio_avg
        FROM daily d
        GROUP BY d.sku
    """, p) or []

    # 2) Stock disponible por SKU (digip.Stock canonical)
    stock_rows = q(eng, """
        SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock
        FROM digip."Stock"
        WHERE COALESCE("unidadesDisponibles", 0) > 0
    """) or []
    stock_map = {r[0]: int(r[1] or 0) for r in stock_rows}

    # 3) Enrich batch: nombre + brand + imagen para TODOS los SKUs en una sola query.
    # Evita el N+1 de la version anterior (1500+ queries para SKUs sin ventas).
    all_skus = set(stock_map.keys()) | {r[0] for r in sales_rows if r and r[0]}
    info_map: dict[str, dict] = {}
    if all_skus:
        info_rows = q(eng, """
            SELECT pv.sku,
                   MAX(p.name) AS name,
                   COALESCE(MAX(p.brand), '') AS brand,
                   (SELECT pi.src FROM tienda_nube."ProductImage" pi
                    WHERE pi."productId" = MAX(p.id)
                    ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
            FROM tienda_nube."ProductVariant" pv
            LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
            WHERE pv.sku = ANY(:skus)
            GROUP BY pv.sku
        """, {"skus": list(all_skus)}) or []
        for sku, name, brand, imagen in info_rows:
            info_map[sku] = {"name": name, "brand": brand or "", "imagen": imagen or ""}

    cost_idx = cost_index_unistore()

    items: list[dict] = []
    skus_seen: set[str] = set()
    for r in sales_rows:
        sku, nombre_item, uv, facturacion, uv_diaria_avg, uv_diaria_std, precio_avg = r
        if not sku:
            continue
        skus_seen.add(sku)
        info = info_map.get(sku, {})

        uv_i = int(uv or 0)
        rev_f = float(facturacion or 0)
        precio_f = float(precio_avg or 0)
        uv_avg_f = float(uv_diaria_avg or 0)
        uv_std_f = float(uv_diaria_std or 0)
        stock_i = stock_map.get(sku, 0)

        # Costo + markup via calc_profit (post-fees post-IVA — coherente con resto del sistema)
        cost_rec = cost_idx.get((sku or "").strip().lower())
        costo_unit = 0.0
        markup_unit: float | None = None
        markup_pct: float | None = None
        total_markup: float | None = None
        if cost_rec and cost_rec.get("costo_con_iva") and uv_i > 0 and rev_f > 0:
            sin_iva = float(cost_rec.get("costo_sin_iva") or 0)
            con_iva = float(cost_rec.get("costo_con_iva") or sin_iva)
            costo_unit = con_iva
            pb = calc_profit(
                ingreso_bruto=rev_f,
                costo_sin_iva=sin_iva * uv_i,
                costo_con_iva=con_iva * uv_i,
                is_cash=False,
                iva_aliquot_override=cost_rec.get("iva_aliquot"),
            )
            total_markup = float(pb.ganancia_neta)
            markup_unit = total_markup / uv_i if uv_i > 0 else 0
            if costo_unit > 0:
                markup_pct = markup_unit / costo_unit * 100

        # Tiempo riesgo: dias hasta stockout al ritmo del periodo
        tiempo_riesgo: float | None = None
        if uv_avg_f > 0 and stock_i > 0:
            tiempo_riesgo = stock_i / uv_avg_f
        elif stock_i == 0:
            tiempo_riesgo = 0.0  # ya en stockout

        nombre_final = info.get("name") or nombre_item or sku
        items.append({
            "sku": sku,
            "nombre": str(nombre_final)[:80],
            "brand": info.get("brand") or "",
            "imagen": info.get("imagen") or "",
            "uv": uv_i,
            "uv_diaria_avg": round(uv_avg_f, 1),
            "uv_diaria_std": round(uv_std_f, 1),
            "stock": stock_i,
            "precio_avg": round(precio_f, 1),
            "costo_avg": round(costo_unit, 1) if costo_unit > 0 else None,
            "markup": round(markup_unit, 1) if markup_unit is not None else None,
            "markup_pct": round(markup_pct, 1) if markup_pct is not None else None,
            "total_markup": round(total_markup, 0) if total_markup is not None else None,
            "tiempo_riesgo_dias": round(tiempo_riesgo, 1) if tiempo_riesgo is not None else None,
            "facturacion": round(rev_f, 0),
            "has_cost": markup_unit is not None,
        })

    # Agregamos SKUs CON STOCK pero sin ventas en el periodo (zero-velocity en deposito).
    # El enrich ya esta cargado en info_map (batch).
    for sku, stock_i in stock_map.items():
        if sku in skus_seen or stock_i <= 0:
            continue
        info = info_map.get(sku, {})
        items.append({
            "sku": sku,
            "nombre": str(info.get("name") or sku)[:80],
            "brand": info.get("brand") or "",
            "imagen": info.get("imagen") or "",
            "uv": 0,
            "uv_diaria_avg": 0.0,
            "uv_diaria_std": 0.0,
            "stock": stock_i,
            "precio_avg": 0.0,
            "costo_avg": None,
            "markup": None,
            "markup_pct": None,
            "total_markup": None,
            "tiempo_riesgo_dias": None,  # sin velocidad, no aplica
            "facturacion": 0,
            "has_cost": False,
        })

    # Orden default: facturacion desc
    items.sort(key=lambda x: -(x.get("facturacion") or 0))

    summary = {
        "total_facturacion": round(sum(it["facturacion"] for it in items), 0),
        "total_markup": round(sum(it["total_markup"] or 0 for it in items), 0),
        "total_stock_units": sum(it["stock"] for it in items),
        "total_uv": sum(it["uv"] for it in items),
        "skus_con_ventas": sum(1 for it in items if it["uv"] > 0),
        "skus_sin_stock": sum(1 for it in items if it["stock"] == 0),
        "skus_riesgo_alto": sum(1 for it in items if it["tiempo_riesgo_dias"] is not None and it["tiempo_riesgo_dias"] < 7),
        "skus_riesgo_medio": sum(1 for it in items if it["tiempo_riesgo_dias"] is not None and 7 <= it["tiempo_riesgo_dias"] < 14),
        "skus_stock_muerto": sum(1 for it in items if it["uv"] == 0 and it["stock"] > 0),
        "skus_con_costo": sum(1 for it in items if it["has_cost"]),
    }

    return {
        "period": period,
        "days": days,
        "rows": items,
        "summary": summary,
        "generated_at": now_ar().isoformat(),
    }
