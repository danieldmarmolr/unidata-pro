"""
Dashboard SaaS Metrics - Unidrop.
KPIs de salud del negocio SaaS: usuarios, suscripciones, MRR-proxy, churn,
funnel de activacion, segmentacion por personeria.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def saas_unidrop(period: str = "30d", segment: str = "all") -> dict:
    """
    period: 7d|30d|90d|12m
    segment: all | b2b (Juridica) | b2c (Fisica)
    """
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unidrop")

    seg_filter = ""
    if segment == "b2b":
        seg_filter = " AND personeria = 'Juridica' "
    elif segment == "b2c":
        seg_filter = " AND personeria = 'Fisica' "

    p = {"days": days}

    # ---------- Cards ----------
    cards: list[dict] = []

    total_users = int(scalar(eng, f'SELECT COUNT(*) FROM public."User" WHERE 1=1 {seg_filter}') or 0)
    active_subs = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription > NOW()
          AND COALESCE("isActive", true) IS TRUE
          {seg_filter}
    """) or 0)
    new_users = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
        {seg_filter}
    """, p) or 0)
    new_users_prev = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
          {seg_filter}
    """, {"days": days, "days2": days * 2}) or 0)
    delta_new = ((new_users - new_users_prev) / new_users_prev * 100) if new_users_prev > 0 else None

    churned = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription IS NOT NULL
          AND end_date_subscription >= NOW() - make_interval(days => :days)
          AND end_date_subscription <= NOW()
        {seg_filter}
    """, p) or 0)
    churn_rate = (churned / active_subs * 100) if active_subs > 0 else 0

    expiring_7d = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        {seg_filter}
    """) or 0)

    stores_active = int(scalar(eng, """
        SELECT COUNT(DISTINCT store_id) FROM public."TiendaNubeCredential"
        WHERE store_id IS NOT NULL
    """) or 0)

    cards.append({"label": "Usuarios totales", "value": total_users, "hint": f"Segmento: {segment.upper()}"})
    cards.append({"label": "Suscripciones activas", "value": active_subs,
                  "hint": f"{(active_subs/total_users*100):.1f}% del total" if total_users else ""})
    cards.append({"label": f"Nuevos usuarios ({period})", "value": new_users,
                  "delta": round(delta_new, 1) if delta_new is not None else None,
                  "hint": "Signups nuevos en el periodo"})
    cards.append({"label": "Churn (periodo)", "value": churned, "suffix": "",
                  "hint": f"~{churn_rate:.1f}% de la base activa"})
    cards.append({"label": "Suscripciones a vencer (7d)", "value": expiring_7d,
                  "hint": "Riesgo de churn proximo"})
    cards.append({"label": "Tiendas TN conectadas", "value": stores_active,
                  "hint": "TiendaNubeCredential unicas"})

    # ---------- Tendencias mensuales ----------
    series: list[dict] = []
    rows = q(eng, f"""
        SELECT date_trunc('month', "createdAt")::date AS mes, COUNT(*)::int AS n
        FROM public."User"
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        {seg_filter}
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Signups por mes",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    rows = q(eng, f"""
        SELECT date_trunc('month', start_date_subscription)::date AS mes, COUNT(*)::int
        FROM public."User"
        WHERE start_date_subscription >= date_trunc('month', NOW() - INTERVAL '11 months')
        {seg_filter}
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Suscripciones nuevas",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    rows = q(eng, f"""
        SELECT date_trunc('month', end_date_subscription)::date AS mes, COUNT(*)::int
        FROM public."User"
        WHERE end_date_subscription >= date_trunc('month', NOW() - INTERVAL '11 months')
          AND end_date_subscription <= NOW()
        {seg_filter}
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Churn",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    # ---------- Funnel de activacion ----------
    f1 = total_users
    f2 = int(scalar(eng, f"""
        SELECT COUNT(DISTINCT u.id)
        FROM public."User" u
        JOIN public."TiendaNubeCredential" t ON t.store_id = u.store_id
        WHERE 1=1 {seg_filter.replace("personeria","u.personeria")}
    """) or 0)
    f3 = int(scalar(eng, f"""
        SELECT COUNT(*) FROM public."User"
        WHERE "mercadoLibreAccountId" IS NOT NULL
        {seg_filter}
    """) or 0)
    f4 = int(scalar(eng, """
        SELECT COUNT(DISTINCT "userId")
        FROM mercado_libre_dev."PublicationUserMercadoLibre"
        WHERE "userId" IS NULL OR "userId" IS NOT NULL
    """) or 0)
    # Dado que PublicationUserMercadoLibre no tiene userId visible, usamos publications totales
    f4 = int(scalar(eng, """
        SELECT COUNT(DISTINCT "mlAccountId")
        FROM mercado_libre_dev."PublicationUserMercadoLibre"
        WHERE status = 'active' OR status IS NOT NULL
    """) or 0)
    f5 = int(scalar(eng, """
        SELECT COUNT(DISTINCT user_id)
        FROM public.tienda_nube_orders
        WHERE user_id IS NOT NULL
    """) or 0)

    funnel = [
        {"category": "1. Sign-up", "value": float(f1)},
        {"category": "2. Conecta TN", "value": float(f2)},
        {"category": "3. Conecta ML", "value": float(f3)},
        {"category": "4. Publica en ML", "value": float(f4)},
        {"category": "5. Primera venta TN", "value": float(f5)},
    ]

    # ---------- Distribucion personeria ----------
    rows = q(eng, """
        SELECT COALESCE(personeria::text, 'sin definir') AS persona, COUNT(*)::int
        FROM public."User"
        GROUP BY 1 ORDER BY 2 DESC
    """) or []
    persona_distribution = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # ---------- Top usuarios por orders procesadas ----------
    rows = q(eng, """
        SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
               u.personeria::text AS persona,
               COUNT(o.tienda_nube_id)::int AS orders,
               COALESCE(SUM(o.total),0)::float AS revenue
        FROM public."User" u
        JOIN public.tienda_nube_orders o ON o.user_id = u.id
        WHERE o."created_at" IS NOT NULL
        GROUP BY u.id, u.fantasy_name, u.name, u.email, u.personeria
        ORDER BY revenue DESC
        LIMIT 15
    """) or []
    top_users = [{
        "category": r[1] or f"User {r[0]}",
        "value": float(r[4] or 0),
        "extra": {"orders": int(r[3] or 0), "persona": r[2] or "?"},
    } for r in rows]

    # ---------- Estados de suscripcion ----------
    rows = q(eng, f"""
        SELECT COALESCE(subscription_status::text, 'sin estado') AS st, COUNT(*)::int
        FROM public."User"
        WHERE 1=1 {seg_filter}
        GROUP BY 1 ORDER BY 2 DESC
    """) or []
    sub_status = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    return {
        "period": period,
        "segment": segment,
        "cards": cards,
        "trends": series,
        "funnel": funnel,
        "persona_distribution": persona_distribution,
        "subscription_status": sub_status,
        "top_users": top_users,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
