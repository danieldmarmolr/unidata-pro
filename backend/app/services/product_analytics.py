"""
Analisis avanzado de productos - decisiones de oferta, compras y marketing.

Servicios disponibles:
- abc_analysis(period): clasificacion Pareto 80/15/5 por revenue
- xyz_analysis(period): clasificacion por volatilidad de demanda
- abc_xyz_matrix(period): cross 9 cuadrantes con accion sugerida
- inventory_rotation(period): days of inventory por SKU
- stockout_risk(period, threshold_days): SKUs en riesgo de agotamiento
- cross_sell_pairs(period): top pares de SKUs comprados juntos
- product_trends(period_days): SKUs con growth/decline >30%
- returns_rate_by_sku(period): % de devoluciones por SKU
"""
from __future__ import annotations

import logging
import math

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q, resolve_window

log = logging.getLogger("unidata.product_analytics")


# ============================================================
# ABC clasification (Pareto 80/15/5 por revenue)
# ============================================================

def abc_analysis(period: str = "90d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Clasifica SKUs en A/B/C segun acumulado de revenue (Pareto).

    - A: hasta 80% acumulado
    - B: 80-95% acumulado
    - C: 95-100% acumulado (cola larga)
    """
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]

    rows = q(eng, """
        SELECT oi.sku,
               MAX(oi.name) AS nombre,
               COALESCE(MAX(pv.barcode), '') AS ean,
               SUM(oi.quantity * oi.price)::float AS revenue,
               SUM(oi.quantity)::int AS unidades,
               COUNT(DISTINCT oi."orderId")::int AS ordenes,
               COUNT(DISTINCT o."customerId")::int AS clientes
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = oi.sku
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :d)
          AND oi.sku IS NOT NULL
        GROUP BY oi.sku
        ORDER BY revenue DESC NULLS LAST
    """, {"d": days}) or []

    total_rev = sum(float(r[3] or 0) for r in rows) or 1.0

    skus: list[dict] = []
    cumulative = 0.0
    for i, r in enumerate(rows):
        sku, nombre, ean, rev, units, orders, clients = r
        rev_f = float(rev or 0)
        cumulative += rev_f
        pct_acum = cumulative / total_rev * 100
        # Clasificacion
        if pct_acum <= 80:
            clase = "A"
        elif pct_acum <= 95:
            clase = "B"
        else:
            clase = "C"
        skus.append({
            "rank": i + 1,
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "ean": ean or "",
            "revenue": round(rev_f, 2),
            "unidades": int(units or 0),
            "ordenes": int(orders or 0),
            "clientes": int(clients or 0),
            "pct_revenue": round(rev_f / total_rev * 100, 2),
            "pct_acum": round(pct_acum, 2),
            "clase": clase,
        })

    counts = {"A": 0, "B": 0, "C": 0}
    revs = {"A": 0.0, "B": 0.0, "C": 0.0}
    for s in skus:
        counts[s["clase"]] += 1
        revs[s["clase"]] += s["revenue"]

    return {
        "period": period,
        "days": days,
        "total_skus": len(skus),
        "total_revenue": round(total_rev, 2),
        "classes": {
            "A": {
                "count": counts["A"],
                "pct_skus": round(counts["A"] / len(skus) * 100, 1) if skus else 0,
                "revenue": round(revs["A"], 2),
                "pct_revenue": round(revs["A"] / total_rev * 100, 1),
                "label": "Clase A · Vitales",
                "desc": "20% que genera 80% del revenue · prioridad maxima",
                "color": "#10b981",  # emerald
            },
            "B": {
                "count": counts["B"],
                "pct_skus": round(counts["B"] / len(skus) * 100, 1) if skus else 0,
                "revenue": round(revs["B"], 2),
                "pct_revenue": round(revs["B"] / total_rev * 100, 1),
                "label": "Clase B · Importantes",
                "desc": "30% que genera 15% del revenue · gestion normal",
                "color": "#f59e0b",  # amber
            },
            "C": {
                "count": counts["C"],
                "pct_skus": round(counts["C"] / len(skus) * 100, 1) if skus else 0,
                "revenue": round(revs["C"], 2),
                "pct_revenue": round(revs["C"] / total_rev * 100, 1),
                "label": "Clase C · Cola larga",
                "desc": "50% que genera 5% del revenue · candidatos a discontinuar",
                "color": "#94a3b8",  # slate
            },
        },
        "skus": skus,
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# XYZ analysis (volatilidad de demanda) + ABC×XYZ matriz
# ============================================================

def xyz_analysis(period: str = "90d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Clasifica SKUs por volatilidad de demanda (CV = std/mean).

    - X: demanda estable (CV < 25%)
    - Y: fluctuante (CV 25-50%)
    - Z: erratica (CV > 50%)
    """
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]

    # Para cada SKU, ventas diarias (ultimos N dias). CV requiere al menos 8 dias con ventas.
    rows = q(eng, """
        WITH daily AS (
            SELECT oi.sku,
                   DATE(o."createdAt") AS dia,
                   SUM(oi.quantity)::float AS qty_dia
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1, 2
        )
        SELECT sku,
               COUNT(*) AS dias_con_ventas,
               AVG(qty_dia)::float AS mean_qty,
               STDDEV_SAMP(qty_dia)::float AS std_qty,
               SUM(qty_dia)::int AS total_unidades
        FROM daily
        GROUP BY sku
        HAVING COUNT(*) >= 4
    """, {"d": days}) or []

    skus_xyz: dict[str, dict] = {}
    for r in rows:
        sku, days_with_sales, mean, std, total = r
        mean_f = float(mean or 0)
        std_f = float(std or 0)
        cv = (std_f / mean_f) if mean_f > 0 else 0  # coefficient of variation
        if cv < 0.25:
            clase = "X"
        elif cv < 0.50:
            clase = "Y"
        else:
            clase = "Z"
        skus_xyz[sku] = {
            "days_with_sales": int(days_with_sales or 0),
            "mean_qty": round(mean_f, 2),
            "std_qty": round(std_f, 2),
            "cv": round(cv, 3),
            "clase_xyz": clase,
            "total_unidades": int(total or 0),
        }
    return {"skus_xyz": skus_xyz, "period": period, "days": days}


def abc_xyz_matrix(period: str = "90d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Cruza ABC × XYZ -> matriz 9 cuadrantes con accion sugerida."""
    abc = abc_analysis(period, from_iso, to_iso)
    xyz = xyz_analysis(period, from_iso, to_iso)["skus_xyz"]

    matrix: dict[str, list[dict]] = {
        "AX": [], "AY": [], "AZ": [],
        "BX": [], "BY": [], "BZ": [],
        "CX": [], "CY": [], "CZ": [],
    }
    # Cells: combinacion ABC × XYZ. Si el SKU no tiene XYZ (poca data), se le pone "Y" por default.
    for s in abc["skus"]:
        xyz_info = xyz.get(s["sku"], {"clase_xyz": "Y", "cv": None})
        cell = f"{s['clase']}{xyz_info['clase_xyz']}"
        matrix[cell].append({**s, **xyz_info})

    # Accion sugerida por cuadrante
    actions = {
        "AX": {"label": "Estrella · Auto-stock", "color": "#059669", "desc": "Alto valor + demanda estable. Asegurar reposicion automatica."},
        "AY": {"label": "Joya · Stock alto", "color": "#10b981", "desc": "Alto valor pero fluctuante. Stock de seguridad +20%."},
        "AZ": {"label": "Riesgo · Analisis caso", "color": "#ef4444", "desc": "Alto valor erratico. Revisar cada caso, podria ser one-shot."},
        "BX": {"label": "Confiable · Stock medio", "color": "#22c55e", "desc": "Importante y estable. Reposicion segun consumo."},
        "BY": {"label": "Standard", "color": "#84cc16", "desc": "Gestion normal sin sobresaltos."},
        "BZ": {"label": "Reactivo", "color": "#f59e0b", "desc": "Reactivar marketing si baja."},
        "CX": {"label": "Cash cow · Bajo costo", "color": "#06b6d4", "desc": "Bajo valor pero estable. Mantener pero no invertir mas."},
        "CY": {"label": "Cola larga", "color": "#a3a3a3", "desc": "Baja prioridad. Revisar viabilidad."},
        "CZ": {"label": "Discontinuar", "color": "#dc2626", "desc": "Bajo valor erratico. Candidatos a eliminar del catalogo."},
    }

    cells_arr = []
    for k, items in matrix.items():
        rev = sum(float(it["revenue"]) for it in items)
        cells_arr.append({
            "cell": k,
            "abc": k[0],
            "xyz": k[1],
            "count": len(items),
            "revenue": round(rev, 2),
            "label": actions[k]["label"],
            "color": actions[k]["color"],
            "desc": actions[k]["desc"],
            "top_skus": sorted(items, key=lambda x: -x["revenue"])[:5],
        })

    return {
        "period": period,
        "matrix": cells_arr,
        "total_skus": sum(len(v) for v in matrix.values()),
        "total_revenue": abc["total_revenue"],
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Inventory rotation (Days of Inventory)
# ============================================================

def inventory_rotation(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Days of inventory = stock_actual / ventas_promedio_diarias.

    Buckets:
    - Rapido: < 30 dias
    - Normal: 30-90
    - Lento: 90-180
    - Muerto: > 180 (capital inmovilizado)
    """
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]

    rows = q(eng, """
        WITH ventas AS (
            SELECT oi.sku,
                   SUM(oi.quantity)::float AS units_periodo,
                   MAX(oi.name) AS nombre
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1
        ),
        stock AS (
            SELECT "articuloCodigo" AS sku, SUM(unidades)::float AS stock
            FROM digip."StockDetalle"
            GROUP BY 1
        )
        SELECT v.sku,
               COALESCE(v.nombre, v.sku) AS nombre,
               COALESCE(MAX(pv.barcode), '') AS ean,
               COALESCE(s.stock, 0) AS stock_actual,
               v.units_periodo,
               (v.units_periodo / :d::float) AS ventas_dia_avg
        FROM ventas v
        LEFT JOIN stock s ON s.sku = v.sku
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = v.sku
        GROUP BY v.sku, v.nombre, s.stock, v.units_periodo
        HAVING COALESCE(s.stock, 0) > 0
    """, {"d": days}) or []

    items = []
    counts = {"rapido": 0, "normal": 0, "lento": 0, "muerto": 0}
    for r in rows:
        sku, nombre, ean, stock, units, ventas_dia = r
        stock_f = float(stock or 0)
        ventas_dia_f = float(ventas_dia or 0)
        if ventas_dia_f > 0:
            doi = stock_f / ventas_dia_f  # days of inventory
        else:
            doi = 9999  # sin ventas en periodo
        if doi < 30:
            bucket = "rapido"
        elif doi < 90:
            bucket = "normal"
        elif doi < 180:
            bucket = "lento"
        else:
            bucket = "muerto"
        counts[bucket] += 1
        items.append({
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "ean": ean or "",
            "stock_actual": int(stock_f),
            "ventas_periodo": int(units or 0),
            "ventas_dia_avg": round(ventas_dia_f, 2),
            "days_of_inventory": round(doi, 1) if doi < 9999 else None,
            "bucket": bucket,
        })

    items.sort(key=lambda x: -(x["ventas_dia_avg"] or 0))

    return {
        "period": period,
        "buckets": {
            "rapido": {"count": counts["rapido"], "label": "Rápido (<30d)", "color": "#10b981"},
            "normal": {"count": counts["normal"], "label": "Normal (30-90d)", "color": "#06b6d4"},
            "lento": {"count": counts["lento"], "label": "Lento (90-180d)", "color": "#f59e0b"},
            "muerto": {"count": counts["muerto"], "label": "Muerto (>180d)", "color": "#ef4444"},
        },
        "skus": items,
        "total_skus_con_stock": len(items),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Stockout risk - SKUs que se agotan en menos de N dias
# ============================================================

def stockout_risk(threshold_days: int = 14, period: str = "30d") -> dict:
    """SKUs cuyo stock actual se agota en menos de threshold_days al ritmo
    de ventas del periodo."""
    rot = inventory_rotation(period=period)
    at_risk = [
        s for s in rot["skus"]
        if s["days_of_inventory"] is not None
        and s["days_of_inventory"] <= threshold_days
        and s["ventas_dia_avg"] > 0
    ]
    at_risk.sort(key=lambda x: x["days_of_inventory"])
    return {
        "threshold_days": threshold_days,
        "period": period,
        "count": len(at_risk),
        "skus": at_risk,
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Cross-sell pairs (market basket simple)
# ============================================================

def cross_sell_pairs(period: str = "90d", min_pairs: int = 3, top_n: int = 30) -> dict:
    """Top pares de SKUs que aparecen juntos en las mismas ordenes."""
    eng = get_engine("unistore")
    days = resolve_window(period, None, None)["days"]

    rows = q(eng, """
        WITH order_skus AS (
            SELECT oi."orderId", oi.sku, MAX(oi.name) AS name
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY oi."orderId", oi.sku
        ),
        pairs AS (
            SELECT a.sku AS sku_a, b.sku AS sku_b,
                   MAX(a.name) AS name_a, MAX(b.name) AS name_b,
                   COUNT(*)::int AS co_ocurrencias
            FROM order_skus a
            INNER JOIN order_skus b ON a."orderId" = b."orderId"
                                     AND a.sku < b.sku
            GROUP BY a.sku, b.sku
            HAVING COUNT(*) >= :min_p
        )
        SELECT sku_a, sku_b, name_a, name_b, co_ocurrencias
        FROM pairs
        ORDER BY co_ocurrencias DESC
        LIMIT :n
    """, {"d": days, "min_p": min_pairs, "n": top_n}) or []

    pairs = [{
        "sku_a": r[0],
        "sku_b": r[1],
        "name_a": (r[2] or r[0])[:60],
        "name_b": (r[3] or r[1])[:60],
        "co_ocurrencias": int(r[4] or 0),
    } for r in rows]

    return {
        "period": period,
        "min_pairs": min_pairs,
        "pairs": pairs,
        "total": len(pairs),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Trends - SKUs con growth o decline > 30%
# ============================================================

def product_trends(period_days: int = 30) -> dict:
    """Compara ventas del periodo actual vs periodo anterior identico.
    Flag growth (+30%) y decline (-30%).
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH actual AS (
            SELECT oi.sku, MAX(oi.name) AS nombre,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        ),
        anterior AS (
            SELECT oi.sku,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d2)
              AND o."createdAt" <  NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
        )
        SELECT a.sku, a.nombre,
               a.units AS units_actual, a.revenue AS rev_actual,
               COALESCE(p.units, 0) AS units_anterior, COALESCE(p.revenue, 0) AS rev_anterior
        FROM actual a
        LEFT JOIN anterior p ON p.sku = a.sku
        WHERE a.revenue > 0
        ORDER BY a.revenue DESC
        LIMIT 1000
    """, {"d": period_days, "d2": period_days * 2}) or []

    growing = []
    declining = []
    new_products = []  # ventas en periodo actual pero no en anterior

    for r in rows:
        sku, nombre, ua, ra, up, rp = r
        ra_f = float(ra or 0)
        rp_f = float(rp or 0)
        item = {
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "units_actual": int(ua or 0),
            "revenue_actual": round(ra_f, 2),
            "units_anterior": int(up or 0),
            "revenue_anterior": round(rp_f, 2),
        }
        if rp_f == 0:
            new_products.append({**item, "growth_pct": None})
        else:
            growth = (ra_f - rp_f) / rp_f * 100
            item["growth_pct"] = round(growth, 1)
            if growth >= 30:
                growing.append(item)
            elif growth <= -30:
                declining.append(item)

    growing.sort(key=lambda x: -(x.get("growth_pct") or 0))
    declining.sort(key=lambda x: x.get("growth_pct") or 0)
    new_products.sort(key=lambda x: -x["revenue_actual"])

    return {
        "period_days": period_days,
        "growing": {"count": len(growing), "skus": growing[:50]},
        "declining": {"count": len(declining), "skus": declining[:50]},
        "new_products": {"count": len(new_products), "skus": new_products[:50]},
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Returns rate por SKU
# ============================================================

# ============================================================
# ABC por margen (no solo revenue, considerando costo importado)
# ============================================================

def abc_margin(period: str = "90d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """ABC pero por margen estimado en lugar de revenue.
    Margen = revenue - (costo_unitario_importado * unidades).
    Costo viene de digip.ArticuloUnidadMedidaCodigo si existe, sino se estima
    como 60% del precio promedio.
    """
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]

    rows = q(eng, """
        WITH ventas AS (
            SELECT oi.sku, MAX(oi.name) AS nombre,
                   SUM(oi.quantity)::int AS unidades,
                   SUM(oi.quantity * oi.price)::float AS revenue,
                   AVG(oi.price)::float AS precio_avg
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1
        )
        SELECT v.sku, v.nombre,
               COALESCE(MAX(pv.barcode), '') AS ean,
               v.revenue, v.unidades, v.precio_avg
        FROM ventas v
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = v.sku
        GROUP BY v.sku, v.nombre, v.revenue, v.unidades, v.precio_avg
        ORDER BY v.revenue DESC NULLS LAST
    """, {"d": days}) or []

    # Estimar costo: usar 60% del precio promedio como heuristica conservadora
    # (en operativa real el dato viene de costs.db por SKU)
    items = []
    for r in rows:
        sku, nombre, ean, rev, units, precio = r
        rev_f = float(rev or 0)
        units_n = int(units or 0)
        precio_f = float(precio or 0)
        costo_unit_estimado = precio_f * 0.6
        costo_total_estimado = costo_unit_estimado * units_n
        margen = rev_f - costo_total_estimado
        margen_pct = (margen / rev_f * 100) if rev_f > 0 else 0
        items.append({
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "ean": ean or "",
            "revenue": round(rev_f, 2),
            "unidades": units_n,
            "precio_avg": round(precio_f, 2),
            "costo_estimado": round(costo_total_estimado, 2),
            "margen_estimado": round(margen, 2),
            "margen_pct": round(margen_pct, 1),
        })

    items.sort(key=lambda x: -x["margen_estimado"])
    total_margen = sum(it["margen_estimado"] for it in items) or 1.0

    classes_count = {"A": 0, "B": 0, "C": 0}
    classes_margen = {"A": 0.0, "B": 0.0, "C": 0.0}
    cumulative = 0.0
    for i, it in enumerate(items):
        cumulative += it["margen_estimado"]
        pct = cumulative / total_margen * 100
        if pct <= 80:
            it["clase_margen"] = "A"
        elif pct <= 95:
            it["clase_margen"] = "B"
        else:
            it["clase_margen"] = "C"
        it["rank_margen"] = i + 1
        it["pct_margen_acum"] = round(pct, 2)
        classes_count[it["clase_margen"]] += 1
        classes_margen[it["clase_margen"]] += it["margen_estimado"]

    return {
        "period": period,
        "total_skus": len(items),
        "total_margen_estimado": round(total_margen, 2),
        "warning": "Margen estimado usando heuristica 60% costo / 40% margen. Para precision integrar costs.db por SKU.",
        "classes": {
            k: {
                "count": classes_count[k],
                "margen": round(classes_margen[k], 2),
                "pct_margen": round(classes_margen[k] / total_margen * 100, 1),
            }
            for k in ["A", "B", "C"]
        },
        "skus": items,
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Product Lifecycle (nuevo / growth / maduro / declive)
# ============================================================

def product_lifecycle(period_days: int = 180) -> dict:
    """Clasifica cada SKU en stage del ciclo de vida usando rolling averages.

    Stages:
    - nuevo: primera venta hace <60 dias
    - growth: ventas ultimos 30d > ultimas 30-60d en al menos +30%
    - maduro: ventas estables entre periodos (variacion ±30%)
    - declive: ventas ultimos 30d < ultimas 30-60d en al menos -30%
    - dormido: sin ventas en ultimos 60d
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH skus AS (
            SELECT DISTINCT oi.sku, MAX(oi.name) AS nombre
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1
        ),
        first_sale AS (
            SELECT oi.sku, MIN(o."createdAt") AS primera_venta
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid' AND oi.sku IS NOT NULL
            GROUP BY 1
        ),
        last30 AS (
            SELECT oi.sku,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '30 days'
              AND oi.sku IS NOT NULL
            GROUP BY 1
        ),
        prev30 AS (
            SELECT oi.sku,
                   SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '60 days'
              AND o."createdAt" <  NOW() - INTERVAL '30 days'
              AND oi.sku IS NOT NULL
            GROUP BY 1
        )
        SELECT s.sku, s.nombre,
               fs.primera_venta::date AS primera_venta,
               EXTRACT(DAY FROM (NOW() - fs.primera_venta))::int AS dias_desde_primera,
               COALESCE(l30.units, 0) AS units_l30,
               COALESCE(l30.revenue, 0)::float AS rev_l30,
               COALESCE(p30.units, 0) AS units_p30,
               COALESCE(p30.revenue, 0)::float AS rev_p30
        FROM skus s
        LEFT JOIN first_sale fs ON fs.sku = s.sku
        LEFT JOIN last30 l30 ON l30.sku = s.sku
        LEFT JOIN prev30 p30 ON p30.sku = s.sku
    """, {"d": period_days}) or []

    items: dict[str, list[dict]] = {"nuevo": [], "growth": [], "maduro": [], "declive": [], "dormido": []}
    for r in rows:
        sku, nombre, prim, dias_prim, ul30, rl30, up30, rp30 = r
        rl30_f = float(rl30 or 0)
        rp30_f = float(rp30 or 0)
        dias = int(dias_prim or 0) if dias_prim is not None else 9999
        if dias < 60:
            stage = "nuevo"
        elif rl30_f == 0:
            stage = "dormido"
        elif rp30_f == 0:
            stage = "growth"
        else:
            change = (rl30_f - rp30_f) / rp30_f
            if change >= 0.3:
                stage = "growth"
            elif change <= -0.3:
                stage = "declive"
            else:
                stage = "maduro"
        items[stage].append({
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "primera_venta": prim.isoformat() if prim else None,
            "dias_desde_primera": dias,
            "units_30d": int(ul30 or 0),
            "rev_30d": round(rl30_f, 2),
            "units_30d_prev": int(up30 or 0),
            "rev_30d_prev": round(rp30_f, 2),
            "growth_pct": round((rl30_f - rp30_f) / rp30_f * 100, 1) if rp30_f > 0 else None,
        })

    stage_meta = {
        "nuevo": {"label": "Nuevo (<60d)", "color": "#3b82f6", "desc": "Producto reciente, monitoreo y push inicial"},
        "growth": {"label": "Crecimiento", "color": "#10b981", "desc": "Ventas creciendo >30% mom · invertir en stock y marketing"},
        "maduro": {"label": "Maduro", "color": "#06b6d4", "desc": "Ventas estables · mantener operacion"},
        "declive": {"label": "Declive", "color": "#f59e0b", "desc": "Cayendo >30% mom · revisar precio/competencia"},
        "dormido": {"label": "Dormido", "color": "#94a3b8", "desc": "Sin ventas 30d · candidato a discontinuar"},
    }

    return {
        "period_days": period_days,
        "stages": {
            k: {
                **stage_meta[k],
                "count": len(items[k]),
                "skus": sorted(items[k], key=lambda x: -x["rev_30d"])[:50],
            }
            for k in items.keys()
        },
        "total_skus": sum(len(v) for v in items.values()),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Price elasticity (simple lineal: dQ/dP * P/Q)
# ============================================================

def price_elasticity(period_days: int = 180) -> dict:
    """Calcula elasticidad-precio aproximada por SKU comparando puntos
    de precio observados vs cantidad vendida en cada mes."""
    eng = get_engine("unistore")

    # Por cada SKU agrupar por mes: precio promedio y unidades
    rows = q(eng, """
        WITH monthly AS (
            SELECT oi.sku,
                   date_trunc('month', o."createdAt")::date AS mes,
                   AVG(oi.price)::float AS precio_avg,
                   SUM(oi.quantity)::int AS unidades
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
              AND oi.price > 0
              AND oi.quantity > 0
            GROUP BY 1, 2
        )
        SELECT sku, mes, precio_avg, unidades
        FROM monthly
        ORDER BY sku, mes
    """, {"d": period_days}) or []

    # Agrupar por SKU y calcular elasticidad simple
    by_sku: dict[str, list[tuple]] = {}
    for r in rows:
        by_sku.setdefault(r[0], []).append((r[1], float(r[2] or 0), int(r[3] or 0)))

    items = []
    for sku, points in by_sku.items():
        if len(points) < 3:
            continue
        # Calcular cambios % en precio y cantidad mes a mes, luego promediar
        elasticities = []
        for i in range(1, len(points)):
            p1, p2 = points[i - 1][1], points[i][1]
            q1, q2 = points[i - 1][2], points[i][2]
            if p1 > 0 and q1 > 0:
                dp_pct = (p2 - p1) / p1
                dq_pct = (q2 - q1) / q1
                if abs(dp_pct) > 0.02:  # solo si hubo cambio de precio significativo
                    elasticities.append(dq_pct / dp_pct)
        if not elasticities:
            continue
        elasticity = sum(elasticities) / len(elasticities)
        # Clasificar
        if elasticity < -1:
            kind = "elastica"  # demanda elastica: -X% precio sube +X+% cantidad
        elif elasticity < 0:
            kind = "inelastica"
        else:
            kind = "anomala"  # rara: precio y cantidad suben juntas
        # Promedios
        avg_price = sum(p[1] for p in points) / len(points)
        avg_qty = sum(p[2] for p in points) / len(points)
        items.append({
            "sku": sku,
            "elasticity": round(elasticity, 2),
            "kind": kind,
            "data_points": len(points),
            "precio_avg": round(avg_price, 2),
            "unidades_avg": round(avg_qty, 1),
        })

    items.sort(key=lambda x: x["elasticity"])  # mas elasticos primero (mas negativos)

    return {
        "period_days": period_days,
        "kinds": {
            "elastica": {"label": "Elástica (|e|>1)", "color": "#ef4444", "desc": "Baja precio para vender más"},
            "inelastica": {"label": "Inelástica (-1<e<0)", "color": "#10b981", "desc": "Podés subir precio sin perder volumen"},
            "anomala": {"label": "Anómala (e>0)", "color": "#94a3b8", "desc": "Precio sube y cantidad también: producto premium o tendencia"},
        },
        "skus": items[:200],
        "total_analyzed": len(items),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Cannibalization pairs (productos que se sustituyen)
# ============================================================

def cannibalization_pairs(period_days: int = 90) -> dict:
    """Detecta pares de SKUs donde el crecimiento de uno coincide con la caida
    del otro entre clientes que compran ambos. Indica sustitucion."""
    eng = get_engine("unistore")

    # Para cada par de SKUs comprados por mismos clientes:
    # ver si el crecimiento del SKU A en periodo actual vs anterior se asocia
    # con la caida del SKU B en los mismos clientes.
    rows = q(eng, """
        WITH customer_skus_actual AS (
            SELECT o."customerId" AS cid, oi.sku, SUM(oi.quantity)::int AS units
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL AND o."customerId" IS NOT NULL
            GROUP BY 1, 2
        ),
        customer_skus_anterior AS (
            SELECT o."customerId" AS cid, oi.sku, SUM(oi.quantity)::int AS units
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d2)
              AND o."createdAt" <  NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL AND o."customerId" IS NOT NULL
            GROUP BY 1, 2
        ),
        diffs AS (
            SELECT COALESCE(a.cid, p.cid) AS cid,
                   COALESCE(a.sku, p.sku) AS sku,
                   (COALESCE(a.units, 0) - COALESCE(p.units, 0)) AS delta
            FROM customer_skus_actual a
            FULL OUTER JOIN customer_skus_anterior p ON p.cid = a.cid AND p.sku = a.sku
        ),
        gain_loss AS (
            SELECT cid,
                   sku AS sku_gained,
                   delta AS units_gained
            FROM diffs
            WHERE delta > 0
        ),
        loss_set AS (
            SELECT cid,
                   sku AS sku_lost,
                   ABS(delta) AS units_lost
            FROM diffs
            WHERE delta < 0
        )
        SELECT g.sku_gained, l.sku_lost,
               COUNT(DISTINCT g.cid)::int AS clientes_que_sustituyen,
               SUM(LEAST(g.units_gained, l.units_lost))::int AS unidades_sustituidas
        FROM gain_loss g
        INNER JOIN loss_set l ON l.cid = g.cid AND l.sku_lost <> g.sku_gained
        GROUP BY g.sku_gained, l.sku_lost
        HAVING COUNT(DISTINCT g.cid) >= 3
        ORDER BY clientes_que_sustituyen DESC, unidades_sustituidas DESC
        LIMIT 50
    """, {"d": period_days, "d2": period_days * 2}) or []

    # Enriquecer con nombres
    pairs = [{
        "sku_gain": r[0],
        "sku_loss": r[1],
        "clientes": int(r[2] or 0),
        "unidades_sustituidas": int(r[3] or 0),
    } for r in rows]

    if pairs:
        all_skus = list({p["sku_gain"] for p in pairs} | {p["sku_loss"] for p in pairs})
        name_rows = q(eng, """
            SELECT DISTINCT ON (sku) sku, name
            FROM tienda_nube."OrderItem"
            WHERE sku = ANY(:skus)
        """, {"skus": all_skus}) or []
        name_map = {r[0]: r[1] for r in name_rows}
        for p in pairs:
            p["name_gain"] = (name_map.get(p["sku_gain"]) or p["sku_gain"])[:60]
            p["name_loss"] = (name_map.get(p["sku_loss"]) or p["sku_loss"])[:60]

    return {
        "period_days": period_days,
        "pairs": pairs,
        "total": len(pairs),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Forecast SKU (linear extrapolation + simple exp smoothing)
# ============================================================

def forecast_sku(sku: str, days_history: int = 90, days_ahead: int = 30) -> dict:
    """Forecast simple por SKU usando linear regression + exp smoothing.
    Devuelve serie historica + prediccion proximos N dias.
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        SELECT DATE(o."createdAt") AS dia, SUM(oi.quantity)::int AS units
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid' AND oi.sku = :sku
          AND o."createdAt" >= NOW() - make_interval(days => :d)
        GROUP BY 1 ORDER BY 1
    """, {"sku": sku, "d": days_history}) or []

    if len(rows) < 5:
        return {"sku": sku, "error": "Datos insuficientes para forecast (necesita 5+ dias con ventas)", "history": [], "forecast": []}

    history = [{"dia": r[0].isoformat(), "units": int(r[1] or 0)} for r in rows]

    # Linear regression manual (no requiere numpy)
    n = len(history)
    x_vals = list(range(n))
    y_vals = [h["units"] for h in history]
    x_mean = sum(x_vals) / n
    y_mean = sum(y_vals) / n
    num = sum((x_vals[i] - x_mean) * (y_vals[i] - y_mean) for i in range(n))
    den = sum((x_vals[i] - x_mean) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0
    intercept = y_mean - slope * x_mean

    # Exp smoothing alpha=0.3
    alpha = 0.3
    smoothed = y_vals[0]
    for v in y_vals[1:]:
        smoothed = alpha * v + (1 - alpha) * smoothed

    # Forecast siguiente N dias usando ambos metodos y promediar
    import datetime as _dt
    last_date = rows[-1][0]
    forecast = []
    for i in range(1, days_ahead + 1):
        linear_pred = max(0, intercept + slope * (n + i - 1))
        # ES estable: usa el smoothed level
        es_pred = max(0, smoothed)
        # Ensemble simple: promedio de los dos
        pred = (linear_pred + es_pred) / 2
        forecast.append({
            "dia": (last_date + _dt.timedelta(days=i)).isoformat(),
            "units_pred": round(pred, 1),
            "linear": round(linear_pred, 1),
            "exp_smooth": round(es_pred, 1),
        })

    return {
        "sku": sku,
        "days_history": days_history,
        "days_ahead": days_ahead,
        "history": history,
        "forecast": forecast,
        "trend": "creciente" if slope > 0.1 else "decreciente" if slope < -0.1 else "estable",
        "slope": round(slope, 3),
        "avg_units_history": round(y_mean, 2),
        "predicted_total_period": round(sum(f["units_pred"] for f in forecast), 0),
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Stockout simulator
# ============================================================

def stockout_simulator(demand_change_pct: float = 0, days_to_simulate: int = 30) -> dict:
    """Simula cuantos SKUs quedarian sin stock si la demanda cambia X% en
    los proximos N dias. demand_change_pct = +50 para promo, -20 para caida."""
    rot = inventory_rotation(period="30d")
    factor = 1 + (demand_change_pct / 100)

    skus_simulated = []
    stockouts = 0
    for s in rot["skus"]:
        ventas_dia_simulado = s["ventas_dia_avg"] * factor
        if ventas_dia_simulado <= 0:
            continue
        days_left = s["stock_actual"] / ventas_dia_simulado
        will_stockout = days_left < days_to_simulate
        if will_stockout:
            stockouts += 1
        skus_simulated.append({
            "sku": s["sku"],
            "nombre": s["nombre"],
            "stock_actual": s["stock_actual"],
            "ventas_dia_avg_actual": s["ventas_dia_avg"],
            "ventas_dia_simulado": round(ventas_dia_simulado, 2),
            "days_left_simulado": round(days_left, 1),
            "will_stockout": will_stockout,
            "deficit_unidades": max(0, round(ventas_dia_simulado * days_to_simulate - s["stock_actual"], 0)),
        })

    at_risk = [s for s in skus_simulated if s["will_stockout"]]
    at_risk.sort(key=lambda x: x["days_left_simulado"])

    return {
        "demand_change_pct": demand_change_pct,
        "days_to_simulate": days_to_simulate,
        "total_skus": len(skus_simulated),
        "skus_stockout": stockouts,
        "deficit_total_unidades": sum(s["deficit_unidades"] for s in at_risk),
        "skus_at_risk": at_risk[:100],
        "generated_at": now_ar().isoformat(),
    }


# ============================================================
# Affinity score (lift + confidence > co-ocurrencia simple)
# ============================================================

def affinity_score_pairs(period_days: int = 90, min_support: int = 5, top_n: int = 50) -> dict:
    """Calcula lift y confidence para pares de SKUs (mejor que co-ocurrencia).

    Lift > 1 indica asociacion real (no es azar).
    Confidence A->B = P(B|A) = co-oc / orders con A.
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH order_skus AS (
            SELECT oi."orderId", oi.sku
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1, 2
        ),
        total AS (SELECT COUNT(DISTINCT "orderId")::float AS n FROM order_skus),
        sku_supports AS (
            SELECT sku, COUNT(*)::int AS n_orders
            FROM order_skus GROUP BY sku
            HAVING COUNT(*) >= :min_s
        ),
        pairs AS (
            SELECT a.sku AS sku_a, b.sku AS sku_b, COUNT(*)::int AS n_ab
            FROM order_skus a
            INNER JOIN order_skus b ON a."orderId" = b."orderId" AND a.sku < b.sku
            GROUP BY a.sku, b.sku
            HAVING COUNT(*) >= :min_s
        )
        SELECT p.sku_a, p.sku_b, p.n_ab,
               sa.n_orders AS n_a, sb.n_orders AS n_b,
               t.n AS n_total
        FROM pairs p
        INNER JOIN sku_supports sa ON sa.sku = p.sku_a
        INNER JOIN sku_supports sb ON sb.sku = p.sku_b
        CROSS JOIN total t
        ORDER BY p.n_ab DESC
        LIMIT :top
    """, {"d": period_days, "min_s": min_support, "top": top_n}) or []

    items = []
    for r in rows:
        sku_a, sku_b, n_ab, n_a, n_b, n_total = r
        n_ab_f = float(n_ab or 0)
        n_a_f = float(n_a or 1)
        n_b_f = float(n_b or 1)
        n_t = float(n_total or 1)
        # Support: P(A and B) = n_ab / n_total
        support = n_ab_f / n_t
        # Confidence A->B: P(B|A) = n_ab / n_a
        confidence_ab = n_ab_f / n_a_f
        confidence_ba = n_ab_f / n_b_f
        # Lift: P(A and B) / (P(A) * P(B))
        p_a = n_a_f / n_t
        p_b = n_b_f / n_t
        lift = (support / (p_a * p_b)) if (p_a * p_b) > 0 else 0
        items.append({
            "sku_a": sku_a,
            "sku_b": sku_b,
            "co_oc": int(n_ab_f),
            "support_pct": round(support * 100, 2),
            "confidence_ab_pct": round(confidence_ab * 100, 1),  # quien compra A, % compra B
            "confidence_ba_pct": round(confidence_ba * 100, 1),
            "lift": round(lift, 2),
        })

    # Enriquecer con nombres
    if items:
        all_skus = list({i["sku_a"] for i in items} | {i["sku_b"] for i in items})
        name_rows = q(eng, """
            SELECT DISTINCT ON (sku) sku, name
            FROM tienda_nube."OrderItem"
            WHERE sku = ANY(:skus)
        """, {"skus": all_skus}) or []
        name_map = {r[0]: r[1] for r in name_rows}
        for it in items:
            it["name_a"] = (name_map.get(it["sku_a"]) or it["sku_a"])[:60]
            it["name_b"] = (name_map.get(it["sku_b"]) or it["sku_b"])[:60]

    # Ordenar por lift desc (asociaciones mas fuertes)
    items.sort(key=lambda x: -x["lift"])

    return {
        "period_days": period_days,
        "min_support": min_support,
        "pairs": items,
        "total": len(items),
        "generated_at": now_ar().isoformat(),
    }


def returns_rate_by_sku(period_days: int = 90) -> dict:
    """% de devoluciones sobre ventas por SKU. Indica problemas de calidad
    o expectativa de cliente."""
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH ventas AS (
            SELECT oi.sku, MAX(oi.name) AS nombre,
                   SUM(oi.quantity)::int AS units_vendidas
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
              AND oi.sku IS NOT NULL
            GROUP BY 1
        ),
        devs AS (
            SELECT di.sku, SUM(di.cantidad_solicitada)::int AS units_devueltas
            FROM unidev.devolucion_items di
            INNER JOIN unidev.devoluciones d ON d.devolucion_id = di.devolucion_id
            WHERE d.fecha_creacion >= NOW() - make_interval(days => :d)
              AND di.sku IS NOT NULL
            GROUP BY 1
        )
        SELECT v.sku, v.nombre, v.units_vendidas,
               COALESCE(de.units_devueltas, 0) AS units_devueltas
        FROM ventas v
        LEFT JOIN devs de ON de.sku = v.sku
        WHERE v.units_vendidas > 10  -- minimo significativo
        ORDER BY (COALESCE(de.units_devueltas, 0)::float / NULLIF(v.units_vendidas, 0)::float) DESC NULLS LAST
        LIMIT 100
    """, {"d": period_days}) or []

    items = []
    for r in rows:
        sku, nombre, sold, returned = r
        sold_n = int(sold or 0)
        ret_n = int(returned or 0)
        rate = (ret_n / sold_n * 100) if sold_n > 0 else 0
        items.append({
            "sku": sku,
            "nombre": (nombre or sku)[:80],
            "vendidas": sold_n,
            "devueltas": ret_n,
            "returns_rate_pct": round(rate, 2),
        })

    return {
        "period_days": period_days,
        "skus": items,
        "total": len(items),
        "generated_at": now_ar().isoformat(),
    }
