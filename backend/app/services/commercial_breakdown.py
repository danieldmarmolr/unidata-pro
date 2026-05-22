"""
Desglose comercial cross-organizacion para la seccion Comercial del panel Gerencia.

Devuelve:
- time_series: serie temporal con granularidad ajustable (day/week/month/quarter)
              por cada canal (TN Unistore, ML Unistore, TN Unidrop, ML Unidrop, Subs MELI)
- channel_share: snapshot del periodo total con % share por canal y unidad
- top_skus_by_profit: ranking SKUs Unistore por ganancia neta + share del total
- top_customers: ranking clientes TN Unistore por revenue + ganancia estimada
- summary: totales del periodo
"""
from __future__ import annotations

import datetime as dt
import logging
from datetime import date, timedelta
from typing import Literal

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services.profit_engine import cost_index_unistore, calc_profit

log = logging.getLogger("unidata.commercial")

# Mapping seguro de granularity → SQL date_trunc unit
_GRANULARITY_MAP = {
    "day": "day",
    "week": "week",
    "month": "month",
    "quarter": "quarter",
}

# Etiquetas legibles para front
CHANNEL_LABELS = {
    "tn_unistore": "Unistore · Tienda Nube",
    "ml_unistore": "Unistore · Mercado Libre",
    "tn_unidrop": "Unidrop · Tienda Nube",
    "ml_unidrop": "Unidrop · Mercado Libre",
    "subs_unidrop": "Unidrop · Suscripciones MELI",
}

UNIT_OF_CHANNEL = {
    "tn_unistore": "unistore",
    "ml_unistore": "unistore",
    "tn_unidrop": "unidrop",
    "ml_unidrop": "unidrop",
    "subs_unidrop": "unidrop",
}


def _safe_gran(g: str) -> str:
    return _GRANULARITY_MAP.get(g, "month")


# ---------------------------------------------------------------------------
# Time series por canal con granularidad ajustable
# ---------------------------------------------------------------------------

def _series_unistore_tn(gran: str, since_iso: str) -> list[tuple]:
    """Revenue diario/semanal/mensual TN Unistore."""
    eng = get_engine("unistore")
    sql = f"""
        SELECT date_trunc('{gran}', "createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS bucket,
               COALESCE(SUM(total), 0)::float AS revenue
        FROM tienda_nube."Order"
        WHERE "paymentStatus" = 'paid'
          AND "createdAt" >= :since
        GROUP BY 1 ORDER BY 1
    """
    return q(eng, sql, {"since": since_iso}) or []


def _series_unistore_ml(gran: str, since_iso: str) -> list[tuple]:
    eng = get_engine("unistore")
    sql = f"""
        SELECT date_trunc('{gran}', date_created AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS bucket,
               COALESCE(SUM(total_amount), 0)::float AS revenue
        FROM meli.meli_orders
        WHERE status IN ('paid','confirmed','shipped','delivered')
          AND date_created >= :since
        GROUP BY 1 ORDER BY 1
    """
    return q(eng, sql, {"since": since_iso}) or []


def _series_unidrop_tn(gran: str, since_iso: str) -> list[tuple]:
    eng = get_engine("unidrop")
    sql = f"""
        SELECT date_trunc('{gran}', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS bucket,
               COALESCE(SUM(total), 0)::float AS revenue
        FROM public.tienda_nube_orders
        WHERE payment_status::text = 'paid'
          AND created_at >= :since
        GROUP BY 1 ORDER BY 1
    """
    return q(eng, sql, {"since": since_iso}) or []


def _series_unidrop_ml(gran: str, since_iso: str) -> list[tuple]:
    eng = get_engine("unidrop")
    sql = f"""
        SELECT date_trunc('{gran}', "dateCreated" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS bucket,
               COALESCE(SUM("totalAmount"), 0)::float AS revenue
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE status IN ('paid','confirmed','shipped','delivered')
          AND "dateCreated" >= :since
        GROUP BY 1 ORDER BY 1
    """
    return q(eng, sql, {"since": since_iso}) or []


def _series_subs_unidrop(gran: str, since_iso: str) -> list[tuple]:
    """Suscripciones MELI cobradas (PaymentIntentSubscription PROCESSED)."""
    eng = get_engine("unidrop")
    sql = f"""
        SELECT date_trunc('{gran}', "createdAt" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS bucket,
               COALESCE(SUM("paidAmount"), 0)::float AS revenue
        FROM public."PaymentIntentSubscription"
        WHERE status::text = 'PROCESSED'
          AND "createdAt" >= :since
        GROUP BY 1 ORDER BY 1
    """
    return q(eng, sql, {"since": since_iso}) or []


def time_series(gran: str, since: date) -> dict:
    """Combina todas las series por canal en un solo dict ordenado por bucket."""
    gran_safe = _safe_gran(gran)
    since_iso = since.isoformat()

    by_bucket: dict[str, dict[str, float]] = {}

    def _accum(rows: list[tuple], key: str) -> None:
        for bucket_date, rev in rows:
            if bucket_date is None:
                continue
            b = bucket_date.isoformat()
            slot = by_bucket.setdefault(b, {})
            slot[key] = slot.get(key, 0.0) + float(rev or 0)

    try:
        _accum(_series_unistore_tn(gran_safe, since_iso), "tn_unistore")
    except Exception as exc:
        log.warning("series tn_unistore: %s", exc)
    try:
        _accum(_series_unistore_ml(gran_safe, since_iso), "ml_unistore")
    except Exception as exc:
        log.warning("series ml_unistore: %s", exc)
    try:
        _accum(_series_unidrop_tn(gran_safe, since_iso), "tn_unidrop")
    except Exception as exc:
        log.warning("series tn_unidrop: %s", exc)
    try:
        _accum(_series_unidrop_ml(gran_safe, since_iso), "ml_unidrop")
    except Exception as exc:
        log.warning("series ml_unidrop: %s", exc)
    try:
        _accum(_series_subs_unidrop(gran_safe, since_iso), "subs_unidrop")
    except Exception as exc:
        log.warning("series subs_unidrop: %s", exc)

    points = []
    for bucket in sorted(by_bucket.keys()):
        row = by_bucket[bucket]
        total = sum(row.values())
        point = {"bucket": bucket, "total": round(total, 0)}
        for ch in CHANNEL_LABELS:
            point[ch] = round(row.get(ch, 0.0), 0)
        points.append(point)

    return {"granularity": gran_safe, "points": points}


# ---------------------------------------------------------------------------
# Channel share del periodo total
# ---------------------------------------------------------------------------

def channel_share(points: list[dict]) -> dict:
    """Agregado total por canal + share % + agrupacion por unidad."""
    totals: dict[str, float] = {ch: 0.0 for ch in CHANNEL_LABELS}
    for p in points:
        for ch in CHANNEL_LABELS:
            totals[ch] += float(p.get(ch, 0) or 0)
    grand = sum(totals.values()) or 1.0

    by_channel = [
        {
            "channel": ch,
            "label": CHANNEL_LABELS[ch],
            "unit": UNIT_OF_CHANNEL[ch],
            "revenue": round(totals[ch], 0),
            "share_pct": round(totals[ch] / grand * 100, 2),
        }
        for ch in CHANNEL_LABELS
    ]

    # Agrupacion por unidad
    by_unit: dict[str, float] = {}
    for ch in CHANNEL_LABELS:
        unit = UNIT_OF_CHANNEL[ch]
        by_unit[unit] = by_unit.get(unit, 0.0) + totals[ch]

    by_unit_list = [
        {
            "unit": u,
            "label": "Unistore (retail propio)" if u == "unistore" else "Unidrop (plataforma)",
            "revenue": round(rev, 0),
            "share_pct": round(rev / grand * 100, 2),
        }
        for u, rev in by_unit.items()
    ]

    return {
        "total": round(grand, 0),
        "by_channel": sorted(by_channel, key=lambda x: -x["revenue"]),
        "by_unit": sorted(by_unit_list, key=lambda x: -x["revenue"]),
    }


# ---------------------------------------------------------------------------
# Top SKUs por ganancia (Unistore TN + ML, agregando costo del lote)
# ---------------------------------------------------------------------------

def top_skus_by_profit(since: date, top_n: int = 20) -> dict:
    """SKUs Unistore con mayor ganancia neta en la ventana, con share del total."""
    try:
        cost_idx = cost_index_unistore()
        eng = get_engine("unistore")
        since_iso = since.isoformat()
        rows = q(eng, """
            SELECT sku,
                   MAX(name) AS name,
                   SUM(units)::int AS units,
                   SUM(revenue)::float AS revenue,
                   SUM(CASE WHEN canal='tn' THEN revenue ELSE 0 END)::float AS rev_tn,
                   SUM(CASE WHEN canal='ml' THEN revenue ELSE 0 END)::float AS rev_ml,
                   SUM(CASE WHEN canal='tn' THEN units ELSE 0 END)::int AS units_tn,
                   SUM(CASE WHEN canal='ml' THEN units ELSE 0 END)::int AS units_ml
            FROM (
                SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units,
                       SUM(oi.quantity * oi.price)::float AS revenue, 'tn' AS canal
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus"='paid' AND o."createdAt" >= :since
                  AND oi.sku IS NOT NULL AND TRIM(oi.sku) <> ''
                GROUP BY oi.sku
                UNION ALL
                SELECT mi.seller_sku, MAX(mi.title), SUM(mi.quantity)::int,
                       SUM(mi.unit_price * mi.quantity)::float, 'ml' AS canal
                FROM meli.meli_order_items mi
                JOIN meli.meli_orders mo ON mo.id = mi.order_id
                WHERE mo.status IN ('paid','confirmed','shipped','delivered')
                  AND mo.date_created >= :since
                  AND mi.seller_sku IS NOT NULL AND TRIM(mi.seller_sku) <> ''
                GROUP BY mi.seller_sku
            ) x
            GROUP BY sku
        """, {"since": since_iso}) or []

        all_skus: list[dict] = []
        total_profit = 0.0
        for sku, name, units, revenue, rev_tn, rev_ml, units_tn, units_ml in rows:
            rev = float(revenue or 0)
            u = int(units or 0)
            if not rev or u == 0:
                continue
            rec = cost_idx.get((sku or "").strip().lower())
            ganancia = 0.0
            costo = 0.0
            has_cost = False
            margen_pct = 0.0
            if rec and rec.get("costo_con_iva"):
                sin_iva = float(rec.get("costo_sin_iva") or 0)
                con_iva = float(rec.get("costo_con_iva") or sin_iva)
                pb = calc_profit(
                    ingreso_bruto=rev,
                    costo_sin_iva=sin_iva * u,
                    costo_con_iva=con_iva * u,
                    is_cash=False,
                    iva_aliquot_override=rec.get("iva_aliquot"),
                )
                ganancia = pb.ganancia_neta
                costo = con_iva * u
                margen_pct = pb.margen_pct
                has_cost = True
                total_profit += ganancia
            all_skus.append({
                "sku": sku,
                "name": (name or sku)[:80],
                "units": u,
                "units_tn": int(units_tn or 0),
                "units_ml": int(units_ml or 0),
                "revenue": round(rev, 0),
                "rev_tn": round(float(rev_tn or 0), 0),
                "rev_ml": round(float(rev_ml or 0), 0),
                "costo": round(costo, 0),
                "ganancia_neta": round(ganancia, 0),
                "margen_pct": round(margen_pct, 1),
                "has_cost": has_cost,
                "share_pct": 0.0,  # se completa abajo
            })

        # Sort por ganancia descendente y agregar share %
        with_cost = [s for s in all_skus if s["has_cost"]]
        without_cost = [s for s in all_skus if not s["has_cost"]]
        with_cost.sort(key=lambda x: -x["ganancia_neta"])
        if total_profit > 0:
            for s in with_cost:
                s["share_pct"] = round(s["ganancia_neta"] / total_profit * 100, 2)

        return {
            "rows": with_cost[:top_n],
            "without_cost_count": len(without_cost),
            "total_profit_period": round(total_profit, 0),
            "error": None,
        }
    except Exception as exc:
        log.warning("top_skus_by_profit: %s", exc)
        return {"rows": [], "without_cost_count": 0, "total_profit_period": 0, "error": str(exc)}


# ---------------------------------------------------------------------------
# Top clientes Unistore por ganancia (TN tiene customerId, ML aggrega por buyer)
# ---------------------------------------------------------------------------

def top_customers_by_profit(since: date, top_n: int = 20) -> dict:
    """Clientes con mayor revenue/ganancia en el periodo (Unistore TN + ML).

    Para ganancia: aproximamos como revenue × margen_promedio_del_periodo
    porque atribuir ganancia per-orden requiere expandir item-by-item, demasiado pesado
    para el panel. La ganancia per-cliente queda como ESTIMACION clara en el frontend.
    """
    try:
        eng = get_engine("unistore")
        since_iso = since.isoformat()

        # Margen promedio del periodo (de los SKUs con costo cargado)
        skus = top_skus_by_profit(since, top_n=10_000)
        total_rev_with_cost = sum(s["revenue"] for s in skus["rows"]) or 1.0
        margen_promedio = (skus["total_profit_period"] / total_rev_with_cost) if total_rev_with_cost else 0

        # Top clientes TN (Unistore)
        tn_rows = q(eng, """
            SELECT o."customerId" AS cid,
                   MAX(c."firstName") || ' ' || COALESCE(MAX(c."lastName"), '') AS nombre,
                   MAX(c.email) AS email,
                   COUNT(DISTINCT o.id)::int AS ordenes,
                   COALESCE(SUM(o.total), 0)::float AS revenue,
                   MAX(o."createdAt")::text AS last_order
            FROM tienda_nube."Order" o
            LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= :since
              AND o."customerId" IS NOT NULL
            GROUP BY o."customerId"
            ORDER BY revenue DESC LIMIT :lim
        """, {"since": since_iso, "lim": top_n * 3}) or []  # 3x para luego mergear ML

        # Top clientes ML (por buyer.id si existe)
        ml_rows = q(eng, """
            SELECT mo.buyer_id::text AS cid,
                   MAX(mo.buyer_nickname) AS nombre,
                   MAX(mo.buyer_first_name) || ' ' || COALESCE(MAX(mo.buyer_last_name), '') AS email,
                   COUNT(*)::int AS ordenes,
                   COALESCE(SUM(mo.total_amount), 0)::float AS revenue,
                   MAX(mo.date_created)::text AS last_order
            FROM meli.meli_orders mo
            WHERE mo.status IN ('paid','confirmed','shipped','delivered')
              AND mo.date_created >= :since
              AND mo.buyer_id IS NOT NULL
            GROUP BY mo.buyer_id
            ORDER BY revenue DESC LIMIT :lim
        """, {"since": since_iso, "lim": top_n * 3}) or []

        merged = []
        for cid, nombre, email, ordenes, rev, last in tn_rows:
            merged.append({
                "customer_key": f"tn:{cid}",
                "nombre": (nombre or email or "?").strip(),
                "channel": "tn",
                "channel_label": "Tienda Nube",
                "ordenes": int(ordenes or 0),
                "revenue": round(float(rev or 0), 0),
                "ganancia_estimada": round(float(rev or 0) * margen_promedio, 0),
                "last_order": last,
            })
        for cid, nombre, email, ordenes, rev, last in ml_rows:
            merged.append({
                "customer_key": f"ml:{cid}",
                "nombre": (nombre or email or "?").strip() or f"ML user {cid}",
                "channel": "ml",
                "channel_label": "Mercado Libre",
                "ordenes": int(ordenes or 0),
                "revenue": round(float(rev or 0), 0),
                "ganancia_estimada": round(float(rev or 0) * margen_promedio, 0),
                "last_order": last,
            })

        merged.sort(key=lambda x: -x["ganancia_estimada"])
        return {
            "rows": merged[:top_n],
            "margen_promedio_usado_pct": round(margen_promedio * 100, 1),
            "error": None,
        }
    except Exception as exc:
        log.warning("top_customers_by_profit: %s", exc)
        return {"rows": [], "margen_promedio_usado_pct": 0, "error": str(exc)}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def commercial_breakdown(
    granularity: str = "month",
    period_months: int = 12,
    top_n_skus: int = 20,
    top_n_customers: int = 20,
) -> dict:
    """Vista comercial completa: serie temporal + share + tops por ganancia."""
    today = date.today()
    since = today - timedelta(days=period_months * 30)

    series = time_series(granularity, since)
    share = channel_share(series["points"])
    skus = top_skus_by_profit(since, top_n=top_n_skus)
    customers = top_customers_by_profit(since, top_n=top_n_customers)

    return {
        "granularity": granularity,
        "period_months": period_months,
        "since": since.isoformat(),
        "channel_labels": CHANNEL_LABELS,
        "channel_units": UNIT_OF_CHANNEL,
        "time_series": series["points"],
        "channel_share": share,
        "top_skus_by_profit": skus,
        "top_customers": customers,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
