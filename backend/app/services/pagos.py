"""
Pagos Talo - Unidrop. SOLO pagos de ordenes.
Las suscripciones MELI viven en services/subscriptions_meli.py.

Cada PaymentTransaction se asocia a un PaymentIntent que tiene orderIds (TN) o
mlOrderIds (ML). Eso define el canal: la misma unidad de negocio (Unidrop) tiene
dos canales de venta - TN y MELI.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}

SUCCESS_STATES = (
    "completed", "succeeded", "approved", "paid", "credited",
    "processed", "PROCESSED",
)


def _channel_filter(channel: str) -> str:
    """SQL fragment que se inserta despues del JOIN con PaymentIntent."""
    if channel == "tn":
        return ' AND pi."orderIds" IS NOT NULL AND array_length(pi."orderIds",1) > 0 '
    if channel == "ml":
        return ' AND pi."mlOrderIds" IS NOT NULL AND array_length(pi."mlOrderIds",1) > 0 '
    return ""  # all


def pagos_unidrop(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """
    period: 7d|30d|90d|12m
    channel: all | tn | ml
    """
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days, "days2": days * 2}
    chf = _channel_filter(channel)

    cards: list[dict] = []

    # --- Volumen periodo ---
    vol_total = float(scalar(eng, f"""
        SELECT COALESCE(SUM(pt.amount),0)::float
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
    """, p) or 0)
    vol_prev = float(scalar(eng, f"""
        SELECT COALESCE(SUM(pt.amount),0)::float
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days2)
          AND pt."createdAt" <  NOW() - make_interval(days => :days)
        {chf}
    """, p) or 0)
    delta_vol = ((vol_total - vol_prev) / vol_prev * 100) if vol_prev > 0 else None

    cards.append({
        "label": f"Volumen pagos ({period})",
        "value": round(vol_total, 0), "prefix": "$ ",
        "delta": round(delta_vol, 1) if delta_vol is not None else None,
        "hint": "PaymentTransaction sobre ordenes" + (f" - canal {channel.upper()}" if channel != "all" else ""),
    })

    # --- Cantidad transacciones ---
    n_tx = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
    """, p) or 0)
    cards.append({"label": "Transacciones", "value": n_tx})

    # --- Tasa de exito ---
    success_lc = "(" + ", ".join([f"'{s.lower()}'" for s in SUCCESS_STATES]) + ")"
    n_success = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
          AND LOWER(pt.status::text) IN {success_lc}
        {chf}
    """, p) or 0)
    success_rate = (n_success / n_tx * 100) if n_tx > 0 else 0
    cards.append({
        "label": "Tasa de exito",
        "value": round(success_rate, 1), "suffix": "%",
        "hint": f"{n_success:,} de {n_tx:,}",
    })

    # --- Comisiones ---
    com_total = float(scalar(eng, f"""
        SELECT COALESCE(SUM(pt.commission),0)::float
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
    """, p) or 0)
    cards.append({
        "label": "Comisiones cobradas",
        "value": round(com_total, 0), "prefix": "$ ",
    })

    # --- Volumen diario ---
    rows = q(eng, f"""
        SELECT date_trunc('day', pt."createdAt")::date AS day,
               COALESCE(SUM(pt.amount),0)::float AS amt
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
        GROUP BY 1 ORDER BY 1
    """, p) or []
    daily_volume = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                     "value": float(r[1] or 0)} for r in rows]

    # --- Distribucion por canal (siempre full, no filtra por chf) ---
    rows = q(eng, """
        SELECT
            CASE
                WHEN pi."mlOrderIds" IS NOT NULL AND array_length(pi."mlOrderIds",1) > 0 THEN 'Mercado Libre'
                WHEN pi."orderIds" IS NOT NULL AND array_length(pi."orderIds",1) > 0 THEN 'Tienda Nube'
                ELSE 'Sin canal'
            END AS canal,
            COUNT(*)::int AS n,
            COALESCE(SUM(pt.amount),0)::float AS volumen
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 3 DESC
    """, p) or []
    channel_breakdown = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"transacciones": int(r[1] or 0)},
    } for r in rows]

    # --- Distribucion estados ---
    rows = q(eng, f"""
        SELECT COALESCE(pt.status::text,'sin estado'), COUNT(*)::int
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    status_dist = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # --- Top customers ---
    rows = q(eng, f"""
        SELECT pt."customerAccountId" AS account_id,
               COALESCE(MAX(cpa.name), MAX(cpa.email), 'Account ' || pt."customerAccountId"::text) AS nombre,
               COUNT(*)::int,
               COALESCE(SUM(pt.amount),0)::float
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."PaymentIntent" pi ON pi."paymentTransactionId" = pt.id
        LEFT JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pt."customerAccountId"
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        {chf}
        GROUP BY pt."customerAccountId"
        ORDER BY 4 DESC LIMIT 15
    """, p) or []
    top_customers = [{
        "category": r[1] or f"Account {r[0]}",
        "value": float(r[3] or 0),
        "extra": {"transactions": int(r[2] or 0), "account_id": int(r[0] or 0)},
    } for r in rows]

    return {
        "period": period,
        "channel": channel,
        "cards": cards,
        "daily_volume": daily_volume,
        "channel_breakdown": channel_breakdown,
        "status_dist": status_dist,
        "top_customers": top_customers,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
