"""
Dashboard Marketing.
Unistore: clientes, LTV, repeat, geo.
Unidrop: Meta Pixel events, signups, growth.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def marketing_unistore(period: str = "30d") -> dict:
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unistore")
    p = {"days": days}

    cards: list[dict] = []

    new_customers = int(scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Customer"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    new_customers_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Customer"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0)
    delta_new = ((new_customers - new_customers_prev) / new_customers_prev * 100) if new_customers_prev > 0 else None

    total_customers = int(scalar(eng, 'SELECT COUNT(*) FROM tienda_nube."Customer"') or 0)
    repeat_customers = int(scalar(eng, """
        SELECT COUNT(*) FROM (
            SELECT "customerId" FROM tienda_nube."Order"
            WHERE "paymentStatus"='paid' AND "customerId" IS NOT NULL
            GROUP BY "customerId" HAVING COUNT(*) > 1
        ) x
    """) or 0)
    repeat_rate = (repeat_customers / total_customers * 100) if total_customers > 0 else 0

    avg_ltv = float(scalar(eng, """
        SELECT COALESCE(AVG("totalSpent"::float), 0)::float
        FROM tienda_nube."Customer"
        WHERE "totalSpent" IS NOT NULL AND "totalSpent" > 0
    """) or 0)

    accept_marketing = int(scalar(eng, """
        SELECT COUNT(*) FROM tienda_nube."Customer"
        WHERE "acceptsMarketing" = TRUE
    """) or 0)
    accept_rate = (accept_marketing / total_customers * 100) if total_customers > 0 else 0

    cards.append({"label": f"Customers nuevos ({period})", "value": new_customers,
                  "delta": round(delta_new, 1) if delta_new is not None else None})
    cards.append({"label": "Customers totales", "value": total_customers,
                  "hint": "Tabla Customer TN"})
    cards.append({"label": "% Repeat purchase", "value": round(repeat_rate, 1),
                  "suffix": "%", "hint": f"{repeat_customers:,} con >1 orden"})
    cards.append({"label": "LTV promedio", "value": round(avg_ltv, 0),
                  "prefix": "$ ", "hint": "totalSpent > 0"})
    cards.append({"label": "% Acepta marketing", "value": round(accept_rate, 1),
                  "suffix": "%", "hint": f"{accept_marketing:,} optin"})

    # Tendencia mensual nuevos customers 12m
    rows = q(eng, """
        SELECT date_trunc('month', "createdAt")::date, COUNT(*)::int
        FROM tienda_nube."Customer"
        WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    trends = [{
        "label": "Nuevos customers / mes",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    }]

    # Top customers por LTV
    rows = q(eng, """
        SELECT id, COALESCE(name, email, 'sin nombre') AS nombre,
               "totalSpent"::float AS spent,
               COALESCE("billingProvince",'') AS prov,
               "lastOrderId"
        FROM tienda_nube."Customer"
        WHERE "totalSpent" IS NOT NULL
        ORDER BY "totalSpent"::float DESC NULLS LAST
        LIMIT 15
    """) or []
    top_customers = [{
        "category": r[1] or f"Customer {r[0]}",
        "value": float(r[2] or 0),
        "extra": {"province": r[3] or "?", "last_order_id": r[4]},
    } for r in rows]

    # Distribucion por tipo
    rows = q(eng, """
        SELECT COALESCE(NULLIF("customerType",''),'sin tipo'), COUNT(*)::int
        FROM tienda_nube."Customer"
        GROUP BY 1 ORDER BY 2 DESC
    """) or []
    customer_types = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # Cohort retention simplificado (mes-de-alta vs ordenes en cada mes posterior)
    cohort_rows = q(eng, """
        WITH first_order AS (
          SELECT "customerId" AS cid,
                 date_trunc('month', MIN("createdAt"))::date AS cohort
          FROM tienda_nube."Order"
          WHERE "customerId" IS NOT NULL AND "paymentStatus"='paid'
          GROUP BY 1
        )
        SELECT fo.cohort,
               date_trunc('month', o."createdAt")::date AS mes,
               COUNT(DISTINCT o."customerId")::int
        FROM first_order fo
        JOIN tienda_nube."Order" o ON o."customerId" = fo.cid
        WHERE fo.cohort >= date_trunc('month', NOW() - INTERVAL '5 months')
          AND o."paymentStatus"='paid'
        GROUP BY 1, 2
        ORDER BY 1, 2
    """) or []
    # Pivot a JSON
    cohort_map: dict[str, dict[str, int]] = {}
    for cohort_d, mes_d, n in cohort_rows:
        ch = cohort_d.strftime("%Y-%m")
        m = mes_d.strftime("%Y-%m")
        cohort_map.setdefault(ch, {})[m] = int(n or 0)
    cohort = [{"cohort": k, "data": v} for k, v in sorted(cohort_map.items())]

    # Top provincias revenue paid
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)'),
               SUM(o.total)::float, COUNT(*)::int
        FROM tienda_nube."Order" o
        JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."paymentStatus"='paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """, p) or []
    top_provinces = [{
        "category": r[0], "value": float(r[1] or 0),
        "extra": {"orders": int(r[2] or 0)},
    } for r in rows]

    return {
        "period": period,
        "cards": cards,
        "trends": trends,
        "top_customers": top_customers,
        "customer_types": customer_types,
        "cohort": cohort,
        "top_provinces": top_provinces,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def marketing_unidrop(period: str = "30d") -> dict:
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unidrop")
    p = {"days": days}

    cards: list[dict] = []

    pixel_events = int(scalar(eng, """
        SELECT COUNT(*) FROM public."PixelMetaInfo"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    pixel_events_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM public."PixelMetaInfo"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0)
    delta_pix = ((pixel_events - pixel_events_prev) / pixel_events_prev * 100) if pixel_events_prev > 0 else None

    pixel_users = int(scalar(eng, """
        SELECT COUNT(DISTINCT "userId") FROM public."PixelMetaInfo"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    total_users = int(scalar(eng, 'SELECT COUNT(*) FROM public."User"') or 0)
    pixel_coverage = (pixel_users / total_users * 100) if total_users > 0 else 0

    new_signups = int(scalar(eng, """
        SELECT COUNT(*) FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    new_signups_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :days2)
          AND "createdAt" <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0)
    delta_su = ((new_signups - new_signups_prev) / new_signups_prev * 100) if new_signups_prev > 0 else None

    referidos = int(scalar(eng, """
        SELECT COUNT(*) FROM public."User"
        WHERE "referrerId" IS NOT NULL
          AND "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    cards.append({"label": f"Eventos pixel ({period})", "value": pixel_events,
                  "delta": round(delta_pix, 1) if delta_pix is not None else None})
    cards.append({"label": "Usuarios con pixel", "value": pixel_users,
                  "hint": f"{pixel_coverage:.1f}% cobertura"})
    cards.append({"label": f"Nuevos signups ({period})", "value": new_signups,
                  "delta": round(delta_su, 1) if delta_su is not None else None})
    cards.append({"label": "Signups via referral", "value": referidos,
                  "hint": "User.referrerId not null"})

    rows = q(eng, """
        SELECT date_trunc('day', "createdAt")::date, COUNT(*)::int
        FROM public."PixelMetaInfo"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 1
    """, p) or []
    daily_pixel = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                    "value": float(r[1] or 0)} for r in rows]

    rows = q(eng, """
        SELECT date_trunc('day', "createdAt")::date, COUNT(*)::int
        FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 1
    """, p) or []
    daily_signups = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                      "value": float(r[1] or 0)} for r in rows]

    return {
        "period": period,
        "cards": cards,
        "daily_pixel": daily_pixel,
        "daily_signups": daily_signups,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
