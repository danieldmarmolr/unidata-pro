"""
CRM de suscriptores (Unidrop).
Vista 360 para evitar churn, potenciar campañas y conocer el status de cada
suscriptor: lifecycle stage, riesgo de baja, revenue lifetime, ultima
actividad. Granularidad por plan, status, segmento.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar

log = logging.getLogger("unidata.crm")


def crm_subscribers(
    filter_status: str = "all",
    plan: str = "all",
    riesgo: str = "all",
    search: str | None = None,
    limit: int = 1000,
) -> dict:
    """
    Lista enriquecida de suscriptores Unidrop con:
    - status (activo, vencido, etc)
    - days_to_expire (negativo si ya vencio)
    - lifecycle_stage (signup → conecta_tn → conecta_ml → publica → vende)
    - riesgo (alto/medio/bajo/vencido)
    - intents (ok, pendientes, cancelados)
    - revenue_total (paidAmount)
    """
    eng = get_engine("unidrop")

    # WHERE clauses dinamicos
    wh: list[str] = ["1=1"]
    params: dict = {}

    if filter_status == "activo":
        wh.append("u.end_date_subscription > NOW()")
    elif filter_status == "vencido":
        wh.append("u.end_date_subscription <= NOW()")
    elif filter_status == "sin_sub":
        wh.append("u.end_date_subscription IS NULL")

    if plan and plan != "all":
        wh.append('u."subscriptionId" = :plan_id')
        params["plan_id"] = int(plan)

    if riesgo == "alto":
        wh.append("u.end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '7 days'")
    elif riesgo == "medio":
        wh.append("u.end_date_subscription BETWEEN NOW() + INTERVAL '7 days' AND NOW() + INTERVAL '15 days'")
    elif riesgo == "bajo":
        wh.append("u.end_date_subscription > NOW() + INTERVAL '15 days'")
    elif riesgo == "vencido":
        wh.append("u.end_date_subscription <= NOW()")

    if search:
        wh.append("(LOWER(u.name) LIKE :s OR LOWER(u.email) LIKE :s OR LOWER(COALESCE(u.fantasy_name,'')) LIKE :s OR u.dni LIKE :s)")
        params["s"] = f"%{search.lower()}%"

    where_sql = " AND ".join(wh)

    sql = f"""
    SELECT
        u.id,
        COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, '') AS nombre,
        u.email,
        COALESCE(u.phone, '') AS telefono,
        u.dni,
        COALESCE(u.personeria::text,'') AS personeria,
        sm.name AS plan,
        sm.price::float AS plan_precio,
        u.start_date_subscription::text AS desde,
        u.end_date_subscription::text AS vence,
        CASE
            WHEN u.end_date_subscription IS NULL THEN NULL
            ELSE EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int
        END AS dias_al_vencimiento,
        CASE
            WHEN u.end_date_subscription IS NULL THEN 'sin_suscripcion'
            WHEN u.end_date_subscription < NOW() THEN 'vencido'
            WHEN u.end_date_subscription < NOW() + INTERVAL '7 days' THEN 'riesgo_alto'
            WHEN u.end_date_subscription < NOW() + INTERVAL '15 days' THEN 'riesgo_medio'
            ELSE 'al_dia'
        END AS riesgo,
        -- lifecycle stage (mas alto el numero, mas avanzado)
        CASE
            WHEN EXISTS (SELECT 1 FROM public.tienda_nube_orders o WHERE o.user_id = u.id AND o.payment_status::text='paid') THEN 'vendiendo'
            WHEN EXISTS (SELECT 1 FROM mercado_libre_dev."PublicationUserMercadoLibre" p WHERE p."mlAccountId" = u."mercadoLibreAccountId") THEN 'publicando_ml'
            WHEN u."mercadoLibreAccountId" IS NOT NULL THEN 'conecta_ml'
            WHEN u.store_id IS NOT NULL AND EXISTS (SELECT 1 FROM public."TiendaNubeCredential" tc WHERE tc.store_id = u.store_id) THEN 'conecta_tn'
            ELSE 'signup'
        END AS lifecycle_stage,
        -- intents agregados
        (SELECT COUNT(*) FROM public."PaymentIntentSubscription" pis
            WHERE pis."userId" = u.id AND pis.status::text='PROCESSED') AS intents_ok,
        (SELECT COUNT(*) FROM public."PaymentIntentSubscription" pis
            WHERE pis."userId" = u.id AND pis.status::text='PENDING') AS intents_pendientes,
        (SELECT COUNT(*) FROM public."PaymentIntentSubscription" pis
            WHERE pis."userId" = u.id AND pis.status::text='CANCELLED') AS intents_cancelados,
        -- revenue lifetime
        COALESCE((SELECT SUM(pis."paidAmount")::float FROM public."PaymentIntentSubscription" pis
                  WHERE pis."userId" = u.id AND pis.status::text='PROCESSED'), 0) AS revenue_total,
        -- ultima actividad: ultima orden del user (proxy de actividad real)
        (SELECT MAX(o.created_at)::text FROM public.tienda_nube_orders o WHERE o.user_id = u.id) AS ultima_orden,
        -- numero de ordenes lifetime
        (SELECT COUNT(*) FROM public.tienda_nube_orders o WHERE o.user_id = u.id AND o.payment_status::text='paid') AS orders_paid
    FROM public."User" u
    LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
    WHERE {where_sql}
      AND COALESCE(u."isActive", TRUE) IS TRUE
      AND u."subscriptionId" IS NOT NULL
    ORDER BY
      CASE
        WHEN u.end_date_subscription IS NULL THEN 999
        WHEN u.end_date_subscription < NOW() THEN -1
        ELSE EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int
      END ASC
    LIMIT :lim
    """
    params["lim"] = int(limit)

    rows = q(eng, sql, params) or []

    items = [{
        "id": int(r[0] or 0),
        "nombre": r[1] or "",
        "email": r[2] or "",
        "telefono": r[3] or "",
        "dni": r[4] or "",
        "personeria": r[5] or "",
        "plan": r[6] or "(sin plan)",
        "plan_precio": float(r[7] or 0),
        "desde": r[8],
        "vence": r[9],
        "dias_al_vencimiento": r[10],
        "riesgo": r[11],
        "lifecycle_stage": r[12],
        "intents_ok": int(r[13] or 0),
        "intents_pendientes": int(r[14] or 0),
        "intents_cancelados": int(r[15] or 0),
        "revenue_total": float(r[16] or 0),
        "ultima_orden": r[17],
        "orders_paid": int(r[18] or 0),
    } for r in rows]

    # Stats agregados para los chips de filtro
    stats = q(eng, """
        SELECT
            COUNT(*) FILTER (WHERE end_date_subscription > NOW()) AS activos,
            COUNT(*) FILTER (WHERE end_date_subscription <= NOW()) AS vencidos,
            COUNT(*) FILTER (WHERE end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '7 days') AS riesgo_alto,
            COUNT(*) FILTER (WHERE end_date_subscription BETWEEN NOW() + INTERVAL '7 days' AND NOW() + INTERVAL '15 days') AS riesgo_medio,
            COUNT(*) FILTER (WHERE end_date_subscription > NOW() + INTERVAL '15 days') AS al_dia
        FROM public."User"
        WHERE "subscriptionId" IS NOT NULL
          AND COALESCE("isActive", TRUE) IS TRUE
    """) or [(0, 0, 0, 0, 0)]
    s = stats[0]

    return {
        "items": items,
        "total": len(items),
        "stats": {
            "activos": int(s[0] or 0),
            "vencidos": int(s[1] or 0),
            "riesgo_alto": int(s[2] or 0),
            "riesgo_medio": int(s[3] or 0),
            "al_dia": int(s[4] or 0),
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def subs_intents_by_plan_status(plan: str, status: str) -> dict:
    """
    Drill: lista de PaymentIntentSubscription para un plan especifico + status.
    Devuelve un set de filas listo para mostrar en modal.
    """
    eng = get_engine("unidrop")
    p: dict = {}
    where = "1=1"
    if plan != "all":
        where += ' AND pis."subscriptionMeliId" = :pid'
        p["pid"] = int(plan)
    if status != "all":
        where += " AND pis.status::text = :st"
        p["st"] = status.upper()

    rows = q(eng, f"""
        SELECT pis.id,
               pis."createdAt"::text AS fecha,
               pis.status::text AS status,
               pis."expectedAmount"::float AS monto_esperado,
               pis."paidAmount"::float AS monto_pagado,
               COALESCE(sm.name,'(sin plan)') AS plan,
               u.id AS user_id,
               COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, '') AS nombre,
               u.email,
               COALESCE(u.phone,'') AS telefono,
               COALESCE(u.dni,'') AS dni,
               u.end_date_subscription::text AS vence,
               CASE WHEN pis.from_landing THEN 'landing' ELSE 'plataforma' END AS origen
        FROM public."PaymentIntentSubscription" pis
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = pis."subscriptionMeliId"
        LEFT JOIN public."User" u ON u.id = pis."userId"
        WHERE {where}
        ORDER BY pis."createdAt" DESC LIMIT 1000
    """, p) or []
    return {
        "columns": ["id", "fecha", "status", "monto_esperado", "monto_pagado",
                    "plan", "user_id", "nombre", "email", "telefono", "dni", "vence", "origen"],
        "rows": [list(r) for r in rows],
        "row_count": len(rows),
    }
