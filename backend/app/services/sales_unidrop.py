"""
Ventas Unidrop: orders TN procesadas + ML procesadas a traves de la plataforma.
Espejo del dashboard sales de Unistore.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def sales_unidrop(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    cards: list[dict] = []

    # GMV TN paid
    gmv_tn = float(scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0.0
    gmv_ml = float(scalar(eng, """
        SELECT COALESCE(SUM(COALESCE("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    gmv = gmv_tn + gmv_ml

    gmv_prev_tn = float(scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days2)
          AND created_at <  NOW() - make_interval(days => :days)
    """, p2) or 0) if include_tn else 0.0
    gmv_prev_ml = float(scalar(eng, """
        SELECT COALESCE(SUM(COALESCE("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= NOW() - make_interval(days => :days2)
          AND "dateCreated" <  NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p2) or 0) if include_ml else 0.0
    gmv_prev = gmv_prev_tn + gmv_prev_ml
    delta_gmv = ((gmv - gmv_prev) / gmv_prev * 100) if gmv_prev > 0 else None

    cards.append({
        "label": f"GMV ultimos {period}",
        "value": round(gmv, 0),
        "prefix": "$ ",
        "delta": round(delta_gmv, 1) if delta_gmv is not None else None,
        "hint": f"TN: {gmv_tn:,.0f} / ML: {gmv_ml:,.0f}",
    })

    # Ordenes
    orders_tn = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0
    orders_ml = int(scalar(eng, """
        SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_ml else 0
    cards.append({
        "label": "Ordenes",
        "value": orders_tn + orders_ml,
        "hint": f"TN: {orders_tn:,} / ML: {orders_ml:,}",
    })

    # AOV
    aov_tn = float(scalar(eng, """
        SELECT COALESCE(AVG(NULLIF(total,0)),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND payment_status::text='paid'
    """, p) or 0) if include_tn else 0.0
    aov_ml = float(scalar(eng, """
        SELECT COALESCE(AVG(NULLIF("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= NOW() - make_interval(days => :days)
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    if channel == "tn": aov = aov_tn
    elif channel == "ml": aov = aov_ml
    else: aov = (aov_tn + aov_ml) / 2 if (aov_tn > 0 and aov_ml > 0) else (aov_tn or aov_ml)
    cards.append({
        "label": "Ticket promedio",
        "value": round(aov, 0),
        "prefix": "$ ",
        "hint": "Sobre orders pagas",
    })

    # % Pago confirmado TN
    paid_tn = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND payment_status::text='paid'
    """, p) or 0)
    paid_rate = (paid_tn / orders_tn * 100) if orders_tn > 0 else 0
    cards.append({
        "label": "% Pago confirmado (TN)",
        "value": round(paid_rate, 1),
        "suffix": "%",
        "hint": f"{paid_tn:,} de {orders_tn:,}",
    })

    # Canal lider
    if channel == "all":
        top_chan = "Tienda Nube" if gmv_tn >= gmv_ml else "Mercado Libre"
        share = (max(gmv_tn, gmv_ml) / gmv * 100) if gmv > 0 else 0
        cards.append({
            "label": "Canal lider",
            "value": top_chan,
            "hint": f"{share:.1f}% del GMV del periodo",
        })

    # Tendencia 12m por canal
    series: list[dict] = []
    if include_tn:
        rows = q(eng, """
            SELECT date_trunc('month', created_at)::date AS mes,
                   SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END)::float
            FROM public.tienda_nube_orders
            WHERE created_at >= date_trunc('month', NOW() - INTERVAL '11 months')
            GROUP BY 1 ORDER BY 1
        """) or []
        series.append({
            "label": "Tienda Nube",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
        })
    if include_ml:
        rows = q(eng, """
            SELECT date_trunc('month', "dateCreated")::date AS mes,
                   SUM(COALESCE("totalAmount",0))::float
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE "dateCreated" >= date_trunc('month', NOW() - INTERVAL '11 months')
              AND status IN ('paid','confirmed','shipped','delivered')
            GROUP BY 1 ORDER BY 1
        """) or []
        series.append({
            "label": "Mercado Libre",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
        })

    # Daily revenue periodo
    parts: list[str] = []
    if include_tn:
        parts.append("""
            SELECT date_trunc('day', created_at) AS day,
                   CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM public.tienda_nube_orders
            WHERE created_at >= NOW() - make_interval(days => :days)
        """)
    if include_ml:
        parts.append("""
            SELECT date_trunc('day', "dateCreated") AS day,
                   COALESCE("totalAmount",0) AS rev
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE "dateCreated" >= NOW() - make_interval(days => :days)
              AND status IN ('paid','confirmed','shipped','delivered')
        """)
    daily = []
    if parts:
        body = " UNION ALL ".join(parts)
        rows = q(eng, f"""
            SELECT day::date, COALESCE(SUM(rev),0)::float
            FROM ({body}) x GROUP BY 1 ORDER BY 1
        """, p) or []
        daily = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "", "value": float(r[1] or 0)} for r in rows]

    # Distribucion paymentStatus TN
    payment_status: list[dict] = []
    if include_tn:
        rows = q(eng, """
            SELECT COALESCE(payment_status::text,'desconocido'), COUNT(*)::int
            FROM public.tienda_nube_orders
            WHERE created_at >= NOW() - make_interval(days => :days)
            GROUP BY 1 ORDER BY 2 DESC
        """, p) or []
        payment_status = [{"category": r[0], "value": float(r[1])} for r in rows]

    # Top usuarios (no productos - en Unidrop la "venta" es del cliente, no de TU producto)
    top_users = []
    if include_tn:
        rows = q(eng, """
            SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
                   COUNT(*)::int AS orders,
                   COALESCE(SUM(o.total),0)::float AS revenue
            FROM public."User" u
            JOIN public.tienda_nube_orders o ON o.user_id = u.id
            WHERE o.created_at >= NOW() - make_interval(days => :days)
              AND o.payment_status::text = 'paid'
            GROUP BY u.id, u.fantasy_name, u.name, u.email
            ORDER BY revenue DESC
            LIMIT 15
        """, p) or []
        top_users = [{
            "category": r[1] or f"User {r[0]}",
            "value": float(r[3] or 0),
            "extra": {"orders": int(r[2] or 0), "user_id": int(r[0] or 0)},
        } for r in rows]

    # Top provincias
    top_provinces = []
    if include_tn:
        rows = q(eng, """
            SELECT COALESCE(NULLIF(TRIM(billing_province),''),'(sin provincia)'),
                   SUM(total)::float, COUNT(*)::int
            FROM public.tienda_nube_orders
            WHERE created_at >= NOW() - make_interval(days => :days)
              AND payment_status::text='paid'
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        """, p) or []
        top_provinces = [{
            "category": r[0],
            "value": float(r[1] or 0),
            "extra": {"orders": int(r[2] or 0)},
        } for r in rows]

    return {
        "unit": "unidrop",
        "period": period,
        "channel": channel,
        "cards": cards,
        "revenue_by_channel": series,
        "payment_status": payment_status,
        "top_users": top_users,
        "top_provinces": top_provinces,
        "daily_revenue": daily,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
