"""
Customer Success - dashboards.
Unistore (TN+ML): cancelaciones, motivos, refunds, repeat, customers en riesgo.
Unidrop (TN+ML): igual + intervenciones del staff (cancel_by_unidrop, manual_packed).
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


# ============================ UNISTORE ============================

def cs_unistore(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unistore")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    cards: list[dict] = []

    # --- Tasa de cancelacion ---
    cancel_tn = int(scalar(eng, """
    SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days)
    AND status = 'cancelled'
    """, p) or 0) if include_tn else 0
    total_tn = int(scalar(eng, """
    SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0
    cancel_ml = int(scalar(eng, """
    SELECT COUNT(*) FROM meli.meli_orders
    WHERE date_created >= NOW() - make_interval(days => :days)
    AND status = 'cancelled'
    """, p) or 0) if include_ml else 0
    total_ml = int(scalar(eng, """
    SELECT COUNT(*) FROM meli.meli_orders
    WHERE date_created >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_ml else 0

    total = total_tn + total_ml
    cancelled = cancel_tn + cancel_ml
    cancel_rate = (cancelled / total * 100) if total > 0 else 0

    # vs prev
    cancel_prev = int(scalar(eng, """
    SELECT (
    (SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days2)
    AND "createdAt" < NOW() - make_interval(days => :days)
    AND status = 'cancelled') +
    (SELECT COUNT(*) FROM meli.meli_orders
    WHERE date_created >= NOW() - make_interval(days => :days2)
    AND date_created < NOW() - make_interval(days => :days)
    AND status = 'cancelled')
    )
    """, p2) or 0)
    total_prev = int(scalar(eng, """
    SELECT (
    (SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days2)
    AND "createdAt" < NOW() - make_interval(days => :days)) +
    (SELECT COUNT(*) FROM meli.meli_orders
    WHERE date_created >= NOW() - make_interval(days => :days2)
    AND date_created < NOW() - make_interval(days => :days))
    )
    """, p2) or 0)
    cancel_rate_prev = (cancel_prev / total_prev * 100) if total_prev > 0 else 0
    delta_rate = (cancel_rate - cancel_rate_prev) if cancel_rate_prev > 0 else None

    cards.append({
    "label": f"Tasa de cancelacion ({period})",
    "value": round(cancel_rate, 1),
    "suffix": "%",
    "delta": round(delta_rate, 1) if delta_rate is not None else None,
    "hint": f"{cancelled:,} de {total:,} ordenes",
    })

    # --- Refunds + chargebacks TN ---
    refunds_tn = int(scalar(eng, """
    SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days)
    AND "paymentStatus" IN ('refunded','partially_refunded','chargeback')
    """, p) or 0)
    refunds_amount = float(scalar(eng, """
    SELECT COALESCE(SUM(total),0)::float FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days)
    AND "paymentStatus" IN ('refunded','partially_refunded','chargeback')
    """, p) or 0)
    cards.append({
    "label": "Refunds + chargebacks",
    "value": refunds_tn,
    "hint": f"$ {refunds_amount:,.0f} en monto",
    })

    # --- Repeat purchase rate ---
    repeat = int(scalar(eng, """
    SELECT COUNT(*) FROM (
    SELECT "customerId" FROM tienda_nube."Order"
    WHERE "paymentStatus" = 'paid'
    AND "customerId" IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
    ) x
    """) or 0)
    paying_customers = int(scalar(eng, """
    SELECT COUNT(DISTINCT "customerId") FROM tienda_nube."Order"
    WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
    """) or 0)
    repeat_rate = (repeat / paying_customers * 100) if paying_customers > 0 else 0
    cards.append({
    "label": "Repeat purchase rate",
    "value": round(repeat_rate, 1),
    "suffix": "%",
    "hint": f"{repeat:,} de {paying_customers:,} compradores",
    })

    # --- Customers en riesgo (compraron antes pero hace > 90d sin comprar) ---
    at_risk = int(scalar(eng, """
    WITH last_order AS (
    SELECT "customerId" AS cid, MAX("createdAt") AS last_at, COUNT(*) AS orders
    FROM tienda_nube."Order"
    WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
    GROUP BY 1
    )
    SELECT COUNT(*) FROM last_order
    WHERE orders >= 2 AND last_at < NOW() - INTERVAL '90 days'
    """) or 0)
    cards.append({
    "label": "Customers en riesgo",
    "value": at_risk,
    "hint": "Compraron 2+ veces pero hace >90d sin volver",
    })

    # --- Cancelaciones automaticas (proxy de intervencion sistemica) ---
    auto_cancel = int(scalar(eng, """
    SELECT COUNT(*) FROM tienda_nube."Order"
    WHERE "createdAt" >= NOW() - make_interval(days => :days)
    AND status = 'cancelled'
    AND "cancelReason" IN ('automatic','expired','inventory')
    """, p) or 0)
    cards.append({
    "label": "Cancelaciones por sistema",
    "value": auto_cancel,
    "hint": "automatic / expired / inventory",
    })

    # --- Tasa de cancelacion mensual 12m (TN) ---
    rows = q(eng, """
    SELECT date_trunc('month', "createdAt")::date AS mes,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status='cancelled') AS cancelled
    FROM tienda_nube."Order"
    WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
    GROUP BY 1 ORDER BY 1
    """) or []
    cancel_trend = [{
    "date": r[0].strftime("%Y-%m") if r[0] else "",
    "value": float(r[2] / r[1] * 100) if r[1] else 0,
    } for r in rows]
    volume_trend = [{
    "date": r[0].strftime("%Y-%m") if r[0] else "",
    "value": float(r[1]),
    } for r in rows]

    # --- Distribucion motivos cancelacion (TN) ---
    rows = q(eng, """
    SELECT COALESCE("cancelReason",'(sin razon)'), COUNT(*)::int
    FROM tienda_nube."Order"
    WHERE status='cancelled'
    AND "createdAt" >= NOW() - make_interval(days => :days)
    GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    cancel_reasons = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # --- Top provincias con mas cancelaciones ---
    rows = q(eng, """
    SELECT COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)'),
    COUNT(*)::int,
    COALESCE(SUM(o.total),0)::float
    FROM tienda_nube."Order" o
    JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
    WHERE o.status='cancelled'
    AND o."createdAt" >= NOW() - make_interval(days => :days)
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """, p) or []
    cancel_by_province = [{
    "category": r[0], "value": float(r[1] or 0),
    "extra": {"monto_perdido": float(r[2] or 0)},
    } for r in rows]

    # --- Cancelaciones recientes detalle ---
    rows = q(eng, """
    SELECT o.id, o.number, o."createdAt"::text,
    COALESCE(o."cancelReason",'?') AS razon,
    o."paymentStatus",
    o.total::float,
    COALESCE(NULLIF(TRIM(osa.province),''),'-') AS provincia
    FROM tienda_nube."Order" o
    LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
    WHERE o.status='cancelled'
    ORDER BY o."createdAt" DESC
    LIMIT 20
    """) or []
    recent_cancellations = [{
    "category": str(r[1] or r[0]),
    "value": float(r[5] or 0),
    "extra": {
    "id": int(r[0]),
    "fecha": r[2][:10] if r[2] else None,
    "razon": r[3] or "?",
    "payment": r[4] or "",
    "provincia": r[6] or "-",
    },
    } for r in rows]

    # --- Cohort: nuevos compradores por mes vs % retencion 30/60/90d ---
    cohort_rows = q(eng, """
    WITH first_order AS (
    SELECT "customerId" AS cid, MIN("createdAt") AS first_at
    FROM tienda_nube."Order"
    WHERE "paymentStatus"='paid' AND "customerId" IS NOT NULL
    GROUP BY 1
    )
    SELECT date_trunc('month', fo.first_at)::date AS cohort_month,
    COUNT(DISTINCT fo.cid) AS new_buyers,
    COUNT(DISTINCT CASE WHEN o."createdAt" BETWEEN fo.first_at + INTERVAL '1 day' AND fo.first_at + INTERVAL '30 days' THEN fo.cid END) AS d30,
    COUNT(DISTINCT CASE WHEN o."createdAt" BETWEEN fo.first_at + INTERVAL '1 day' AND fo.first_at + INTERVAL '60 days' THEN fo.cid END) AS d60,
    COUNT(DISTINCT CASE WHEN o."createdAt" BETWEEN fo.first_at + INTERVAL '1 day' AND fo.first_at + INTERVAL '90 days' THEN fo.cid END) AS d90
    FROM first_order fo
    LEFT JOIN tienda_nube."Order" o ON o."customerId" = fo.cid AND o."paymentStatus"='paid'
    WHERE fo.first_at >= date_trunc('month', NOW() - INTERVAL '6 months')
    GROUP BY 1 ORDER BY 1
    """) or []
    cohort = [{
    "category": r[0].strftime("%Y-%m") if r[0] else "?",
    "value": float(r[1] or 0),
    "extra": {
    "d30_pct": (r[2] / r[1] * 100) if r[1] else 0,
    "d60_pct": (r[3] / r[1] * 100) if r[1] else 0,
    "d90_pct": (r[4] / r[1] * 100) if r[1] else 0,
    },
    } for r in cohort_rows]

    # ---------- Estados de cliente con CHURN-OVERRIDE (cadencia personal) ----------
    # Lifecycle ampliado:
    #   Nuevo / 2da compra / Conv. a Recurrente / Recurrente   (en ritmo personal)
    #   En riesgo            (recency 1.2x-2x cadencia personal)
    #   Churn pendiente      (2x-3x)
    #   Churn confirmado     (>3x)
    #   Recuperado           (tuvo gap historico >180d y volvio reciente)
    # Cadencia personal = promedio ponderado: 0.6*ult + 0.3*ant + 0.1*pre-ant.
    customer_states = q(eng, """
    WITH base AS (
        SELECT "customerId" AS cid, "createdAt"::date AS d, total::float AS amount
        FROM tienda_nube."Order"
        WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
    ),
    gaps AS (
        SELECT cid, (d - prev_d) AS gap_days,
               ROW_NUMBER() OVER (PARTITION BY cid ORDER BY d DESC) AS rev_rn
        FROM (
            SELECT cid, d,
                   LAG(d) OVER (PARTITION BY cid ORDER BY d) AS prev_d
            FROM base
        ) x WHERE prev_d IS NOT NULL
    ),
    cadence AS (
        SELECT cid,
               COUNT(*) AS gap_count,
               MAX(CASE WHEN rev_rn = 1 THEN gap_days END) AS g_last,
               MAX(CASE WHEN rev_rn = 2 THEN gap_days END) AS g_prev,
               MAX(CASE WHEN rev_rn = 3 THEN gap_days END) AS g_prev2,
               MAX(gap_days) AS max_gap_days
        FROM gaps GROUP BY cid
    ),
    cadence_calc AS (
        SELECT cid, gap_count, max_gap_days,
               CASE
                 WHEN gap_count >= 3 THEN (0.6 * g_last + 0.3 * g_prev + 0.1 * g_prev2)::numeric
                 WHEN gap_count = 2 THEN (0.7 * g_last + 0.3 * g_prev)::numeric
                 WHEN gap_count = 1 THEN g_last::numeric
                 ELSE NULL
               END AS expected_gap
        FROM cadence
    ),
    stats AS (
        SELECT cid, COUNT(*) AS orders,
               SUM(amount) AS total_spent,
               (CURRENT_DATE - MAX(d))::int AS recency_days
        FROM base GROUP BY cid
    ),
    classified AS (
        SELECT s.cid, s.orders, s.total_spent, s.recency_days,
               c.expected_gap, COALESCE(c.max_gap_days, 0) AS max_gap_days,
               CASE
                 -- 1 sola compra: cadencia desconocida, marcamos Nuevo si reciente
                 WHEN s.orders = 1 AND s.recency_days <= 60 THEN 'Nuevo'
                 WHEN s.orders = 1 AND s.recency_days > 90 THEN 'Churn pendiente'
                 WHEN s.orders = 1 THEN 'Nuevo'
                 -- Recuperado: tuvo gap historico > 180d y volvio reciente
                 WHEN COALESCE(c.max_gap_days,0) > 180 AND s.recency_days <= 60 THEN 'Recuperado'
                 -- Churn-aware classification (con cadencia personal)
                 WHEN c.expected_gap IS NOT NULL AND c.expected_gap > 0 THEN
                   CASE
                     WHEN s.recency_days::numeric / c.expected_gap > 3.0 THEN 'Churn confirmado'
                     WHEN s.recency_days::numeric / c.expected_gap > 2.0 THEN 'Churn pendiente'
                     WHEN s.recency_days::numeric / c.expected_gap > 1.2 THEN 'En riesgo'
                     WHEN s.orders = 2 THEN '2da compra'
                     WHEN s.orders = 3 THEN 'Convertido a Recurrente'
                     WHEN s.orders >= 4 THEN 'Recurrente'
                   END
                 ELSE 'Otros'
               END AS estado
        FROM stats s LEFT JOIN cadence_calc c ON c.cid = s.cid
    )
    SELECT estado, COUNT(*)::int AS clientes,
           COALESCE(AVG(total_spent),0)::float AS ticket_promedio,
           COALESCE(SUM(total_spent),0)::float AS revenue_total
    FROM classified
    GROUP BY estado
    ORDER BY clientes DESC
    """) or []
    customer_status_dist = [{
    "category": r[0],
    "value": float(r[1] or 0),
    "extra": {
    "ticket_promedio": float(r[2] or 0),
    "revenue_total": float(r[3] or 0),
    },
    } for r in customer_states]

    # ---------- RFM scoring (top customers) ----------
    # Score 5 = mejor:
    # R: recency_days DESC -> mas viejos al principio, mas recientes al final (NTILE 5).
    # F: frequency ASC -> menos frecuentes al principio, mas frecuentes al final.
    # M: monetary ASC -> menos gastado al principio, mas gastado al final.
    rfm_rows = q(eng, """
    WITH base AS (
    SELECT "customerId" AS cid,
    COUNT(*) AS frequency,
    EXTRACT(DAY FROM (NOW() - MAX("createdAt")))::int AS recency_days,
    SUM(total)::float AS monetary
    FROM tienda_nube."Order"
    WHERE "paymentStatus"='paid' AND "customerId" IS NOT NULL
    GROUP BY 1
    ),
    scored AS (
    SELECT b.*,
    NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
    NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
    NTILE(5) OVER (ORDER BY monetary ASC) AS m_score
    FROM base b
    )
    SELECT s.cid, COALESCE(c.name, c.email, 'Customer ' || s.cid::text) AS nombre,
    s.frequency, s.recency_days, s.monetary,
    s.r_score, s.f_score, s.m_score,
    (s.r_score::text || s.f_score::text || s.m_score::text) AS rfm_code
    FROM scored s
    LEFT JOIN tienda_nube."Customer" c ON c.id = s.cid
    WHERE s.r_score >= 4 AND s.f_score >= 4 AND s.m_score >= 4
    ORDER BY s.monetary DESC
    LIMIT 20
    """) or []
    rfm_top = [{
    "category": r[1] or f"Customer {r[0]}",
    "value": float(r[4] or 0),
    "extra": {
    "frequency": int(r[2] or 0),
    "recency_days": int(r[3] or 0),
    "rfm_code": r[8] or "?",
    "customer_id": int(r[0] or 0),
    },
    } for r in rfm_rows]

    # Distribucion de RFM scores (usar misma logica que arriba)
    rfm_dist_rows = q(eng, """
    WITH base AS (
    SELECT "customerId" AS cid,
    COUNT(*) AS frequency,
    EXTRACT(DAY FROM (NOW() - MAX("createdAt")))::int AS recency_days,
    SUM(total)::float AS monetary
    FROM tienda_nube."Order"
    WHERE "paymentStatus"='paid' AND "customerId" IS NOT NULL
    GROUP BY 1
    ),
    scored AS (
    SELECT b.*,
    NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
    NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
    NTILE(5) OVER (ORDER BY monetary ASC) AS m_score
    FROM base b
    )
    SELECT
    CASE
    WHEN r_score>=4 AND f_score>=4 AND m_score>=4 THEN 'Champions'
    WHEN r_score>=3 AND f_score>=3 AND m_score>=3 THEN 'Fieles'
    WHEN r_score>=4 AND f_score<=2 THEN 'Nuevos potenciales'
    WHEN r_score<=2 AND f_score>=4 THEN 'En riesgo'
    WHEN r_score<=1 AND f_score<=2 THEN 'Perdidos'
    ELSE 'Standard'
    END AS segmento,
    COUNT(*)::int AS clientes,
    COALESCE(SUM(monetary),0)::float AS revenue
    FROM scored
    GROUP BY 1 ORDER BY 2 DESC
    """) or []
    rfm_segments = [{
    "category": r[0],
    "value": float(r[1] or 0),
    "extra": {"revenue": float(r[2] or 0)},
    } for r in rfm_dist_rows]

    return {
    "unit": "unistore",
    "period": period,
    "channel": channel,
    "cards": cards,
    "cancel_trend": cancel_trend,
    "volume_trend": volume_trend,
    "cancel_reasons": cancel_reasons,
    "cancel_by_province": cancel_by_province,
    "recent_cancellations": recent_cancellations,
    "cohort_retention": cohort,
    "customer_status_dist": customer_status_dist,
    "rfm_segments": rfm_segments,
    "rfm_top": rfm_top,
    "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ============================ UNIDROP ============================

def cs_unidrop(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    include_tn = channel in ("all", "tn")
    include_ml = channel in ("all", "ml")

    cards: list[dict] = []

    # --- Tasa de cancelacion ---
    cancel_tn = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    AND status::text = 'cancelled'
    """, p) or 0) if include_tn else 0
    total_tn = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_tn else 0
    cancel_ml = int(scalar(eng, """
    SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
    WHERE "dateCreated" >= NOW() - make_interval(days => :days)
    AND status = 'cancelled'
    """, p) or 0) if include_ml else 0
    total_ml = int(scalar(eng, """
    SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
    WHERE "dateCreated" >= NOW() - make_interval(days => :days)
    """, p) or 0) if include_ml else 0
    total = total_tn + total_ml
    cancelled = cancel_tn + cancel_ml
    cancel_rate = (cancelled / total * 100) if total > 0 else 0
    cards.append({
    "label": f"Tasa de cancelacion ({period})",
    "value": round(cancel_rate, 1),
    "suffix": "%",
    "hint": f"{cancelled:,} de {total:,} ordenes",
    })

    # --- Refunds (TN + ML) ---
    refunds = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    AND payment_status::text IN ('refunded','partially_refunded')
    """, p) or 0)
    refunds_amount = float(scalar(eng, """
    SELECT COALESCE(SUM(total),0)::float FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    AND payment_status::text IN ('refunded','partially_refunded')
    """, p) or 0)
    cards.append({
    "label": "Refunds + partial",
    "value": refunds,
    "hint": f"$ {refunds_amount:,.0f}",
    })

    # --- Intervenciones del staff (cancel_by_unidrop) ---
    staff_cancels = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    AND cancel_by_unidrop = TRUE
    """, p) or 0)
    cards.append({
    "label": "Cancelaciones por staff",
    "value": staff_cancels,
    "hint": "cancel_by_unidrop = true",
    })

    # --- Manual packed/payment marks ---
    manual_marks = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE manual_packed_marked_at >= NOW() - make_interval(days => :days)
    OR manual_payment_marked_at >= NOW() - make_interval(days => :days)
    """, p) or 0)
    cards.append({
    "label": "Marcas manuales del staff",
    "value": manual_marks,
    "hint": "Pago/empaque marcado manualmente",
    })

    # --- Cancelaciones por inventario (problema operativo grande) ---
    inv_cancels = int(scalar(eng, """
    SELECT COUNT(*) FROM public.tienda_nube_orders
    WHERE created_at >= NOW() - make_interval(days => :days)
    AND status::text = 'cancelled'
    AND cancel_reason::text = 'inventory'
    """, p) or 0)
    cards.append({
    "label": "Cancelaciones por inventario",
    "value": inv_cancels,
    "hint": "Falta de stock - alerta operativa",
    })

    # --- Customers usuarios totales / activos (proxy churn) ---
    inactive_users = int(scalar(eng, """
    SELECT COUNT(*) FROM public."User"
    WHERE end_date_subscription IS NOT NULL
    AND end_date_subscription < NOW()
    """) or 0)
    cards.append({
    "label": "Usuarios churneados",
    "value": inactive_users,
    "hint": "Suscripcion vencida sin renovar",
    })

    # --- Trends 12m ---
    rows = q(eng, """
    SELECT date_trunc('month', created_at)::date,
    COUNT(*),
    COUNT(*) FILTER (WHERE status::text='cancelled')
    FROM public.tienda_nube_orders
    WHERE created_at >= date_trunc('month', NOW() - INTERVAL '11 months')
    GROUP BY 1 ORDER BY 1
    """) or []
    cancel_trend = [{
    "date": r[0].strftime("%Y-%m") if r[0] else "",
    "value": float(r[2] / r[1] * 100) if r[1] else 0,
    } for r in rows]
    volume_trend = [{
    "date": r[0].strftime("%Y-%m") if r[0] else "",
    "value": float(r[1]),
    } for r in rows]

    # --- Cancel reasons + by_unidrop split ---
    rows = q(eng, """
    SELECT COALESCE(cancel_reason::text,'(sin razon)'),
    cancel_by_unidrop,
    COUNT(*)::int
    FROM public.tienda_nube_orders
    WHERE status::text='cancelled'
    AND created_at >= NOW() - make_interval(days => :days)
    GROUP BY 1, 2 ORDER BY 3 DESC
    """, p) or []
    cancel_reasons = [{
    "category": f"{r[0]}{' (staff)' if r[1] else ''}",
    "value": float(r[2] or 0),
    } for r in rows]

    # --- Top users con mas cancelaciones (clientes problematicos) ---
    rows = q(eng, """
    SELECT u.id, COALESCE(u.fantasy_name, u.name, u.email) AS nombre,
    COUNT(o.tienda_nube_id)::int AS cancelled,
    COALESCE(SUM(o.total),0)::float AS monto
    FROM public."User" u
    JOIN public.tienda_nube_orders o ON o.user_id = u.id
    WHERE o.status::text = 'cancelled'
    AND o.created_at >= NOW() - make_interval(days => :days)
    GROUP BY u.id, u.fantasy_name, u.name, u.email
    ORDER BY cancelled DESC
    LIMIT 15
    """, p) or []
    top_users_cancel = [{
    "category": r[1] or f"User {r[0]}",
    "value": float(r[2] or 0),
    "extra": {"monto": float(r[3] or 0), "user_id": int(r[0] or 0)},
    } for r in rows]

    # --- Recientes (enriquecido con nombre cliente, provincia, dias hace) ---
    rows = q(eng, """
    SELECT o.tienda_nube_id, o.order_number, o.created_at::text,
    COALESCE(o.cancel_reason::text,'(sin razon)') AS razon,
    o.cancel_by_unidrop, o.payment_status::text,
    o.total::float,
    COALESCE(NULLIF(TRIM(o.billing_name),''),'(sin nombre)') AS cliente,
    COALESCE(NULLIF(TRIM(o.billing_province),''),'-') AS provincia,
    EXTRACT(DAY FROM (NOW() - o.created_at))::int AS dias_hace
    FROM public.tienda_nube_orders o
    WHERE o.status::text='cancelled'
    ORDER BY o.created_at DESC
    LIMIT 20
    """) or []
    recent_cancellations = [{
    "category": r[7] or str(r[1] or r[0]),
    "value": float(r[6] or 0),
    "extra": {
    "id": int(r[0]),
    "orden": str(r[1] or r[0]),
    "fecha": r[2][:10] if r[2] else None,
    "dias_hace": int(r[9] or 0),
    "razon": r[3] or "?",
    "by_staff": "si" if r[4] else "no",
    "payment": r[5] or "",
    "provincia": r[8] or "-",
    },
    } for r in rows]

    # ============================================================
    # CS-360 KPIs (-style health metrics)
    # ============================================================

    # Customers totales (que compraron al menos una vez con paid)
    total_customers = int(scalar(eng, """
    SELECT COUNT(DISTINCT contact_identification)
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    AND contact_identification <> ''
    """) or 0)
    # Nuevos customers en el periodo (primera compra dentro de :days)
    new_customers = int(scalar(eng, """
    WITH first_order AS (
    SELECT contact_identification, MIN(created_at) AS first_at
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT COUNT(*) FROM first_order
    WHERE first_at >= NOW() - make_interval(days => :days)
    """, p) or 0)
    # Repeat purchase rate
    repeat_rate = float(scalar(eng, """
    WITH per_cust AS (
    SELECT contact_identification, COUNT(*) AS n
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT CASE WHEN COUNT(*) = 0 THEN 0
    ELSE 100.0 * COUNT(*) FILTER (WHERE n > 1) / COUNT(*)::float END
    FROM per_cust
    """) or 0)
    # AOV TN paid (en el periodo)
    aov = float(scalar(eng, """
    SELECT COALESCE(AVG(NULLIF(total,0)),0)
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND created_at >= NOW() - make_interval(days => :days)
    """, p) or 0)
    # LTV avg (revenue total / customer)
    ltv = float(scalar(eng, """
    WITH per_cust AS (
    SELECT contact_identification, SUM(total) AS rev
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT COALESCE(AVG(rev),0)::float FROM per_cust
    """) or 0)
    # Customers en riesgo (sin comprar hace >90d)
    at_risk = int(scalar(eng, """
    WITH last_order AS (
    SELECT contact_identification, MAX(created_at) AS last_at
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT COUNT(*) FROM last_order
    WHERE last_at < NOW() - INTERVAL '90 days'
    AND last_at >= NOW() - INTERVAL '180 days'
    """) or 0)

    cards.append({"label": "Customers totales", "value": total_customers, "hint": "Compraron al menos 1 vez con paid"})
    cards.append({"label": "Nuevos customers / periodo", "value": new_customers, "hint": "Primera compra en el periodo"})
    cards.append({"label": "% Repeat purchase", "value": round(repeat_rate, 1), "suffix": "%", "hint": "% con >1 compra"})
    cards.append({"label": "Ticket promedio (AOV)", "value": round(aov, 0), "prefix": "$ ", "hint": "TN paid en el periodo"})
    cards.append({"label": "LTV promedio", "value": round(ltv, 0), "prefix": "$ ", "hint": "Revenue total / customer"})
    cards.append({"label": "Customers en riesgo", "value": at_risk, "hint": "Sin comprar hace 90-180d"})

    # ----- Customer status mix con CHURN-OVERRIDE — DROPSHIPPERS Unidrop -----
    # Event = PaymentIntent PROCESSED. Cliente = dropshipper (public.User).
    # Cadencia personal por dropshipper (promedio ponderado), churn override.
    rows = q(eng, """
    WITH base AS (
        SELECT cpa."userId" AS cid, pi."createdAt"::date AS d,
               COALESCE(pi."paidAmount",0)::float AS amount
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE pi."status" = 'PROCESSED'
    ),
    gaps AS (
        SELECT cid, (d - prev_d) AS gap_days,
               ROW_NUMBER() OVER (PARTITION BY cid ORDER BY d DESC) AS rev_rn
        FROM (
            SELECT cid, d,
                   LAG(d) OVER (PARTITION BY cid ORDER BY d) AS prev_d
            FROM base
        ) x WHERE prev_d IS NOT NULL
    ),
    cadence AS (
        SELECT cid, COUNT(*) AS gap_count,
               MAX(CASE WHEN rev_rn = 1 THEN gap_days END) AS g_last,
               MAX(CASE WHEN rev_rn = 2 THEN gap_days END) AS g_prev,
               MAX(CASE WHEN rev_rn = 3 THEN gap_days END) AS g_prev2,
               MAX(gap_days) AS max_gap_days
        FROM gaps GROUP BY cid
    ),
    cadence_calc AS (
        SELECT cid, gap_count, max_gap_days,
               CASE
                 WHEN gap_count >= 3 THEN (0.6 * g_last + 0.3 * g_prev + 0.1 * g_prev2)::numeric
                 WHEN gap_count = 2 THEN (0.7 * g_last + 0.3 * g_prev)::numeric
                 WHEN gap_count = 1 THEN g_last::numeric
                 ELSE NULL
               END AS expected_gap
        FROM cadence
    ),
    stats AS (
        SELECT cid, COUNT(*) AS n,
               SUM(amount) AS rev,
               (CURRENT_DATE - MAX(d))::int AS recency_days
        FROM base GROUP BY cid
    ),
    classified AS (
        SELECT s.cid, s.n, s.rev, s.recency_days,
               c.expected_gap, COALESCE(c.max_gap_days, 0) AS max_gap_days,
               CASE
                 WHEN s.n = 1 AND s.recency_days <= 60 THEN 'Nuevo'
                 WHEN s.n = 1 AND s.recency_days > 90 THEN 'Churn pendiente'
                 WHEN s.n = 1 THEN 'Nuevo'
                 WHEN COALESCE(c.max_gap_days,0) > 180 AND s.recency_days <= 60 THEN 'Recuperado'
                 WHEN c.expected_gap IS NOT NULL AND c.expected_gap > 0 THEN
                   CASE
                     WHEN s.recency_days::numeric / c.expected_gap > 3.0 THEN 'Churn confirmado'
                     WHEN s.recency_days::numeric / c.expected_gap > 2.0 THEN 'Churn pendiente'
                     WHEN s.recency_days::numeric / c.expected_gap > 1.2 THEN 'En riesgo'
                     WHEN s.n = 2 THEN '2da compra'
                     WHEN s.n = 3 THEN 'Convertido a Recurrente'
                     WHEN s.n >= 4 THEN 'Recurrente'
                   END
                 ELSE 'Otros'
               END AS estado
        FROM stats s LEFT JOIN cadence_calc c ON c.cid = s.cid
    )
    SELECT estado, COUNT(*)::int AS clientes,
           SUM(rev)::float AS revenue, AVG(rev)::float AS ticket_avg
    FROM classified
    GROUP BY 1 ORDER BY 2 DESC
    """) or []
    customer_status_dist = [{
    "category": r[0] or "?",
    "value": int(r[1] or 0),
    "extra": {
    "revenue_total": round(float(r[2] or 0), 0),
    "ticket_promedio": round(float(r[3] or 0), 0),
    },
    } for r in rows]

    # ----- Top customers by revenue (no por cancelaciones) -----
    rows = q(eng, """
    SELECT contact_identification,
    MAX(billing_name) AS nombre,
    COUNT(*)::int AS orders,
    SUM(total)::float AS revenue,
    MAX(created_at)::text AS ultima_compra,
    MAX(billing_province) AS provincia
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    ORDER BY revenue DESC LIMIT 15
    """) or []
    top_customers_revenue = [{
    "category": r[1] or r[0] or "?",
    "value": float(r[3] or 0),
    "extra": {
    "dni": r[0],
    "orders": int(r[2] or 0),
    "ultima_compra": r[4][:10] if r[4] else "",
    "provincia": r[5] or "-",
    },
    } for r in rows]

    # ----- New customers acquisition trend (12m) -----
    rows = q(eng, """
    WITH first_order AS (
    SELECT contact_identification, MIN(created_at) AS first_at
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT date_trunc('month', first_at)::date AS mes,
    COUNT(*)::int AS n
    FROM first_order
    WHERE first_at >= date_trunc('month', NOW() - INTERVAL '11 months')
    GROUP BY 1 ORDER BY 1
    """) or []
    acquisition_trend = [{
    "date": r[0].strftime("%Y-%m") if r[0] else "",
    "value": float(r[1] or 0),
    } for r in rows]

    # ----- Repurchase distribution (cuantas compras por customer) -----
    rows = q(eng, """
    WITH per_cust AS (
    SELECT contact_identification, COUNT(*) AS n
    FROM public.tienda_nube_orders
    WHERE payment_status::text = 'paid'
    AND contact_identification IS NOT NULL
    GROUP BY 1
    )
    SELECT
    CASE WHEN n = 1 THEN '1'
    WHEN n = 2 THEN '2'
    WHEN n = 3 THEN '3'
    WHEN n BETWEEN 4 AND 5 THEN '4-5'
    WHEN n BETWEEN 6 AND 10 THEN '6-10'
    ELSE '11+'
    END AS bucket,
    COUNT(*)::int AS n_customers
    FROM per_cust
    GROUP BY 1
    ORDER BY MIN(n)
    """) or []
    repurchase_distribution = [{
    "category": f"{r[0]} compra{'s' if r[0] != '1' else ''}",
    "value": int(r[1] or 0),
    } for r in rows]

    # ----- Provincias con mas cancelaciones -----
    rows = q(eng, """
    SELECT COALESCE(NULLIF(TRIM(billing_province),''),'(sin provincia)'),
    COUNT(*)::int AS cancelaciones,
    SUM(total)::float AS monto_perdido
    FROM public.tienda_nube_orders
    WHERE status::text = 'cancelled'
    AND created_at >= NOW() - make_interval(days => :days)
    GROUP BY 1
    ORDER BY 2 DESC LIMIT 10
    """, p) or []
    cancel_by_province = [{
    "category": r[0],
    "value": int(r[1] or 0),
    "extra": {"monto_perdido": round(float(r[2] or 0), 0)},
    } for r in rows]

    return {
    "unit": "unidrop",
    "period": period,
    "channel": channel,
    "cards": cards,
    "cancel_trend": cancel_trend,
    "volume_trend": volume_trend,
    "cancel_reasons": cancel_reasons,
    "top_users_cancel": top_users_cancel,
    "recent_cancellations": recent_cancellations,
    "customer_status_dist": customer_status_dist,
    "top_customers_revenue": top_customers_revenue,
    "acquisition_trend": acquisition_trend,
    "repurchase_distribution": repurchase_distribution,
    "cancel_by_province": cancel_by_province,
    "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
