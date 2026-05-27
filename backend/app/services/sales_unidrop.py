"""
Ventas Unidrop: orders TN procesadas + ML procesadas a traves de la plataforma.
Espejo del dashboard sales de Unistore.

Las queries respetan la ventana exacta `from_ts/to_ts` provista por resolve_window,
para que HOY/AYER/Personalizado se calculen sobre el rango real (no sobre
NOW() - N dias rolling, que era el bug previo).
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window


def sales_unidrop(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unidrop")

    window = resolve_window(period, from_iso, to_iso)
    from_ts = window["from_ts"]
    to_ts = window["to_ts"]
    span = to_ts - from_ts
    prev_from_ts = from_ts - span
    prev_to_ts = from_ts

    p = {"from_ts": from_ts, "to_ts": to_ts}
    prev_p = {"prev_from": prev_from_ts, "prev_to": prev_to_ts}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    period_label = {
        "today": "hoy", "yesterday": "ayer", "7d": "7d",
        "30d": "30d", "90d": "90d", "12m": "12m",
        "custom": "rango",
    }.get(period, period)

    cards: list[dict] = []

    # GMV TN paid
    gmv_tn = float(scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= :from_ts AND created_at < :to_ts
    """, p) or 0) if include_tn else 0.0
    gmv_ml = float(scalar(eng, """
        SELECT COALESCE(SUM(COALESCE("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= :from_ts AND "dateCreated" < :to_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    gmv = gmv_tn + gmv_ml

    gmv_prev_tn = float(scalar(eng, """
        SELECT COALESCE(SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= :prev_from AND created_at < :prev_to
    """, prev_p) or 0) if include_tn else 0.0
    gmv_prev_ml = float(scalar(eng, """
        SELECT COALESCE(SUM(COALESCE("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= :prev_from AND "dateCreated" < :prev_to
          AND status IN ('paid','confirmed','shipped','delivered')
    """, prev_p) or 0) if include_ml else 0.0
    gmv_prev = gmv_prev_tn + gmv_prev_ml
    delta_gmv = ((gmv - gmv_prev) / gmv_prev * 100) if gmv_prev > 0 else None

    cards.append({
        "label": f"GMV ultimos {period_label}",
        "value": round(gmv, 0),
        "prefix": "$ ",
        "delta": round(delta_gmv, 1) if delta_gmv is not None else None,
        "hint": f"TN: {gmv_tn:,.0f} / ML: {gmv_ml:,.0f}",
    })

    # Ordenes
    orders_tn = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= :from_ts AND created_at < :to_ts
    """, p) or 0) if include_tn else 0
    orders_ml = int(scalar(eng, """
        SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= :from_ts AND "dateCreated" < :to_ts
    """, p) or 0) if include_ml else 0
    orders_tn_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= :prev_from AND created_at < :prev_to
    """, prev_p) or 0) if include_tn else 0
    orders_ml_prev = int(scalar(eng, """
        SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= :prev_from AND "dateCreated" < :prev_to
    """, prev_p) or 0) if include_ml else 0
    orders_total = orders_tn + orders_ml
    orders_prev = orders_tn_prev + orders_ml_prev
    delta_orders = ((orders_total - orders_prev) / orders_prev * 100) if orders_prev > 0 else None
    cards.append({
        "label": "Ordenes",
        "value": orders_total,
        "delta": round(delta_orders, 1) if delta_orders is not None else None,
        "hint": f"TN: {orders_tn:,} / ML: {orders_ml:,}",
    })

    # AOV
    aov_tn = float(scalar(eng, """
        SELECT COALESCE(AVG(NULLIF(total,0)),0)::float
        FROM public.tienda_nube_orders
        WHERE created_at >= :from_ts AND created_at < :to_ts
          AND payment_status::text='paid'
    """, p) or 0) if include_tn else 0.0
    aov_ml = float(scalar(eng, """
        SELECT COALESCE(AVG(NULLIF("totalAmount",0)),0)::float
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE "dateCreated" >= :from_ts AND "dateCreated" < :to_ts
          AND status IN ('paid','confirmed','shipped','delivered')
    """, p) or 0) if include_ml else 0.0
    if channel == "tn":
        aov = aov_tn
    elif channel == "ml":
        aov = aov_ml
    else:
        aov = (aov_tn + aov_ml) / 2 if (aov_tn > 0 and aov_ml > 0) else (aov_tn or aov_ml)
    cards.append({
        "label": "Ticket promedio",
        "value": round(aov, 0),
        "prefix": "$ ",
        "hint": "Sobre orders pagas",
    })

    # % Pago confirmado TN
    paid_tn = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= :from_ts AND created_at < :to_ts
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

    # Pagos Talo (suscripciones + ordenes procesadas por Talo)
    talo_vol = float(scalar(eng, """
        SELECT COALESCE(SUM(pt.amount),0)::float
        FROM public."PaymentTransaction" pt
        WHERE pt."createdAt" >= :from_ts AND pt."createdAt" < :to_ts
          AND pt.status::text IN ('completed','succeeded','approved','paid','credited','processed','PROCESSED')
    """, p) or 0)
    talo_prev = float(scalar(eng, """
        SELECT COALESCE(SUM(pt.amount),0)::float
        FROM public."PaymentTransaction" pt
        WHERE pt."createdAt" >= :prev_from AND pt."createdAt" < :prev_to
          AND pt.status::text IN ('completed','succeeded','approved','paid','credited','processed','PROCESSED')
    """, prev_p) or 0)
    delta_talo = ((talo_vol - talo_prev) / talo_prev * 100) if talo_prev > 0 else None
    cards.append({
        "label": f"Pagos Talo ({period_label})",
        "value": round(talo_vol, 0),
        "prefix": "$ ",
        "delta": round(delta_talo, 1) if delta_talo is not None else None,
        "hint": "Volumen procesado · ordenes + suscripciones",
    })

    # Tendencia 12m por canal (fijo, NO depende del filtro del topbar)
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

    # Daily revenue del periodo
    parts: list[str] = []
    if include_tn:
        parts.append("""
            SELECT date_trunc('day', created_at) AS day,
                   CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM public.tienda_nube_orders
            WHERE created_at >= :from_ts AND created_at < :to_ts
        """)
    if include_ml:
        parts.append("""
            SELECT date_trunc('day', "dateCreated") AS day,
                   COALESCE("totalAmount",0) AS rev
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE "dateCreated" >= :from_ts AND "dateCreated" < :to_ts
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
            WHERE created_at >= :from_ts AND created_at < :to_ts
            GROUP BY 1 ORDER BY 2 DESC
        """, p) or []
        payment_status = [{"category": r[0], "value": float(r[1])} for r in rows]

    # Top usuarios: combina TN + ML para ranking unificado por revenue
    top_users = []
    union_parts: list[str] = []
    if include_tn:
        union_parts.append("""
            SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
                   COUNT(*)::int AS cnt,
                   COALESCE(SUM(o.total),0)::float AS rev
            FROM public."User" u
            JOIN public.tienda_nube_orders o ON o.user_id = u.id
            WHERE o.created_at >= :from_ts AND o.created_at < :to_ts
              AND o.payment_status::text = 'paid'
            GROUP BY u.id, u.fantasy_name, u.name, u.email
        """)
    if include_ml:
        union_parts.append("""
            SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
                   COUNT(*)::int AS cnt,
                   COALESCE(SUM(oml."totalAmount"),0)::float AS rev
            FROM public."User" u
            JOIN mercado_libre_dev."OrderMercadoLibre" oml ON oml."userId" = u.id
            WHERE oml."dateCreated" >= :from_ts AND oml."dateCreated" < :to_ts
              AND oml.status IN ('paid','confirmed','shipped','delivered')
            GROUP BY u.id, u.fantasy_name, u.name, u.email
        """)
    if union_parts:
        union_sql = " UNION ALL ".join(union_parts)
        rows = q(eng, f"""
            SELECT id, nombre, SUM(cnt)::int AS orders, SUM(rev)::float AS revenue
            FROM ({union_sql}) x
            GROUP BY id, nombre
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
            WHERE created_at >= :from_ts AND created_at < :to_ts
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
