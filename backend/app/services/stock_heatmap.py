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
