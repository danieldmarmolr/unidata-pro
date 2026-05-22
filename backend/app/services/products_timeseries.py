"""
Series temporales para los graficos de la vista /dashboard/productos.

Cuatro series:
- profit_daily: revenue/costo/ganancia diaria con media movil 7d
- catalog_active: % del catalogo publicado que vendio cada semana
- abc_distribution: SKUs en clase A/B/C cada mes
- (revenue_cost_profit comparten endpoint con profit_daily)
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services.profit_engine import cost_index_unistore, calc_profit
from app.utils.tz import now_ar

log = logging.getLogger("unidata.products_ts")


def profit_daily(days: int = 90) -> dict:
    """Serie diaria de revenue, costo y ganancia neta. Media movil 7d.

    Calcula la ganancia neta sumando por dia las ganancias de cada SKU,
    aplicando el cost_index_unistore (mismo motor que el resto del dashboard).
    """
    eng = get_engine("unistore")
    cost_idx = cost_index_unistore()

    rows = q(eng, """
        SELECT DATE(o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
               oi.sku,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND oi.sku IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
    """, {"days": days}) or []

    by_day: dict[str, dict] = {}
    for dia, sku, units, revenue in rows:
        dkey = dia.isoformat()
        if dkey not in by_day:
            by_day[dkey] = {"revenue": 0.0, "costo": 0.0, "ganancia": 0.0, "revenue_con_costo": 0.0}
        rev = float(revenue or 0)
        u = int(units or 0)
        by_day[dkey]["revenue"] += rev

        rec = cost_idx.get((sku or "").strip().lower())
        if rec and rec.get("costo_con_iva") and u > 0 and rev > 0:
            sin_iva = float(rec.get("costo_sin_iva") or 0)
            con_iva = float(rec.get("costo_con_iva") or sin_iva)
            costo_total = con_iva * u
            pb = calc_profit(
                ingreso_bruto=rev,
                costo_sin_iva=sin_iva * u,
                costo_con_iva=costo_total,
                is_cash=False,
                iva_aliquot_override=rec.get("iva_aliquot"),
            )
            by_day[dkey]["costo"] += costo_total
            by_day[dkey]["ganancia"] += pb.ganancia_neta
            by_day[dkey]["revenue_con_costo"] += rev

    points = []
    sorted_days = sorted(by_day.keys())
    for i, d in enumerate(sorted_days):
        bd = by_day[d]
        # Media movil 7d de ganancia
        window = sorted_days[max(0, i - 6): i + 1]
        avg_gan = sum(by_day[w]["ganancia"] for w in window) / len(window)
        margen_pct = (bd["ganancia"] / bd["revenue_con_costo"] * 100) if bd["revenue_con_costo"] > 0 else 0
        points.append({
            "date": d,
            "revenue": round(bd["revenue"], 0),
            "costo": round(bd["costo"], 0),
            "ganancia": round(bd["ganancia"], 0),
            "ganancia_ma7": round(avg_gan, 0),
            "margen_pct": round(margen_pct, 1),
        })

    return {
        "days": days,
        "points": points,
        "summary": {
            "total_revenue": round(sum(p["revenue"] for p in points), 0),
            "total_costo": round(sum(p["costo"] for p in points), 0),
            "total_ganancia": round(sum(p["ganancia"] for p in points), 0),
            "margen_promedio_pct": round(
                sum(p["ganancia"] for p in points) / sum(p["revenue"] for p in points) * 100
                if sum(p["revenue"] for p in points) > 0 else 0, 1
            ),
        },
        "generated_at": now_ar().isoformat(),
    }


def catalog_active(weeks: int = 52) -> dict:
    """% del catalogo publicado que vendio al menos 1 unidad cada semana."""
    eng = get_engine("unistore")
    total_publicados = int(scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Product" WHERE published = TRUE
    """) or 0) or 1

    rows = q(eng, """
        SELECT DATE_TRUNC('week', o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS semana,
               COUNT(DISTINCT oi.sku)::int AS skus_activos
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(weeks => :weeks)
          AND oi.sku IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """, {"weeks": weeks}) or []

    points = [
        {
            "date": r[0].isoformat(),
            "skus_activos": int(r[1] or 0),
            "pct_activo": round((int(r[1] or 0)) / total_publicados * 100, 2),
        }
        for r in rows
    ]

    return {
        "weeks": weeks,
        "total_publicados": total_publicados,
        "points": points,
        "summary": {
            "promedio_pct": round(sum(p["pct_activo"] for p in points) / len(points), 2) if points else 0,
            "max_pct": max((p["pct_activo"] for p in points), default=0),
            "ultimo_pct": points[-1]["pct_activo"] if points else 0,
        },
        "generated_at": now_ar().isoformat(),
    }


def abc_distribution(months: int = 12) -> dict:
    """Por cada mes calcula la distribucion ABC de los SKUs vendidos.

    Stacked bar: cuantos SKUs en clase A vs B vs C tuviste cada mes.
    Mostrar como la concentracion de revenue cambia en el tiempo.
    """
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT DATE_TRUNC('month', o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
               oi.sku,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= DATE_TRUNC('month', NOW() - make_interval(months => :months))
          AND oi.sku IS NOT NULL
          AND oi.sku NOT ILIKE '%PVA%'
        GROUP BY 1, 2
    """, {"months": months}) or []

    by_month: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for mes, sku, rev in rows:
        by_month[mes.isoformat()].append((sku, float(rev or 0)))

    points = []
    for month_key in sorted(by_month.keys()):
        skus = sorted(by_month[month_key], key=lambda x: -x[1])
        total_rev = sum(r for _, r in skus) or 1.0
        cum = 0.0
        counts = {"A": 0, "B": 0, "C": 0}
        revs = {"A": 0.0, "B": 0.0, "C": 0.0}
        for sku, rev in skus:
            cum += rev
            pct = cum / total_rev * 100
            cls = "A" if pct <= 80 else "B" if pct <= 95 else "C"
            counts[cls] += 1
            revs[cls] += rev
        points.append({
            "date": month_key,
            "skus_a": counts["A"],
            "skus_b": counts["B"],
            "skus_c": counts["C"],
            "rev_a": round(revs["A"], 0),
            "rev_b": round(revs["B"], 0),
            "rev_c": round(revs["C"], 0),
            "total_skus": counts["A"] + counts["B"] + counts["C"],
            "concentracion_a_pct": round(counts["A"] / (counts["A"] + counts["B"] + counts["C"]) * 100, 1)
                                    if (counts["A"] + counts["B"] + counts["C"]) > 0 else 0,
        })

    return {
        "months": months,
        "points": points,
        "generated_at": now_ar().isoformat(),
    }
