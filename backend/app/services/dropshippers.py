"""
Métricas Dropshippers — vista 360 por operador Unidrop.
Replica el dashboard de Google Sheets que carga el equipo cada hora.

Por user_id agrega:
- Datos basicos (nombre, email, dni, plan, MELI account)
- Cantidad de referidos
- Publicaciones (activas, totales, primera, ultima)
- Ventas MELI (cantidad, GMV, costo mercaderia, costo envio, profit)
- Pagos UNIDROP (procesados, costo total, MELI vs TN)
- Deuda (pendientes)
- Cohortes por mes de signup
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar

log = logging.getLogger("unidata.dropshippers")


def dropshippers_master(
    plan: str = "all",
    riesgo: str = "all",
    actividad: str = "all",
    search: str | None = None,
    limit: int = 10000,
) -> dict:
    """
    Master view: 1 row por dropshipper con todas las metricas agregadas.
    Filtros:
      plan: 'all'|'1'|'2'|'3'|'4'
      riesgo: 'all' (alguna), 'sin_publicar', 'sin_vender', 'con_deuda', 'token_expira'
      actividad: 'all', 'activo' (vendio en 30d), 'inactivo'
    """
    eng = get_engine("unidrop")
    p: dict = {}
    wh: list[str] = ["u.\"subscriptionId\" IS NOT NULL"]

    if plan != "all":
        wh.append('u."subscriptionId" = :pid')
        p["pid"] = int(plan)
    if search:
        wh.append("(LOWER(u.name) LIKE :s OR LOWER(u.email) LIKE :s OR u.dni LIKE :s OR LOWER(COALESCE(u.fantasy_name,'')) LIKE :s OR LOWER(COALESCE(mla.nickname,'')) LIKE :s)")
        p["s"] = f"%{(search or '').lower()}%"

    where_sql = " AND ".join(wh)

    sql = f"""
    WITH referidos AS (
        SELECT "referrerId" AS user_id, COUNT(*)::int AS cant_referidos
        FROM public."User"
        WHERE "referrerId" IS NOT NULL
        GROUP BY "referrerId"
    ),
    publicaciones AS (
        SELECT "mlAccountId" AS cuenta_meli_id,
               COUNT(*) FILTER (WHERE "status" = 'active')::int AS pub_activas,
               COUNT(*)::int AS pub_totales,
               MAX("createdAt") AS ultima_publicacion
        FROM mercado_libre_dev."PublicationUserMercadoLibre"
        GROUP BY "mlAccountId"
    ),
    ventas AS (
        SELECT mla."id" AS cuenta_meli_id,
               COUNT(*) FILTER (WHERE o."status"='paid')::int AS ventas_pagadas,
               COUNT(*)::int AS ordenes_totales,
               MAX(o."dateCreated") FILTER (WHERE o."status"='paid') AS ultima_venta,
               COALESCE(SUM(p.gmv) FILTER (WHERE o."status"='paid'),0)::float AS gmv,
               COALESCE(SUM(o."merchandise_cost") FILTER (WHERE o."status"='paid'),0)::float AS costo_mercaderia,
               COALESCE(SUM(o."shipping_cost") FILTER (WHERE o."status"='paid'),0)::float AS costo_envio,
               COALESCE(SUM(o."profit_for_subscription") FILTER (WHERE o."status"='paid'),0)::float AS profit_unidrop,
               COUNT(*) FILTER (WHERE o."status"='cancelled')::int AS canceladas,
               COUNT(*) FILTER (WHERE o."cancel_by_unidrop"=TRUE)::int AS canceladas_staff,
               COUNT(*) FILTER (WHERE COALESCE(array_length(o."missing_sku",1),0)>0)::int AS sku_faltante
        FROM mercado_libre_dev."OrderMercadoLibre" o
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
            ON mla."mlUserId"::text = o."sellerId"::text
        LEFT JOIN (
            SELECT "orderId", SUM(COALESCE("transaction_amount",0))
                   FILTER (WHERE "status" IN ('approved','paid'))::float AS gmv
            FROM mercado_libre_dev."PaymentMercadoLibre"
            GROUP BY 1
        ) p ON p."orderId" = o.id
        GROUP BY mla."id"
    ),
    pagos AS (
        SELECT cpa."userId" AS user_id,
               COUNT(*)::int AS pagos_procesados,
               COALESCE(SUM(pi."paidAmount"),0)::float AS costo_unidrop_total,
               COALESCE(SUM(pi."paidAmount") FILTER (WHERE COALESCE(array_length(pi."mlOrderIds",1),0)>0),0)::float AS costo_unidrop_meli,
               COALESCE(SUM(pi."paidAmount") FILTER (WHERE COALESCE(array_length(pi."orderIds",1),0)>0),0)::float AS costo_unidrop_tn,
               MAX(pi."createdAt") AS ultimo_pago
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa."id" = pi."customerAccountId"
        WHERE pi."status" = 'PROCESSED'
        GROUP BY cpa."userId"
    ),
    deuda AS (
        SELECT cpa."userId" AS user_id,
               COALESCE(SUM(pi."pendingAmount") FILTER (WHERE pi."status" <> 'PROCESSED'),0)::float AS deuda_pendiente,
               COUNT(*) FILTER (WHERE pi."status" <> 'PROCESSED' AND COALESCE(pi."pendingAmount",0) > 0)::int AS pagos_con_deuda
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa."id" = pi."customerAccountId"
        GROUP BY cpa."userId"
    )
    SELECT
        u.id AS user_id,
        u.name AS nombre,
        u.email,
        u.phone AS telefono,
        u.dni,
        u.cuit,
        u.fantasy_name,
        u.personeria::text AS personeria,
        u."isActive" AS activo,
        u."createdAt"::text AS creado_en,
        sm.id AS plan_id,
        sm.name AS plan,
        sm.price::float AS plan_precio,
        sm.number_of_publications_allowed::int AS plan_pub_max,
        u.start_date_subscription::text AS sub_desde,
        u.end_date_subscription::text AS sub_vence,
        u.subscription_status::text AS sub_status,
        EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int AS dias_al_vencimiento,
        mla.id AS cuenta_meli_id,
        mla.nickname AS nickname_meli,
        mla."requiresReauth" AS requiere_reauth,
        mla."expiresAt"::text AS token_expira,
        COALESCE(r.cant_referidos, 0) AS cant_referidos,
        COALESCE(pub.pub_activas, 0) AS pub_activas,
        COALESCE(pub.pub_totales, 0) AS pub_totales,
        pub.ultima_publicacion::text,
        COALESCE(v.ventas_pagadas, 0) AS ventas_pagadas,
        COALESCE(v.ordenes_totales, 0) AS ordenes_totales,
        v.ultima_venta::text,
        COALESCE(v.gmv, 0)::float AS gmv,
        COALESCE(v.costo_mercaderia, 0)::float AS costo_mercaderia,
        COALESCE(v.profit_unidrop, 0)::float AS profit_unidrop,
        COALESCE(v.canceladas, 0) AS canceladas,
        COALESCE(v.canceladas_staff, 0) AS canceladas_staff,
        COALESCE(v.sku_faltante, 0) AS sku_faltante,
        COALESCE(pg.pagos_procesados, 0) AS pagos_procesados,
        COALESCE(pg.costo_unidrop_total, 0)::float AS pago_unidrop_total,
        COALESCE(pg.costo_unidrop_meli, 0)::float AS pago_unidrop_meli,
        pg.ultimo_pago::text,
        COALESCE(d.deuda_pendiente, 0)::float AS deuda_pendiente,
        COALESCE(d.pagos_con_deuda, 0) AS pagos_con_deuda
    FROM public."User" u
    LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
    LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = u."mercadoLibreAccountId"
    LEFT JOIN referidos r ON r.user_id = u.id
    LEFT JOIN publicaciones pub ON pub.cuenta_meli_id = mla.id
    LEFT JOIN ventas v ON v.cuenta_meli_id = mla.id
    LEFT JOIN pagos pg ON pg.user_id = u.id
    LEFT JOIN deuda d ON d.user_id = u.id
    WHERE {where_sql}
      AND COALESCE(u."isActive", TRUE) = TRUE
    ORDER BY COALESCE(v.gmv, 0) DESC NULLS LAST, u."createdAt" DESC
    LIMIT :lim
    """
    p["lim"] = int(limit)

    rows = q(eng, sql, p) or []

    keys = [
        "user_id", "nombre", "email", "telefono", "dni", "cuit", "fantasy_name", "personeria",
        "activo", "creado_en",
        "plan_id", "plan", "plan_precio", "plan_pub_max",
        "sub_desde", "sub_vence", "sub_status", "dias_al_vencimiento",
        "cuenta_meli_id", "nickname_meli", "requiere_reauth", "token_expira",
        "cant_referidos", "pub_activas", "pub_totales", "ultima_publicacion",
        "ventas_pagadas", "ordenes_totales", "ultima_venta",
        "gmv", "costo_mercaderia", "profit_unidrop",
        "canceladas", "canceladas_staff", "sku_faltante",
        "pagos_procesados", "pago_unidrop_total", "pago_unidrop_meli", "ultimo_pago",
        "deuda_pendiente", "pagos_con_deuda",
    ]

    universe = [dict(zip(keys, r)) for r in rows]

    # ============================================================
    # STATS GLOBALES sobre el UNIVERSO (plan + search ya aplicados)
    # NO se afectan por riesgo / actividad — esos son filtros de la
    # tabla, no del totalizador. Antes los KPIs y los chips caian a 0
    # cuando se filtraba "con deuda" porque se calculaban sobre la
    # lista filtrada.
    # ============================================================
    cutoff_30d = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)

    def _last_sale_dt(it):
        uv = it.get("ultima_venta")
        if not uv:
            return None
        try:
            d = dt.datetime.fromisoformat(uv.replace(" ", "T"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d
        except Exception:
            return None

    universe_total = len(universe)
    sum_gmv = sum(float(it.get("gmv") or 0) for it in universe)
    sum_profit = sum(float(it.get("profit_unidrop") or 0) for it in universe)
    sum_pago = sum(float(it.get("pago_unidrop_total") or 0) for it in universe)
    sum_deuda = sum(float(it.get("deuda_pendiente") or 0) for it in universe)

    sin_publicar_u = sum(1 for it in universe if (it.get("pub_activas") or 0) == 0)
    sin_vender_u = sum(1 for it in universe if (it.get("ventas_pagadas") or 0) == 0)
    con_deuda_u = sum(1 for it in universe if (it.get("deuda_pendiente") or 0) > 0)
    token_expira_u = sum(1 for it in universe if it.get("requiere_reauth") is True)

    activos_30d = sum(
        1 for it in universe
        if (_last_sale_dt(it) is not None and _last_sale_dt(it) >= cutoff_30d)
    )
    inactivos = universe_total - activos_30d

    # ============================================================
    # FILTROS de la lista (afectan SOLO la tabla, no los KPIs)
    # ============================================================
    items = list(universe)

    if riesgo == "sin_publicar":
        items = [it for it in items if (it.get("pub_activas") or 0) == 0]
    elif riesgo == "sin_vender":
        items = [it for it in items if (it.get("ventas_pagadas") or 0) == 0]
    elif riesgo == "con_deuda":
        items = [it for it in items if (it.get("deuda_pendiente") or 0) > 0]
    elif riesgo == "token_expira":
        items = [it for it in items if it.get("requiere_reauth") is True]

    if actividad == "activo":
        items = [it for it in items if (_last_sale_dt(it) is not None and _last_sale_dt(it) >= cutoff_30d)]
    elif actividad == "inactivo":
        items = [it for it in items if not (_last_sale_dt(it) is not None and _last_sale_dt(it) >= cutoff_30d)]

    # KPIs adicionales SOBRE LA LISTA FILTRADA — utiles cuando el usuario
    # quiere ver agregados del subset (ej: "GMV de los con_deuda")
    filtered_total = len(items)
    filtered_gmv = sum(float(it.get("gmv") or 0) for it in items)
    filtered_profit = sum(float(it.get("profit_unidrop") or 0) for it in items)
    filtered_pago = sum(float(it.get("pago_unidrop_total") or 0) for it in items)
    filtered_deuda = sum(float(it.get("deuda_pendiente") or 0) for it in items)

    return {
        "items": items,
        "total": filtered_total,  # cantidad de la lista visible
        # Stats globales del universo (plan + search aplicados, NO riesgo/actividad)
        "stats": {
            "total": universe_total,
            "gmv": round(sum_gmv, 0),
            "profit_unidrop": round(sum_profit, 0),
            "pago_unidrop": round(sum_pago, 0),
            "deuda_pendiente": round(sum_deuda, 0),
            "sin_publicar": sin_publicar_u,
            "sin_vender": sin_vender_u,
            "con_deuda": con_deuda_u,
            "token_expira": token_expira_u,
            "activos_30d": activos_30d,
            "inactivos": inactivos,
        },
        # Stats del subset filtrado por riesgo/actividad — NO afectan los KPIs
        # principales pero permiten al frontend mostrar "viendo 3 de 1087"
        "filtered_stats": {
            "total": filtered_total,
            "gmv": round(filtered_gmv, 0),
            "profit_unidrop": round(filtered_profit, 0),
            "pago_unidrop": round(filtered_pago, 0),
            "deuda_pendiente": round(filtered_deuda, 0),
        },
        "filters_applied": {
            "plan": plan,
            "riesgo": riesgo,
            "actividad": actividad,
            "search": search or "",
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def dropshipper_detail(user_id: int) -> dict:
    """Vista 360 de un dropshipper Unidrop (no confundir con Customer Unistore TN).

    Devuelve KPIs + series mensuales + ultimas ventas MELI + ultimos pagos Talo.
    Todas las metricas vienen de la BD de Unidrop:
      - Ventas: mercado_libre_dev.OrderMercadoLibre (NO Tienda Nube)
      - Pagos: public.PaymentIntent + public.CustomerPaymentAccount
      - Plan: public.User + mercado_libre_dev.SubscriptionMeli
      - Cuenta MELI: mercado_libre_dev.MercadoLibreUserAccount
    """
    eng = get_engine("unidrop")

    head_rows = q(eng, """
        SELECT
            u.id, u.name, u.email, u.phone, u.dni, u.cuit, u.fantasy_name,
            u.personeria::text, u."isActive", u."createdAt"::text,
            u."referrerId",
            sm.id AS plan_id, sm.name AS plan, sm.price::float, sm.number_of_publications_allowed::int,
            u.start_date_subscription::text, u.end_date_subscription::text,
            u.subscription_status::text,
            EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int AS dias_al_vencimiento,
            mla.id AS cuenta_meli_id, mla.nickname AS nickname_meli,
            mla."requiresReauth", mla."expiresAt"::text,
            (SELECT COUNT(*) FROM public."User" u2 WHERE u2."referrerId" = u.id)::int AS cant_referidos
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = u."mercadoLibreAccountId"
        WHERE u.id = :uid
    """, {"uid": int(user_id)}) or []

    if not head_rows:
        return {"error": "Dropshipper no encontrado"}

    h = head_rows[0]
    user = {
        "user_id": int(h[0]),
        "nombre": h[1] or "",
        "email": h[2] or "",
        "telefono": h[3] or "",
        "dni": h[4] or "",
        "cuit": h[5] or "",
        "fantasy_name": h[6] or "",
        "personeria": h[7] or "",
        "activo": bool(h[8]) if h[8] is not None else True,
        "creado_en": h[9],
        "referrer_id": int(h[10]) if h[10] else None,
        "plan_id": h[11],
        "plan": h[12] or "",
        "plan_precio": float(h[13] or 0),
        "plan_pub_max": int(h[14] or 0),
        "sub_desde": h[15],
        "sub_vence": h[16],
        "sub_status": h[17] or "",
        "dias_al_vencimiento": int(h[18]) if h[18] is not None else None,
        "cuenta_meli_id": h[19],
        "nickname_meli": h[20] or "",
        "requiere_reauth": bool(h[21]) if h[21] is not None else False,
        "token_expira": h[22],
        "cant_referidos": int(h[23] or 0),
    }

    # KPIs de ventas MELI
    ventas = q(eng, """
        SELECT
            COUNT(*) FILTER (WHERE o."status"='paid')::int AS ventas_pagadas,
            COUNT(*)::int AS ordenes_totales,
            COUNT(*) FILTER (WHERE o."status"='cancelled')::int AS canceladas,
            MAX(o."dateCreated") FILTER (WHERE o."status"='paid')::text AS ultima_venta,
            MIN(o."dateCreated") FILTER (WHERE o."status"='paid')::text AS primera_venta,
            COALESCE(SUM(p.gmv) FILTER (WHERE o."status"='paid'),0)::float AS gmv,
            COALESCE(SUM(o."merchandise_cost") FILTER (WHERE o."status"='paid'),0)::float AS costo_mercaderia,
            COALESCE(SUM(o."shipping_cost") FILTER (WHERE o."status"='paid'),0)::float AS costo_envio,
            COALESCE(SUM(o."profit_for_subscription") FILTER (WHERE o."status"='paid'),0)::float AS profit_unidrop,
            COALESCE(AVG(p.gmv) FILTER (WHERE o."status"='paid'),0)::float AS ticket_promedio
        FROM mercado_libre_dev."OrderMercadoLibre" o
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = o."mercadoLibreUserAccountId"
        LEFT JOIN (
            SELECT "orderId", SUM("totalAmount")::float AS gmv
            FROM mercado_libre_dev."PaymentMercadoLibre"
            GROUP BY 1
        ) p ON p."orderId" = o.id
        WHERE mla."userId" = :uid
    """, {"uid": int(user_id)}) or [(0, 0, 0, None, None, 0, 0, 0, 0, 0)]
    v = ventas[0]
    ventas_kpi = {
        "ventas_pagadas": int(v[0] or 0),
        "ordenes_totales": int(v[1] or 0),
        "canceladas": int(v[2] or 0),
        "ultima_venta": v[3],
        "primera_venta": v[4],
        "gmv": float(v[5] or 0),
        "costo_mercaderia": float(v[6] or 0),
        "costo_envio": float(v[7] or 0),
        "profit_unidrop": float(v[8] or 0),
        "ticket_promedio": float(v[9] or 0),
        "tasa_cancelacion_pct": round(int(v[2] or 0) / max(int(v[1] or 1), 1) * 100, 1),
    }

    # KPIs de pagos Talo (PaymentIntent / CustomerPaymentAccount)
    pagos = q(eng, """
        SELECT
            COUNT(*)::int AS total_intents,
            COUNT(*) FILTER (WHERE pi."status"='PROCESSED')::int AS procesados,
            COALESCE(SUM(pi."paidAmount") FILTER (WHERE pi."status"='PROCESSED'),0)::float AS pagado_total,
            COALESCE(SUM(pi."pendingAmount") FILTER (WHERE pi."status"<>'PROCESSED'),0)::float AS deuda_pendiente,
            COUNT(*) FILTER (WHERE pi."status"<>'PROCESSED' AND COALESCE(pi."pendingAmount",0) > 0)::int AS pagos_con_deuda,
            MAX(pi."createdAt") FILTER (WHERE pi."status"='PROCESSED')::text AS ultimo_pago
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
    """, {"uid": int(user_id)}) or [(0, 0, 0, 0, 0, None)]
    pg = pagos[0]
    pagos_kpi = {
        "total_intents": int(pg[0] or 0),
        "procesados": int(pg[1] or 0),
        "pagado_total": float(pg[2] or 0),
        "deuda_pendiente": float(pg[3] or 0),
        "pagos_con_deuda": int(pg[4] or 0),
        "ultimo_pago": pg[5],
    }

    # Publicaciones
    pub = q(eng, """
        SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE "status" = 'active')::int AS activas,
            MAX("createdAt")::text AS ultima
        FROM mercado_libre_dev."PublicationUserMercadoLibre" pum
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = pum."mlAccountId"
        WHERE mla."userId" = :uid
    """, {"uid": int(user_id)}) or [(0, 0, None)]
    p = pub[0]
    pubs = {
        "totales": int(p[0] or 0),
        "activas": int(p[1] or 0),
        "ultima": p[2],
    }

    # Serie mensual GMV + profit (12 meses)
    monthly = q(eng, """
        SELECT to_char(date_trunc('month', o."dateCreated"), 'YYYY-MM') AS mes,
               COUNT(*) FILTER (WHERE o."status"='paid')::int AS ordenes,
               COALESCE(SUM(p.gmv) FILTER (WHERE o."status"='paid'),0)::float AS gmv,
               COALESCE(SUM(o."profit_for_subscription") FILTER (WHERE o."status"='paid'),0)::float AS profit
        FROM mercado_libre_dev."OrderMercadoLibre" o
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = o."mercadoLibreUserAccountId"
        LEFT JOIN (
            SELECT "orderId", SUM("totalAmount")::float AS gmv
            FROM mercado_libre_dev."PaymentMercadoLibre"
            GROUP BY 1
        ) p ON p."orderId" = o.id
        WHERE mla."userId" = :uid
          AND o."dateCreated" >= NOW() - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY 1
    """, {"uid": int(user_id)}) or []
    monthly_series = [{
        "mes": r[0],
        "ordenes": int(r[1] or 0),
        "gmv": round(float(r[2] or 0), 2),
        "profit": round(float(r[3] or 0), 2),
    } for r in monthly]

    # Ultimas 50 ventas MELI
    last_orders = q(eng, """
        SELECT o.id, o."mlOrderId", o."status", o."dateCreated"::text,
               COALESCE(p.gmv,0)::float AS total,
               COALESCE(o."profit_for_subscription",0)::float AS profit_unidrop,
               COALESCE(o."shipping_cost",0)::float AS shipping_cost
        FROM mercado_libre_dev."OrderMercadoLibre" o
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = o."mercadoLibreUserAccountId"
        LEFT JOIN (
            SELECT "orderId", SUM("totalAmount")::float AS gmv
            FROM mercado_libre_dev."PaymentMercadoLibre"
            GROUP BY 1
        ) p ON p."orderId" = o.id
        WHERE mla."userId" = :uid
        ORDER BY o."dateCreated" DESC NULLS LAST
        LIMIT 50
    """, {"uid": int(user_id)}) or []
    orders = [{
        "id": int(r[0]) if r[0] else None,
        "ml_order_id": r[1] or "",
        "status": r[2] or "",
        "fecha": r[3],
        "total": round(float(r[4] or 0), 2),
        "profit_unidrop": round(float(r[5] or 0), 2),
        "shipping_cost": round(float(r[6] or 0), 2),
    } for r in last_orders]

    # Ultimos 50 pagos Talo
    last_pagos = q(eng, """
        SELECT pi.id, pi."status"::text, pi."createdAt"::text,
               COALESCE(pi."paidAmount",0)::float AS paid,
               COALESCE(pi."pendingAmount",0)::float AS pending,
               COALESCE(array_length(pi."mlOrderIds",1),0)::int AS ml_orders,
               COALESCE(array_length(pi."orderIds",1),0)::int AS tn_orders
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
        ORDER BY pi."createdAt" DESC NULLS LAST
        LIMIT 50
    """, {"uid": int(user_id)}) or []
    pagos_list = [{
        "id": int(r[0]) if r[0] else None,
        "status": r[1] or "",
        "fecha": r[2],
        "paid": round(float(r[3] or 0), 2),
        "pending": round(float(r[4] or 0), 2),
        "ml_orders": int(r[5] or 0),
        "tn_orders": int(r[6] or 0),
    } for r in last_pagos]

    return {
        "user": user,
        "ventas": ventas_kpi,
        "pagos": pagos_kpi,
        "publicaciones": pubs,
        "monthly": monthly_series,
        "ultimas_ventas": orders,
        "ultimos_pagos": pagos_list,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def cohort_signups() -> dict:
    """Cohort por mes de signup: usuarios que se sumaron y cuántos siguen activos / vendieron."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        WITH base AS (
            SELECT u.id,
                   date_trunc('month', u."createdAt")::date AS cohort_mes,
                   u."subscriptionId",
                   u.end_date_subscription,
                   u.\"mercadoLibreAccountId\"
            FROM public."User" u
            WHERE u."subscriptionId" IS NOT NULL
              AND u."createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        )
        SELECT cohort_mes,
               COUNT(*)::int AS signups,
               COUNT(*) FILTER (WHERE end_date_subscription > NOW())::int AS aun_activos,
               COUNT(*) FILTER (WHERE \"mercadoLibreAccountId\" IS NOT NULL)::int AS conecto_meli
        FROM base
        GROUP BY 1 ORDER BY 1
    """) or []
    return {
        "cohorts": [{
            "mes": r[0].strftime("%Y-%m") if r[0] else "",
            "signups": int(r[1] or 0),
            "aun_activos": int(r[2] or 0),
            "conecto_meli": int(r[3] or 0),
            "retention_pct": round(int(r[2] or 0) / int(r[1] or 1) * 100, 1) if r[1] else 0,
            "ml_pct": round(int(r[3] or 0) / int(r[1] or 1) * 100, 1) if r[1] else 0,
        } for r in rows],
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
