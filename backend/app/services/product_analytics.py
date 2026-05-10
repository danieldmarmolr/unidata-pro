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
