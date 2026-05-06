"""
Dashboard Pagos Talo - Unidrop.
PaymentTransaction + PaymentTransactionSubscription + PaymentIntent.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}

SUCCESS_STATES = ("completed", "succeeded", "approved", "paid", "credited")


def pagos_unidrop(period: str = "30d", flow: str = "all") -> dict:
    """flow: all | orders | subscriptions"""
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unidrop")
    p = {"days": days}

    cards: list[dict] = []

    # tablas a usar segun flow
    use_orders = flow in ("all", "orders")
    use_subs = flow in ("all", "subscriptions")

    # --- Volumen total ---
    vol_orders = float(scalar(eng, """
        SELECT COALESCE(SUM(amount), 0)::float
        FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_orders else 0.0
    vol_subs = float(scalar(eng, """
        SELECT COALESCE(SUM(amount), 0)::float
        FROM public."PaymentTransactionSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_subs else 0.0
    vol_total = vol_orders + vol_subs

    vol_orders_prev = float(scalar(eng, """
        SELECT COALESCE(SUM(amount), 0)::float
        FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0) if use_orders else 0.0
    vol_subs_prev = float(scalar(eng, """
        SELECT COALESCE(SUM(amount), 0)::float
        FROM public."PaymentTransactionSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0) if use_subs else 0.0
    vol_prev = vol_orders_prev + vol_subs_prev
    delta_vol = ((vol_total - vol_prev) / vol_prev * 100) if vol_prev > 0 else None

    # --- Cantidad transacciones ---
    n_orders = int(scalar(eng, """
        SELECT COUNT(*) FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_orders else 0
    n_subs = int(scalar(eng, """
        SELECT COUNT(*) FROM public."PaymentTransactionSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_subs else 0
    n_total = n_orders + n_subs

    # --- Tasa exito (sobre orders flow) ---
    success_states_str = "(" + ", ".join([f"'{s}'" for s in SUCCESS_STATES]) + ")"
    n_success = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND status::text IN {success_states_str}
    """, p) or 0)
    success_rate = (n_success / n_orders * 100) if n_orders > 0 else 0

    # --- Comisiones cobradas ---
    com_orders = float(scalar(eng, """
        SELECT COALESCE(SUM(commission), 0)::float
        FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_orders else 0.0
    com_subs = float(scalar(eng, """
        SELECT COALESCE(SUM(commission), 0)::float
        FROM public."PaymentTransactionSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_subs else 0.0
    com_total = com_orders + com_subs

    cards.append({"label": f"Volumen ({period})", "value": round(vol_total, 0),
                  "prefix": "$ ", "delta": round(delta_vol, 1) if delta_vol is not None else None,
                  "hint": f"Orders {vol_orders:,.0f} / Subs {vol_subs:,.0f}"})
    cards.append({"label": "Transacciones", "value": n_total,
                  "hint": f"{n_orders:,} orders / {n_subs:,} subs"})
    cards.append({"label": "Tasa de exito (orders)", "value": round(success_rate, 1),
                  "suffix": "%", "hint": f"{n_success:,} de {n_orders:,}"})
    cards.append({"label": "Comisiones cobradas", "value": round(com_total, 0),
                  "prefix": "$ ", "hint": f"Orders {com_orders:,.0f} / Subs {com_subs:,.0f}"})

    # --- Volumen diario ---
    parts = []
    if use_orders:
        parts.append("""SELECT date_trunc('day',"createdAt") AS day, amount::float AS amt
                      FROM public."PaymentTransaction"
                      WHERE "createdAt" >= NOW() - make_interval(days => :days)""")
    if use_subs:
        parts.append("""SELECT date_trunc('day',"createdAt") AS day, amount::float
                      FROM public."PaymentTransactionSubscription"
                      WHERE "createdAt" >= NOW() - make_interval(days => :days)""")
    daily_volume = []
    if parts:
        rows = q(eng, f"SELECT day::date, COALESCE(SUM(amt),0)::float FROM ({' UNION ALL '.join(parts)}) x GROUP BY 1 ORDER BY 1", p) or []
        daily_volume = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                         "value": float(r[1] or 0)} for r in rows]

    # --- Distribucion estados ---
    rows = q(eng, """
        SELECT COALESCE(status::text, 'sin estado'), COUNT(*)::int
        FROM public."PaymentTransaction"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    status_dist = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # --- Top customers por volumen ---
    rows = q(eng, """
        SELECT pt."customerAccountId" AS account_id,
               COALESCE(MAX(cpa.name), MAX(cpa.email), 'Account ' || pt."customerAccountId"::text) AS nombre,
               COUNT(*)::int,
               SUM(pt.amount)::float
        FROM public."PaymentTransaction" pt
        LEFT JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pt."customerAccountId"
        WHERE pt."createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY pt."customerAccountId"
        ORDER BY SUM(pt.amount) DESC
        LIMIT 15
    """, p) or []
    top_customers = [{
        "category": r[1] or f"Account {r[0]}",
        "value": float(r[3] or 0),
        "extra": {"transactions": int(r[2] or 0)},
    } for r in rows]

    return {
        "period": period,
        "flow": flow,
        "cards": cards,
        "daily_volume": daily_volume,
        "status_dist": status_dist,
        "top_customers": top_customers,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
