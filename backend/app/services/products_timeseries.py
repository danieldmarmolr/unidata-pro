"""
Series temporales para los graficos de la vista /dashboard/productos.

Cuatro series + correlaciones cruzadas:
- profit_daily: revenue/costo/ganancia diaria con media movil 7d
- catalog_active: % del catalogo publicado que vendio cada semana
- abc_distribution: SKUs en clase A/B/C cada mes
- cross_correlations: lecturas cruzadas entre las 3 series

Cada funcion soporta unit="unistore" | "unidrop" y devuelve la misma forma de
respuesta enriquecida con storytelling (max/min/prev_period/outliers/insight).
"""
from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Callable

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services.profit_engine import cost_index_unistore, calc_profit
from app.utils.tz import now_ar

log = logging.getLogger("unidata.products_ts")


_MESES_AR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _fmt_date(iso: str) -> str:
    """YYYY-MM-DD -> DD/MM."""
    try:
        y, m, d = iso.split("-")
        return f"{d}/{m}"
    except Exception:
        return iso


def _fmt_month(iso: str) -> str:
    """YYYY-MM o YYYY-MM-DD -> 'mar 26'."""
    try:
        parts = iso.split("-")
        return f"{_MESES_AR[int(parts[1]) - 1]} {parts[0][2:]}"
    except Exception:
        return iso


def _money_short(v: float) -> str:
    if abs(v) >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    if abs(v) >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${v:.0f}"


def _enrich_series(
    points: list[dict],
    value_key: str,
    *,
    date_fmt: Callable[[str], str] = _fmt_date,
    prev_points: list[dict] | None = None,
) -> dict:
    """Calcula max/min/avg/std/outliers/momentum y devuelve un payload de
    storytelling listo para inyectar en la respuesta del endpoint.

    - outliers: puntos con |z-score| > 2 (suficientemente raros)
    - momentum: ultimos 7 puntos vs los 7 anteriores (cuando hay datos)
    """
    if not points:
        return {
            "max_point": None, "min_point": None,
            "avg": 0.0, "std": 0.0,
            "outliers": [], "momentum_pct": 0.0,
            "trend": "flat", "trend_strength": 0.0,
            "prev_period": None,
            "prev_total_diff_pct": 0.0,
        }

    vals = [float(p.get(value_key) or 0) for p in points]
    n = len(vals)
    avg = sum(vals) / n if n else 0.0
    std = statistics.pstdev(vals) if n > 1 else 0.0

    max_i = max(range(n), key=lambda i: vals[i])
    min_i = min(range(n), key=lambda i: vals[i])
    max_point = {**points[max_i], "label": date_fmt(str(points[max_i].get("date"))), "vs_avg_pct": round((vals[max_i] - avg) / avg * 100, 1) if avg else 0.0}
    min_point = {**points[min_i], "label": date_fmt(str(points[min_i].get("date"))), "vs_avg_pct": round((vals[min_i] - avg) / avg * 100, 1) if avg else 0.0}

    outliers: list[dict] = []
    if std > 0:
        for i, v in enumerate(vals):
            z = (v - avg) / std
            if abs(z) > 2:
                outliers.append({
                    "date": points[i].get("date"),
                    "label": date_fmt(str(points[i].get("date"))),
                    "value": v,
                    "z": round(z, 2),
                    "direction": "up" if z > 0 else "down",
                })

    # momentum: media ult 7 vs media 7 anteriores
    momentum_pct = 0.0
    if n >= 14:
        last7 = sum(vals[-7:]) / 7
        prev7 = sum(vals[-14:-7]) / 7
        momentum_pct = ((last7 - prev7) / prev7 * 100) if prev7 else 0.0

    # tendencia general por regresion lineal simple (slope normalizada)
    trend = "flat"
    trend_strength = 0.0
    if n >= 4 and avg > 0:
        xs = list(range(n))
        x_avg = sum(xs) / n
        y_avg = avg
        num = sum((xs[i] - x_avg) * (vals[i] - y_avg) for i in range(n))
        den = sum((xs[i] - x_avg) ** 2 for i in range(n)) or 1
        slope = num / den
        trend_strength = round(slope * n / avg * 100, 1)
        if trend_strength > 5:
            trend = "up"
        elif trend_strength < -5:
            trend = "down"

    prev_total_diff_pct = 0.0
    prev_pack = None
    if prev_points:
        prev_total = sum(float(p.get(value_key) or 0) for p in prev_points)
        cur_total = sum(vals)
        if prev_total > 0:
            prev_total_diff_pct = round((cur_total - prev_total) / prev_total * 100, 1)
        prev_pack = {
            "points": prev_points,
            "total": round(prev_total, 0),
        }

    return {
        "max_point": max_point,
        "min_point": min_point,
        "avg": round(avg, 2),
        "std": round(std, 2),
        "outliers": outliers,
        "momentum_pct": round(momentum_pct, 1),
        "trend": trend,
        "trend_strength": trend_strength,
        "prev_period": prev_pack,
        "prev_total_diff_pct": prev_total_diff_pct,
    }


# ============================================================
# PROFIT DAILY
# ============================================================

def _profit_daily_unistore(days: int, *, offset_days: int = 0) -> list[dict]:
    """Query y agregacion por dia para Unistore (TN). offset_days desplaza la
    ventana hacia atras (para calcular periodo anterior comparativo)."""
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
          AND o."createdAt" >= NOW() - make_interval(days => :total)
          AND o."createdAt" <  NOW() - make_interval(days => :offset)
          AND oi.sku IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
    """, {"total": days + offset_days, "offset": offset_days}) or []

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

    return _materialize_days(by_day, days)


def _profit_daily_unidrop(days: int, *, offset_days: int = 0) -> list[dict]:
    """Query agregada por dia para Unidrop (ML + TN dropshipper).

    revenue   = GMV end-consumer (totalAmount OML paid + total TN paid)
    costo     = merchandise_cost OML (TN unidrop no expone costo por item)
    ganancia  = profit_for_subscription OML (lo que Unidrop facturo)
    """
    eng = get_engine("unidrop")

    by_day: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "costo": 0.0, "ganancia": 0.0, "revenue_con_costo": 0.0})

    rows_ml = q(eng, """
        SELECT DATE(o."dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
               COALESCE(SUM(o."totalAmount"), 0)::float AS gmv,
               COALESCE(SUM(o."merchandise_cost"), 0)::float AS costo,
               COALESCE(SUM(o."profit_for_subscription"), 0)::float AS ganancia
        FROM mercado_libre_dev."OrderMercadoLibre" o
        WHERE o."status" = 'paid'
          AND o."number" LIKE 'DROP-%'
          AND o."dateCreated" >= NOW() - make_interval(days => :total)
          AND o."dateCreated" <  NOW() - make_interval(days => :offset)
        GROUP BY 1
    """, {"total": days + offset_days, "offset": offset_days}) or []
    for dia, gmv, costo, ganancia in rows_ml:
        dkey = dia.isoformat()
        by_day[dkey]["revenue"] += float(gmv or 0)
        by_day[dkey]["costo"] += float(costo or 0)
        by_day[dkey]["ganancia"] += float(ganancia or 0)
        by_day[dkey]["revenue_con_costo"] += float(gmv or 0)

    rows_tn = q(eng, """
        SELECT DATE(tno.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
               COALESCE(SUM(tno.total), 0)::float AS gmv
        FROM public.tienda_nube_orders tno
        WHERE tno.payment_status::text = 'paid'
          AND tno.created_at >= NOW() - make_interval(days => :total)
          AND tno.created_at <  NOW() - make_interval(days => :offset)
        GROUP BY 1
    """, {"total": days + offset_days, "offset": offset_days}) or []
    for dia, gmv in rows_tn:
        dkey = dia.isoformat()
        by_day[dkey]["revenue"] += float(gmv or 0)

    return _materialize_days(by_day, days)


def _materialize_days(by_day: dict[str, dict], days: int) -> list[dict]:
    """Convierte el dict por dia en lista ordenada con media movil 7d y margen."""
    points: list[dict] = []
    sorted_days = sorted(by_day.keys())
    for i, d in enumerate(sorted_days):
        bd = by_day[d]
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
    return points


def profit_daily(days: int = 90, unit: str = "unistore") -> dict:
    """Serie diaria de revenue, costo y ganancia neta + media movil 7d +
    storytelling (max/min/outliers/prev_period/insight)."""
    if unit == "unidrop":
        points = _profit_daily_unidrop(days)
        prev = _profit_daily_unidrop(days, offset_days=days)
    else:
        points = _profit_daily_unistore(days)
        prev = _profit_daily_unistore(days, offset_days=days)

    story = _enrich_series(points, "ganancia", date_fmt=_fmt_date, prev_points=prev)

    total_rev = sum(p["revenue"] for p in points)
    total_cost = sum(p["costo"] for p in points)
    total_gan = sum(p["ganancia"] for p in points)
    rev_with_cost = sum(p["revenue"] for p in points if p["costo"] > 0)
    margen_prom = (total_gan / rev_with_cost * 100) if rev_with_cost > 0 else 0

    insight = _insight_profit(story, total_gan, margen_prom, unit)

    return {
        "days": days,
        "unit": unit,
        "points": points,
        "story": story,
        "insight": insight,
        "summary": {
            "total_revenue": round(total_rev, 0),
            "total_costo": round(total_cost, 0),
            "total_ganancia": round(total_gan, 0),
            "margen_promedio_pct": round(margen_prom, 1),
        },
        "generated_at": now_ar().isoformat(),
    }


def _insight_profit(story: dict, total_gan: float, margen: float, unit: str) -> str:
    parts: list[str] = []
    mp = story.get("max_point") or {}
    if mp.get("label"):
        parts.append(f"Pico el {mp['label']} ({_money_short(mp.get('ganancia') or 0)}, +{mp.get('vs_avg_pct', 0):.0f}% vs media)")
    trend = story.get("trend")
    ts = story.get("trend_strength") or 0
    if trend == "up":
        parts.append(f"tendencia al alza ({ts:+.1f}%)")
    elif trend == "down":
        parts.append(f"tendencia a la baja ({ts:+.1f}%)")
    diff = story.get("prev_total_diff_pct") or 0
    if abs(diff) >= 1:
        word = "arriba" if diff > 0 else "abajo"
        parts.append(f"{diff:+.1f}% vs periodo anterior ({word})")
    momentum = story.get("momentum_pct") or 0
    if abs(momentum) >= 5:
        parts.append(f"ultimos 7d {momentum:+.1f}% vs 7d previos")
    if not parts:
        return f"Ganancia agregada {_money_short(total_gan)} · margen {margen:.1f}%"
    return " · ".join(parts) + f". Margen prom. {margen:.1f}%"


# ============================================================
# CATALOG ACTIVE
# ============================================================

def _catalog_active_unistore(weeks: int, offset_weeks: int = 0) -> tuple[list[dict], int]:
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
          AND o."createdAt" >= NOW() - make_interval(weeks => :total)
          AND o."createdAt" <  NOW() - make_interval(weeks => :offset)
          AND oi.sku IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """, {"total": weeks + offset_weeks, "offset": offset_weeks}) or []

    points = [
        {
            "date": r[0].isoformat(),
            "skus_activos": int(r[1] or 0),
            "pct_activo": round((int(r[1] or 0)) / total_publicados * 100, 2),
        }
        for r in rows
    ]
    return points, total_publicados


def _catalog_active_unidrop(weeks: int, offset_weeks: int = 0) -> tuple[list[dict], int]:
    eng = get_engine("unidrop")
    # Universo Unidrop: distintos SKUs vendidos en los ultimos 12 meses (no hay
    # tabla "Product published" canonica como en Unistore TN).
    total_publicados = int(scalar(eng, """
        WITH base AS (
            SELECT oi."sellerSku" AS sku FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE o."number" LIKE 'DROP-%'
              AND o."status" = 'paid'
              AND o."dateCreated" >= NOW() - INTERVAL '12 months'
              AND oi."sellerSku" IS NOT NULL
            UNION
            SELECT oi.sku FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '12 months'
              AND oi.sku IS NOT NULL
        )
        SELECT COUNT(DISTINCT sku) FROM base
    """) or 0) or 1

    # Por semana, distinct SKUs (TN+ML)
    by_week: dict[str, set] = defaultdict(set)
    rows_ml = q(eng, """
        SELECT DATE_TRUNC('week', o."dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS semana,
               oi."sellerSku" AS sku
        FROM mercado_libre_dev."OrderItemMercadoLibre" oi
        JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
        WHERE o."status" = 'paid'
          AND o."number" LIKE 'DROP-%'
          AND oi."sellerSku" IS NOT NULL
          AND o."dateCreated" >= NOW() - make_interval(weeks => :total)
          AND o."dateCreated" <  NOW() - make_interval(weeks => :offset)
    """, {"total": weeks + offset_weeks, "offset": offset_weeks}) or []
    for sem, sku in rows_ml:
        by_week[sem.isoformat()].add(sku)

    rows_tn = q(eng, """
        SELECT DATE_TRUNC('week', tno.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS semana,
               oi.sku
        FROM public.tienda_nube_order_items oi
        JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
        WHERE tno.payment_status::text = 'paid'
          AND oi.sku IS NOT NULL
          AND tno.created_at >= NOW() - make_interval(weeks => :total)
          AND tno.created_at <  NOW() - make_interval(weeks => :offset)
    """, {"total": weeks + offset_weeks, "offset": offset_weeks}) or []
    for sem, sku in rows_tn:
        by_week[sem.isoformat()].add(sku)

    points = [
        {
            "date": semana,
            "skus_activos": len(skus),
            "pct_activo": round(len(skus) / total_publicados * 100, 2),
        }
        for semana, skus in sorted(by_week.items())
    ]
    return points, total_publicados


def catalog_active(weeks: int = 52, unit: str = "unistore") -> dict:
    if unit == "unidrop":
        points, total_publicados = _catalog_active_unidrop(weeks)
        prev, _ = _catalog_active_unidrop(weeks, offset_weeks=weeks)
        universe_label = "SKUs distintos vendidos en 12m"
    else:
        points, total_publicados = _catalog_active_unistore(weeks)
        prev, _ = _catalog_active_unistore(weeks, offset_weeks=weeks)
        universe_label = "SKUs publicados en TN"

    story = _enrich_series(points, "pct_activo", date_fmt=_fmt_date, prev_points=prev)

    insight = _insight_catalog(story, points, unit)

    return {
        "weeks": weeks,
        "unit": unit,
        "total_publicados": total_publicados,
        "universe_label": universe_label,
        "points": points,
        "story": story,
        "insight": insight,
        "summary": {
            "promedio_pct": round(sum(p["pct_activo"] for p in points) / len(points), 2) if points else 0,
            "max_pct": max((p["pct_activo"] for p in points), default=0),
            "ultimo_pct": points[-1]["pct_activo"] if points else 0,
        },
        "generated_at": now_ar().isoformat(),
    }


def _insight_catalog(story: dict, points: list[dict], unit: str) -> str:
    if not points:
        return "Sin datos de catalogo en el periodo"
    last = points[-1]["pct_activo"]
    avg = story.get("avg") or 0
    diff_vs_avg = ((last - avg) / avg * 100) if avg else 0
    mp = story.get("max_point") or {}
    parts = [f"Ultima semana {last:.1f}% del catalogo activo"]
    if abs(diff_vs_avg) >= 5:
        word = "arriba" if diff_vs_avg > 0 else "abajo"
        parts.append(f"{diff_vs_avg:+.0f}% vs promedio ({word})")
    if mp.get("label"):
        parts.append(f"pico {mp.get('pct_activo', 0):.1f}% el {mp['label']}")
    momentum = story.get("momentum_pct") or 0
    if abs(momentum) >= 5:
        parts.append(f"ultimas semanas {momentum:+.1f}% vs previas")
    return " · ".join(parts)


# ============================================================
# ABC DISTRIBUTION
# ============================================================

def _abc_monthly_unistore(months: int, offset_months: int = 0) -> list[dict]:
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT DATE_TRUNC('month', o."createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
               oi.sku,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= DATE_TRUNC('month', NOW() - make_interval(months => :total))
          AND o."createdAt" <  DATE_TRUNC('month', NOW() - make_interval(months => :offset))
          AND oi.sku IS NOT NULL
          AND oi.sku NOT ILIKE '%PVA%'
        GROUP BY 1, 2
    """, {"total": months + offset_months, "offset": offset_months}) or []
    return _abc_collapse(rows)


def _abc_monthly_unidrop(months: int, offset_months: int = 0) -> list[dict]:
    eng = get_engine("unidrop")
    rows: list[tuple] = []

    rows_ml = q(eng, """
        SELECT DATE_TRUNC('month', o."dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
               oi."sellerSku" AS sku,
               SUM(oi.quantity * oi."unitPrice")::float AS revenue
        FROM mercado_libre_dev."OrderItemMercadoLibre" oi
        JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
        WHERE o."status" = 'paid'
          AND o."number" LIKE 'DROP-%'
          AND oi."sellerSku" IS NOT NULL
          AND o."dateCreated" >= DATE_TRUNC('month', NOW() - make_interval(months => :total))
          AND o."dateCreated" <  DATE_TRUNC('month', NOW() - make_interval(months => :offset))
        GROUP BY 1, 2
    """, {"total": months + offset_months, "offset": offset_months}) or []
    rows.extend(rows_ml)

    rows_tn = q(eng, """
        SELECT DATE_TRUNC('month', tno.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
               oi.sku,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM public.tienda_nube_order_items oi
        JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
        WHERE tno.payment_status::text = 'paid'
          AND oi.sku IS NOT NULL
          AND tno.created_at >= DATE_TRUNC('month', NOW() - make_interval(months => :total))
          AND tno.created_at <  DATE_TRUNC('month', NOW() - make_interval(months => :offset))
        GROUP BY 1, 2
    """, {"total": months + offset_months, "offset": offset_months}) or []
    rows.extend(rows_tn)

    # Mismas SKUs aparecen en TN y ML — sumar revenue
    aggregated: dict[tuple, float] = defaultdict(float)
    for mes, sku, rev in rows:
        aggregated[(mes, sku)] += float(rev or 0)
    flat = [(mes, sku, rev) for (mes, sku), rev in aggregated.items()]
    return _abc_collapse(flat)


def _abc_collapse(rows: list[tuple]) -> list[dict]:
    by_month: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for mes, sku, rev in rows:
        by_month[mes.isoformat() if hasattr(mes, "isoformat") else str(mes)].append((sku, float(rev or 0)))

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
        total_skus = counts["A"] + counts["B"] + counts["C"]
        points.append({
            "date": month_key,
            "skus_a": counts["A"],
            "skus_b": counts["B"],
            "skus_c": counts["C"],
            "rev_a": round(revs["A"], 0),
            "rev_b": round(revs["B"], 0),
            "rev_c": round(revs["C"], 0),
            "total_skus": total_skus,
            "concentracion_a_pct": round(counts["A"] / total_skus * 100, 1) if total_skus > 0 else 0,
        })
    return points


def abc_distribution(months: int = 12, unit: str = "unistore") -> dict:
    if unit == "unidrop":
        points = _abc_monthly_unidrop(months)
        prev = _abc_monthly_unidrop(months, offset_months=months)
    else:
        points = _abc_monthly_unistore(months)
        prev = _abc_monthly_unistore(months, offset_months=months)

    story = _enrich_series(points, "concentracion_a_pct", date_fmt=_fmt_month, prev_points=prev)
    insight = _insight_abc(points, story)

    return {
        "months": months,
        "unit": unit,
        "points": points,
        "story": story,
        "insight": insight,
        "generated_at": now_ar().isoformat(),
    }


def _insight_abc(points: list[dict], story: dict) -> str:
    if not points:
        return "Sin datos ABC en el periodo"
    last = points[-1]
    parts = [f"{last['total_skus']} SKUs vendidos · {last['concentracion_a_pct']:.1f}% son clase A"]
    avg = story.get("avg") or 0
    if avg:
        diff = ((last["concentracion_a_pct"] - avg) / avg * 100) if avg else 0
        if abs(diff) >= 3:
            tag = "concentracion crece (mas riesgo)" if diff > 0 else "concentracion baja (catalogo mas saludable)"
            parts.append(f"{tag}, {diff:+.1f}% vs promedio")
    trend = story.get("trend")
    ts = story.get("trend_strength") or 0
    if trend == "up":
        parts.append(f"clase A creciendo ({ts:+.1f}%)")
    elif trend == "down":
        parts.append(f"clase A diluyendose ({ts:+.1f}%)")
    return " · ".join(parts)


# ============================================================
# CROSS CORRELATIONS - lecturas cruzadas
# ============================================================

def cross_correlations(unit: str = "unistore") -> dict:
    """Lee los 3 indicadores principales (ganancia, catalogo activo,
    concentracion A) y genera lecturas cruzadas:
    - catalogo activo cayendo + ganancia cayendo -> contraccion real
    - concentracion A subiendo + ganancia subiendo -> apoyado en pocos SKUs (riesgo)
    - catalogo activo subiendo + ganancia plana -> agregando SKUs sin convertir
    """
    p_data = profit_daily(90, unit=unit)
    c_data = catalog_active(26, unit=unit)
    a_data = abc_distribution(6, unit=unit)

    p_pts = p_data["points"]
    c_pts = c_data["points"]
    a_pts = a_data["points"]

    insights: list[dict] = []

    def _first_last_pct(pts: list[dict], key: str) -> tuple[float, float, float]:
        if not pts:
            return (0.0, 0.0, 0.0)
        # promedio primer tercio vs ultimo tercio (suaviza ruido)
        n = len(pts)
        third = max(1, n // 3)
        first_avg = sum(float(p.get(key) or 0) for p in pts[:third]) / third
        last_avg = sum(float(p.get(key) or 0) for p in pts[-third:]) / third
        diff = ((last_avg - first_avg) / first_avg * 100) if first_avg else 0
        return (first_avg, last_avg, diff)

    _, _, gan_diff = _first_last_pct(p_pts, "ganancia")
    _, last_cat, cat_diff = _first_last_pct(c_pts, "pct_activo")
    _, _, abc_diff = _first_last_pct(a_pts, "concentracion_a_pct")

    # 1) Salud general: catalogo activo + ganancia
    if cat_diff < -10 and gan_diff < -10:
        insights.append({
            "severity": "warn",
            "title": "Contraccion del catalogo + ganancia bajando",
            "body": f"El catalogo activo cayo {cat_diff:.0f}% y la ganancia {gan_diff:.0f}% en el periodo. Indicador de contraccion real (no compensa).",
        })
    elif cat_diff > 10 and gan_diff > 10:
        insights.append({
            "severity": "good",
            "title": "Catalogo y ganancia creciendo juntos",
            "body": f"Catalogo activo {cat_diff:+.0f}% y ganancia {gan_diff:+.0f}%. Crecimiento bien distribuido.",
        })
    elif cat_diff > 5 and gan_diff < -5:
        insights.append({
            "severity": "warn",
            "title": "Sumando SKUs sin convertir",
            "body": f"El catalogo activo subio {cat_diff:.0f}% pero la ganancia cayo {gan_diff:.0f}%. Hay SKUs que se publican y no rinden.",
        })
    elif cat_diff < -5 and gan_diff > 5:
        insights.append({
            "severity": "neutral",
            "title": "Menos SKUs activos · mas ganancia",
            "body": f"El catalogo cayo {cat_diff:.0f}% pero la ganancia subio {gan_diff:.0f}%. Mas concentracion en los SKUs que rinden.",
        })

    # 2) Concentracion A + ganancia
    if abc_diff > 5 and gan_diff > 5:
        insights.append({
            "severity": "warn",
            "title": "Apoyado en pocos SKUs (concentracion creciente)",
            "body": f"La clase A crecio {abc_diff:+.1f}% y la ganancia {gan_diff:+.1f}%. El negocio se vuelve mas dependiente de un puñado de SKUs (riesgo si caen).",
        })
    elif abc_diff < -5 and gan_diff > 5:
        insights.append({
            "severity": "good",
            "title": "Mas SKUs aportan al revenue",
            "body": f"La concentracion A bajo {abc_diff:.1f}% y la ganancia subio {gan_diff:+.1f}%. El catalogo esta diluyendo el riesgo.",
        })
    elif abc_diff > 8:
        insights.append({
            "severity": "neutral",
            "title": "Concentracion ABC creciente",
            "body": f"La clase A crecio {abc_diff:+.1f}% en el semestre. Monitorear dependencia.",
        })

    # 3) Outliers de ganancia
    outliers = p_data["story"].get("outliers") or []
    big_drops = [o for o in outliers if o.get("direction") == "down"]
    big_jumps = [o for o in outliers if o.get("direction") == "up"]
    if big_drops:
        worst = min(big_drops, key=lambda o: o.get("z", 0))
        insights.append({
            "severity": "warn",
            "title": f"Caida atipica el {worst['label']}",
            "body": f"Ese dia la ganancia fue {worst.get('value', 0):,.0f} (z={worst.get('z', 0)}). Vale revisar que paso ese dia.",
        })
    if big_jumps:
        best = max(big_jumps, key=lambda o: o.get("z", 0))
        insights.append({
            "severity": "good",
            "title": f"Pico atipico el {best['label']}",
            "body": f"Ese dia la ganancia fue {best.get('value', 0):,.0f} (z={best.get('z', 0)}). Replicable?",
        })

    if not insights:
        insights.append({
            "severity": "neutral",
            "title": "Periodo estable",
            "body": "No hay divergencias relevantes entre catalogo activo, concentracion y ganancia.",
        })

    return {
        "unit": unit,
        "insights": insights,
        "deltas": {
            "ganancia_pct": round(gan_diff, 1),
            "catalogo_activo_pct": round(cat_diff, 1),
            "concentracion_a_pct": round(abc_diff, 1),
        },
        "generated_at": now_ar().isoformat(),
    }
