"""
Suscripciones MELI - integracion paid de los operadores Unidrop con MercadoLibre.
Analitica DISTINTA a Pagos Talo (que es el flujo de pagos de orders).
Usa: SubscriptionMeli (planes), PaymentIntentSubscription (intents) y
PaymentTransactionSubscription (cobros).
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def subscriptions_meli(period: str = "30d", plan: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """
    period: 7d|30d|90d|12m
    plan: 'all' | '1' | '2' | '3' | '4'  (id del plan SubscriptionMeli)
    """
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days, "days2": days * 2}
    plan_filter = ""
    if plan != "all":
        plan_filter = f' AND "subscriptionMeliId" = {int(plan)} '

    cards: list[dict] = []

    # MRR proxy: monto procesado en periodo
    revenue = float(scalar(eng, f"""
        SELECT COALESCE(SUM("paidAmount"),0)::float
        FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND status::text = 'PROCESSED'
          {plan_filter}
    """, p) or 0)
    revenue_prev = float(scalar(eng, f"""
        SELECT COALESCE(SUM("paidAmount"),0)::float
        FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
          AND status::text = 'PROCESSED'
          {plan_filter}
    """, p) or 0)
    delta_rev = ((revenue - revenue_prev) / revenue_prev * 100) if revenue_prev > 0 else None
    cards.append({
        "label": f"Cobrado MELI ({period})",
        "value": round(revenue, 0), "prefix": "$ ",
        "delta": round(delta_rev, 1) if delta_rev is not None else None,
        "hint": "Monto efectivo procesado",
    })

    # Pendiente acumulado
    pending = float(scalar(eng, f"""
        SELECT COALESCE(SUM("expectedAmount"),0)::float
        FROM public."PaymentIntentSubscription"
        WHERE status::text = 'PENDING' {plan_filter}
    """) or 0)
    cards.append({
        "label": "Pendiente de cobro",
        "value": round(pending, 0), "prefix": "$ ",
        "hint": "Intents en estado PENDING (no cancelados)",
    })

    # Conversion rate del periodo
    intents_total = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days) {plan_filter}
    """, p) or 0)
    intents_processed = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND status::text='PROCESSED' {plan_filter}
    """, p) or 0)
    conv = (intents_processed / intents_total * 100) if intents_total else 0
    cards.append({
        "label": "Tasa de conversion",
        "value": round(conv, 1), "suffix": "%",
        "hint": f"{intents_processed:,} de {intents_total:,} intents",
    })

    # Cancelados en el periodo
    cancelled = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND status::text='CANCELLED' {plan_filter}
    """, p) or 0)
    cancelled_amount = float(scalar(eng, f"""
        SELECT COALESCE(SUM("expectedAmount"),0)::float FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
          AND status::text='CANCELLED' {plan_filter}
    """, p) or 0)
    cards.append({
        "label": "Intents cancelados",
        "value": cancelled,
        "hint": f"$ {cancelled_amount:,.0f} no recuperado",
    })

    # Suscripciones activas distintas (User con sub vigente que matcheen plan)
    active = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription > NOW()
          AND COALESCE("isActive",true) IS TRUE
          {('AND "subscriptionId" = ' + str(int(plan))) if plan != 'all' else ''}
    """) or 0)
    cards.append({
        "label": "Usuarios activos en plan",
        "value": active,
        "hint": "Subs vigentes (end_date > now)",
    })

    # Volumen mensual 12m: paid + pending + cancelled
    rows = q(eng, f"""
        SELECT date_trunc('month',"createdAt")::date AS mes,
               COUNT(*) FILTER (WHERE status::text='PROCESSED') AS proc_n,
               SUM("paidAmount") FILTER (WHERE status::text='PROCESSED') AS proc_amt,
               COUNT(*) FILTER (WHERE status::text='PENDING') AS pen_n,
               COUNT(*) FILTER (WHERE status::text='CANCELLED') AS can_n
        FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
          {plan_filter}
        GROUP BY 1 ORDER BY 1
    """) or []
    series = [
        {
            "label": "Cobrado",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[2] or 0)} for r in rows],
        },
        {
            "label": "Intents creados",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0) + float(r[3] or 0) + float(r[4] or 0)} for r in rows],
        },
        {
            "label": "Cancelados",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[4] or 0)} for r in rows],
        },
    ]

    # Distribucion por plan (con nombre)
    rows = q(eng, f"""
        SELECT pis."subscriptionMeliId" AS plan_id,
               sm.name,
               sm.price::float AS price,
               sm.number_of_publications_allowed AS pubs,
               COUNT(*) FILTER (WHERE pis.status::text='PROCESSED') AS processed,
               COUNT(*) FILTER (WHERE pis.status::text='PENDING') AS pending,
               COUNT(*) FILTER (WHERE pis.status::text='CANCELLED') AS cancelled,
               COALESCE(SUM(pis."paidAmount"),0)::float AS paid
        FROM public."PaymentIntentSubscription" pis
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = pis."subscriptionMeliId"
        WHERE pis."createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1, 2, 3, 4 ORDER BY paid DESC
    """, p) or []
    by_plan = [{
        "category": f"{r[0]} - {r[1] or 'desconocido'}",
        "value": float(r[7] or 0),
        "extra": {
            "plan_id": int(r[0] or 0),
            "precio": float(r[2] or 0),
            "publicaciones": int(r[3] or 0) if r[3] else 0,
            "processed": int(r[4] or 0),
            "pending": int(r[5] or 0),
            "cancelled": int(r[6] or 0),
        },
    } for r in rows]

    # Distribucion estados
    rows = q(eng, f"""
        SELECT status::text, COUNT(*)::int
        FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days) {plan_filter}
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    status_dist = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # Origen: from_landing
    rows = q(eng, f"""
        SELECT CASE WHEN from_landing THEN 'Desde landing' ELSE 'Desde plataforma' END,
               COUNT(*)::int
        FROM public."PaymentIntentSubscription"
        WHERE "createdAt" >= NOW() - make_interval(days => :days) {plan_filter}
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    origin_dist = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # Top users que pagaron (LTV de subs)
    rows = q(eng, f"""
        SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
               COUNT(*)::int AS subs,
               COALESCE(SUM(pis."paidAmount"),0)::float AS total
        FROM public."PaymentIntentSubscription" pis
        JOIN public."User" u ON u.id = pis."userId"
        WHERE pis.status::text='PROCESSED' {plan_filter}
        GROUP BY u.id, u.fantasy_name, u.name, u.email
        ORDER BY total DESC LIMIT 15
    """) or []
    top_subscribers = [{
        "category": r[1] or f"User {r[0]}",
        "value": float(r[3] or 0),
        "extra": {"subs": int(r[2] or 0), "user_id": int(r[0] or 0)},
    } for r in rows]

    return {
        "period": period,
        "plan": plan,
        "cards": cards,
        "trends": series,
        "by_plan": by_plan,
        "status_dist": status_dist,
        "origin_dist": origin_dist,
        "top_subscribers": top_subscribers,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
