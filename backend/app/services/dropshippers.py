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
from app.services._utils import q, scalar, resolve_window, list_columns

log = logging.getLogger("unidata.dropshippers")


def dropshippers_master(
    plan: str = "all",
    riesgo: str = "all",
    actividad: str = "all",
    search: str | None = None,
    limit: int = 10000,
    canal: str = "all",
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """
    Master view: 1 row por dropshipper con todas las metricas agregadas.
    Filtros:
      plan: 'all'|'1'|'2'|'3'|'4'
      riesgo: 'all' (alguna), 'sin_publicar', 'sin_vender', 'con_deuda', 'token_expira'
      actividad: 'all', 'activo' (vendio en 30d), 'inactivo'
      canal: 'all' | 'meli' (solo MELI con suscripcion) | 'tn' (solo TN, sin sub)
             | 'ambos' (vende en MELI y TN) | 'sin_canal' (alta sin operar)

    Reglas de negocio Unidrop:
      - Los que pagan suscripcion son SOLO los que integran MELI
      - Hay dropshippers que solo venden por TN (sin suscripcion)
      - Hay dropshippers que venden en ambos canales
      - El universo del listado incluye todos los que tienen alguna senal de
        operacion (MELI o TN), no solo los con subscriptionId.
    """
    eng = get_engine("unidrop")
    # Ventana temporal para los KPIs (ventas/pagos). El universo del listado
    # NO se filtra por fecha (los dropshippers existen aunque no hayan
    # vendido en el periodo) - solo cambian los agregados monetarios.
    days = resolve_window(period, from_iso, to_iso)["days"]
    p: dict = {"period_days": int(days)}
    # El universo ahora incluye: usuarios con suscripcion MELI O con cuenta MELI
    # vinculada O con credencial TN O con orders TN. NO requiere subscriptionId.
    # TiendaNubeCredential se cruza por store_id (NO tiene userId).
    # Con eso un User esta vinculado a una tienda TN si u.store_id = tnc.store_id.
    wh: list[str] = [
        "(u.\"subscriptionId\" IS NOT NULL "
        " OR u.\"mercadoLibreAccountId\" IS NOT NULL "
        " OR (u.store_id IS NOT NULL AND EXISTS ("
        "       SELECT 1 FROM public.\"TiendaNubeCredential\" tnc WHERE tnc.store_id = u.store_id"
        "    )) "
        " OR EXISTS (SELECT 1 FROM public.tienda_nube_orders tno WHERE tno.user_id = u.id))"
    ]

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
        WHERE o."dateCreated" >= NOW() - make_interval(days => :period_days)
        GROUP BY mla."id"
    ),
    pagos AS (
        -- Ground truth de actividad: PaymentIntent PROCESSED. Tambien cuenta
        -- las ordenes ML/TN que se cobraron via Talo (mlOrderIds + orderIds).
        -- Esto permite mostrar conteos reales para dropshippers cuyas ventas
        -- no estan sincronizadas en OrderMercadoLibre / tienda_nube_orders.
        SELECT cpa."userId" AS user_id,
               COUNT(*)::int AS pagos_procesados,
               COALESCE(SUM(pi."paidAmount"),0)::float AS costo_unidrop_total,
               COALESCE(SUM(pi."paidAmount") FILTER (WHERE COALESCE(array_length(pi."mlOrderIds",1),0)>0),0)::float AS costo_unidrop_meli,
               COALESCE(SUM(pi."paidAmount") FILTER (WHERE COALESCE(array_length(pi."orderIds",1),0)>0),0)::float AS costo_unidrop_tn,
               COALESCE(SUM(COALESCE(array_length(pi."mlOrderIds",1),0)),0)::int AS intent_ml_orders,
               COALESCE(SUM(COALESCE(array_length(pi."orderIds",1),0)),0)::int AS intent_tn_orders,
               MAX(pi."createdAt") AS ultimo_pago
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa."id" = pi."customerAccountId"
        WHERE pi."status" = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :period_days)
        GROUP BY cpa."userId"
    ),
    deuda AS (
        -- Deuda NO se filtra por periodo: la deuda pendiente es estado actual,
        -- no una metrica de actividad temporal.
        SELECT cpa."userId" AS user_id,
               COALESCE(SUM(pi."pendingAmount") FILTER (WHERE pi."status" <> 'PROCESSED'),0)::float AS deuda_pendiente,
               COUNT(*) FILTER (WHERE pi."status" <> 'PROCESSED' AND COALESCE(pi."pendingAmount",0) > 0)::int AS pagos_con_deuda
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa."id" = pi."customerAccountId"
        GROUP BY cpa."userId"
    ),
    -- TN: agregados de orders TN del cliente final del dropshipper - filtrados por periodo.
    -- user_id apunta al dropshipper Unidrop, NO al cliente final.
    tn AS (
        SELECT user_id,
               COUNT(*)::int AS tn_ordenes_totales,
               COUNT(*) FILTER (WHERE payment_status::text = 'paid')::int AS tn_ventas_pagadas,
               COALESCE(SUM(total) FILTER (WHERE payment_status::text = 'paid'),0)::float AS tn_gmv,
               MAX(created_at) FILTER (WHERE payment_status::text = 'paid')::text AS tn_ultima_venta
        FROM public.tienda_nube_orders
        WHERE user_id IS NOT NULL
          AND created_at >= NOW() - make_interval(days => :period_days)
        GROUP BY user_id
    ),
    -- Credenciales TN: cruce via store_id (NO existe userId en TiendaNubeCredential).
    -- Un User esta vinculado a una tienda TN si comparte store_id con la credencial.
    tnc AS (
        SELECT u2.id AS user_id, COUNT(*)::int AS tn_tiendas
        FROM public."User" u2
        INNER JOIN public."TiendaNubeCredential" t ON t.store_id = u2.store_id
        WHERE u2.store_id IS NOT NULL
        GROUP BY u2.id
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
        -- Ventas ML: max(OrderMercadoLibre, PaymentIntent ground truth)
        GREATEST(COALESCE(v.ventas_pagadas, 0), COALESCE(pg.intent_ml_orders, 0)) AS ventas_pagadas,
        GREATEST(COALESCE(v.ordenes_totales, 0), COALESCE(pg.intent_ml_orders, 0)) AS ordenes_totales,
        COALESCE(pg.intent_ml_orders, 0) AS ventas_pagadas_intent_ml,
        COALESCE(v.ventas_pagadas, 0) AS ventas_pagadas_oml,
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
        COALESCE(d.pagos_con_deuda, 0) AS pagos_con_deuda,
        -- Senales de canal (incluye PaymentIntent como evidencia de actividad)
        (u."subscriptionId" IS NOT NULL OR u."mercadoLibreAccountId" IS NOT NULL OR COALESCE(v.ventas_pagadas,0) > 0 OR COALESCE(pg.intent_ml_orders,0) > 0) AS tiene_meli,
        (COALESCE(tnc.tn_tiendas,0) > 0 OR COALESCE(tn.tn_ventas_pagadas,0) > 0 OR COALESCE(tn.tn_ordenes_totales,0) > 0 OR COALESCE(pg.intent_tn_orders,0) > 0) AS tiene_tn,
        -- Ventas TN: max(tienda_nube_orders, PaymentIntent ground truth)
        GREATEST(COALESCE(tn.tn_ordenes_totales, 0), COALESCE(pg.intent_tn_orders, 0)) AS tn_ordenes_totales,
        GREATEST(COALESCE(tn.tn_ventas_pagadas, 0), COALESCE(pg.intent_tn_orders, 0)) AS tn_ventas_pagadas,
        COALESCE(pg.intent_tn_orders, 0) AS tn_ventas_pagadas_intent,
        COALESCE(tn.tn_ventas_pagadas, 0) AS tn_ventas_pagadas_tno,
        COALESCE(tn.tn_gmv, 0)::float AS tn_gmv,
        tn.tn_ultima_venta::text,
        COALESCE(tnc.tn_tiendas, 0)::int AS tn_tiendas
    FROM public."User" u
    LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
    LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla.id = u."mercadoLibreAccountId"
    LEFT JOIN referidos r ON r.user_id = u.id
    LEFT JOIN publicaciones pub ON pub.cuenta_meli_id = mla.id
    LEFT JOIN ventas v ON v.cuenta_meli_id = mla.id
    LEFT JOIN pagos pg ON pg.user_id = u.id
    LEFT JOIN deuda d ON d.user_id = u.id
    LEFT JOIN tn ON tn.user_id = u.id
    LEFT JOIN tnc ON tnc.user_id = u.id
    WHERE {where_sql}
      AND COALESCE(u."isActive", TRUE) = TRUE
    ORDER BY (COALESCE(v.gmv, 0) + COALESCE(tn.tn_gmv, 0)) DESC NULLS LAST, u."createdAt" DESC
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
        "ventas_pagadas", "ordenes_totales",
        "ventas_pagadas_intent_ml", "ventas_pagadas_oml",
        "ultima_venta",
        "gmv", "costo_mercaderia", "profit_unidrop",
        "canceladas", "canceladas_staff", "sku_faltante",
        "pagos_procesados", "pago_unidrop_total", "pago_unidrop_meli", "ultimo_pago",
        "deuda_pendiente", "pagos_con_deuda",
        "tiene_meli", "tiene_tn",
        "tn_ordenes_totales", "tn_ventas_pagadas",
        "tn_ventas_pagadas_intent", "tn_ventas_pagadas_tno",
        "tn_gmv", "tn_ultima_venta",
        "tn_tiendas",
    ]

    universe = [dict(zip(keys, r)) for r in rows]

    # Derivar canal por dropshipper:
    #   ambos     - vende en MELI y TN
    #   meli      - solo MELI (todos los con suscripcion estan aqui)
    #   tn        - solo TN (sin suscripcion)
    #   sin_canal - alta sin operar en ningun canal
    for it in universe:
        m = bool(it.get("tiene_meli"))
        t = bool(it.get("tiene_tn"))
        if m and t:
            it["canal"] = "ambos"
        elif m:
            it["canal"] = "meli"
        elif t:
            it["canal"] = "tn"
        else:
            it["canal"] = "sin_canal"
        # GMV combinado para ranking en frontend
        it["gmv_total"] = float(it.get("gmv") or 0) + float(it.get("tn_gmv") or 0)

    # ============================================================
    # STATS GLOBALES sobre el UNIVERSO (plan + search ya aplicados)
    # NO se afectan por riesgo / actividad — esos son filtros de la
    # tabla, no del totalizador. Antes los KPIs y los chips caian a 0
    # cuando se filtraba "con deuda" porque se calculaban sobre la
    # lista filtrada.
    # ============================================================
    cutoff_30d = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)

    def _last_sale_dt(it):
        """Considera la mas reciente entre ultima venta MELI y ultima venta TN."""
        candidates = []
        for k in ("ultima_venta", "tn_ultima_venta"):
            v = it.get(k)
            if not v:
                continue
            try:
                d = dt.datetime.fromisoformat(v.replace(" ", "T"))
                if d.tzinfo is None:
                    d = d.replace(tzinfo=dt.timezone.utc)
                candidates.append(d)
            except Exception:
                pass
        return max(candidates) if candidates else None

    # Si se filtra por canal, lo aplicamos sobre el universo ANTES de calcular
    # stats (es una segmentacion, no un filtro de tabla como riesgo/actividad).
    if canal in ("meli", "tn", "ambos", "sin_canal"):
        universe = [it for it in universe if it.get("canal") == canal]

    universe_total = len(universe)
    sum_gmv = sum(float(it.get("gmv") or 0) for it in universe)  # GMV MELI
    sum_tn_gmv = sum(float(it.get("tn_gmv") or 0) for it in universe)  # GMV TN
    sum_gmv_total = sum_gmv + sum_tn_gmv
    sum_profit = sum(float(it.get("profit_unidrop") or 0) for it in universe)
    sum_pago = sum(float(it.get("pago_unidrop_total") or 0) for it in universe)
    sum_deuda = sum(float(it.get("deuda_pendiente") or 0) for it in universe)

    sin_publicar_u = sum(1 for it in universe if (it.get("pub_activas") or 0) == 0)
    # "sin vender" considera TODOS los canales: ni MELI ni TN
    sin_vender_u = sum(
        1 for it in universe
        if (it.get("ventas_pagadas") or 0) == 0 and (it.get("tn_ventas_pagadas") or 0) == 0
    )
    con_deuda_u = sum(1 for it in universe if (it.get("deuda_pendiente") or 0) > 0)
    token_expira_u = sum(1 for it in universe if it.get("requiere_reauth") is True)

    # Split por canal sobre el universo COMPLETO (sin importar el filtro canal,
    # asi el frontend siempre puede mostrar el segmentador con totales).
    by_channel = {"meli": 0, "tn": 0, "ambos": 0, "sin_canal": 0}
    by_channel_gmv = {"meli": 0.0, "tn": 0.0, "ambos": 0.0, "sin_canal": 0.0}
    for it in universe:
        c = it.get("canal", "sin_canal")
        by_channel[c] = by_channel.get(c, 0) + 1
        by_channel_gmv[c] = by_channel_gmv.get(c, 0.0) + float(it.get("gmv") or 0) + float(it.get("tn_gmv") or 0)

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
        # "sin vender" considera ambos canales
        items = [
            it for it in items
            if (it.get("ventas_pagadas") or 0) == 0 and (it.get("tn_ventas_pagadas") or 0) == 0
        ]
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
        # Stats globales del universo (plan + search + canal aplicados, NO riesgo/actividad)
        "stats": {
            "total": universe_total,
            "gmv": round(sum_gmv, 0),  # GMV MELI
            "tn_gmv": round(sum_tn_gmv, 0),  # GMV TN
            "gmv_total": round(sum_gmv_total, 0),  # MELI + TN
            "profit_unidrop": round(sum_profit, 0),
            "pago_unidrop": round(sum_pago, 0),
            "deuda_pendiente": round(sum_deuda, 0),
            "sin_publicar": sin_publicar_u,
            "sin_vender": sin_vender_u,
            "con_deuda": con_deuda_u,
            "token_expira": token_expira_u,
            "activos_30d": activos_30d,
            "inactivos": inactivos,
            # Distribucion por canal (cantidad y GMV combinado)
            "by_channel": {
                "meli": {"count": by_channel.get("meli", 0), "gmv": round(by_channel_gmv.get("meli", 0.0), 0)},
                "tn": {"count": by_channel.get("tn", 0), "gmv": round(by_channel_gmv.get("tn", 0.0), 0)},
                "ambos": {"count": by_channel.get("ambos", 0), "gmv": round(by_channel_gmv.get("ambos", 0.0), 0)},
                "sin_canal": {"count": by_channel.get("sin_canal", 0), "gmv": 0},
            },
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
            "canal": canal,
            "search": search or "",
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def dropshipper_detail(
    user_id: int,
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Vista 360 de un dropshipper Unidrop (no confundir con Customer Unistore TN).

    Devuelve KPIs + series mensuales + ultimas ventas MELI + ultimos pagos Talo.
    Todas las metricas vienen de la BD de Unidrop:
      - Ventas: mercado_libre_dev.OrderMercadoLibre (NO Tienda Nube)
      - Pagos: public.PaymentIntent + public.CustomerPaymentAccount
      - Plan: public.User + mercado_libre_dev.SubscriptionMeli
      - Cuenta MELI: mercado_libre_dev.MercadoLibreUserAccount

    period filtra los KPIs de ventas y pagos (la chart mensual siempre 12m).
    """
    eng = get_engine("unidrop")
    days = resolve_window(period, from_iso, to_iso)["days"]

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
            (SELECT COUNT(*) FROM public."User" u2 WHERE u2."referrerId" = u.id)::int AS cant_referidos,
            u.store_id::text AS store_id
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
        "store_id": h[24] or None,
    }

    # KPIs de ventas MELI - PaymentIntent es ground truth (lo que el dropshipper
    # efectivamente pago a Unidrop). Enriquecemos con OrderMercadoLibre si esta
    # disponible. Para Unidrop la linkage canonica entre dropshipper y order
    # es la columna `number` con formato DROP-{dni}-{seq}.
    drop_dni = (user.get("dni") or "").strip()
    drop_number_prefix = f"DROP-{drop_dni}-%" if drop_dni else None

    intent_ml = q(eng, """
        SELECT
          COALESCE(SUM(COALESCE(array_length(pi."mlOrderIds",1),0)),0)::int AS orders_count,
          COUNT(*) FILTER (WHERE COALESCE(array_length(pi."mlOrderIds",1),0) > 0)::int AS intents_count
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
          AND pi."status" = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
    """, {"uid": int(user_id), "d": int(days)}) or [(0, 0)]
    ml_orders_paid = int(intent_ml[0][0] or 0)
    ml_intents = int(intent_ml[0][1] or 0)

    # Detalle desde OrderMercadoLibre - linkage triple: por mlAccount.userId,
    # por sellerId, o por number prefix DROP-{dni}-. Asi capturamos a dropshippers
    # cuyas ventas no estan linkeadas via mla.userId pero si tienen number.
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
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
        LEFT JOIN (
            SELECT "orderId", SUM("totalAmount")::float AS gmv
            FROM mercado_libre_dev."PaymentMercadoLibre"
            GROUP BY 1
        ) p ON p."orderId" = o.id
        WHERE (
              mla."userId" = :uid
           OR (:dni IS NOT NULL AND o."number" LIKE :num_prefix)
        )
          AND o."dateCreated" >= NOW() - make_interval(days => :d)
    """, {"uid": int(user_id), "d": int(days), "dni": drop_dni or None, "num_prefix": drop_number_prefix or ""}) or [(0, 0, 0, None, None, 0, 0, 0, 0, 0)]
    v = ventas[0]
    # Usar ml_orders_paid (de PaymentIntent) como ventas_pagadas si la sincro
    # con OrderMercadoLibre quedo corta. Asi nunca mostramos "0 ventas" cuando
    # los pagos a Unidrop muestran ordenes ML claras.
    ventas_pagadas_intent = ml_orders_paid
    ventas_pagadas_omml = int(v[0] or 0)
    ventas_pagadas_final = max(ventas_pagadas_intent, ventas_pagadas_omml)

    ventas_kpi = {
        "ventas_pagadas": ventas_pagadas_final,
        "ventas_pagadas_intent": ventas_pagadas_intent,  # contado en PaymentIntent.mlOrderIds (ground truth de pago)
        "ventas_pagadas_oml": ventas_pagadas_omml,       # contado en OrderMercadoLibre (puede no estar synced)
        "ordenes_totales": max(int(v[1] or 0), ventas_pagadas_intent),
        "canceladas": int(v[2] or 0),
        "ultima_venta": v[3],
        "ultima_venta_number": None,  # se completa abajo
        "primera_venta": v[4],
        "gmv": float(v[5] or 0),
        "costo_mercaderia": float(v[6] or 0),
        "costo_envio": float(v[7] or 0),
        "profit_unidrop": float(v[8] or 0),
        "ticket_promedio": float(v[9] or 0),
        "tasa_cancelacion_pct": round(int(v[2] or 0) / max(int(v[1] or 1), 1) * 100, 1),
        "intents_ml_count": ml_intents,  # cuantos PaymentIntent cubren MELI
    }

    # Número DROP de la última orden pagada (para mostrar en KPI en lugar de "X atrás")
    _last_num_row = q(eng, """
        SELECT o."number", o."dateCreated"::text
        FROM mercado_libre_dev."OrderMercadoLibre" o
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
        WHERE (mla."userId" = :uid OR (:dni IS NOT NULL AND o."number" LIKE :num_prefix))
          AND o."status" = 'paid'
          AND o."number" IS NOT NULL AND o."number" != ''
        ORDER BY o."dateCreated" DESC NULLS LAST
        LIMIT 1
    """, {"uid": int(user_id), "dni": drop_dni or None, "num_prefix": drop_number_prefix or ""}) or []
    if _last_num_row and _last_num_row[0][0]:
        ventas_kpi["ultima_venta_number"] = _last_num_row[0][0]
        if not ventas_kpi.get("ultima_venta"):
            ventas_kpi["ultima_venta"] = _last_num_row[0][1]

    # KPIs de ventas TN: ground truth = PaymentIntent.orderIds, enrichment con tienda_nube_orders
    intent_tn = q(eng, """
        SELECT
          COALESCE(SUM(COALESCE(array_length(pi."orderIds",1),0)),0)::int AS orders_count,
          COUNT(*) FILTER (WHERE COALESCE(array_length(pi."orderIds",1),0) > 0)::int AS intents_count
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
          AND pi."status" = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
    """, {"uid": int(user_id), "d": int(days)}) or [(0, 0)]
    tn_orders_paid = int(intent_tn[0][0] or 0)

    # Linkage TN: user_id OR number prefix DROP-{dni}- (cualquiera funciona)
    tn_v = q(eng, """
        SELECT
            COUNT(*) FILTER (WHERE payment_status::text='paid')::int AS ventas_pagadas,
            COUNT(*)::int AS ordenes_totales,
            COALESCE(SUM(total) FILTER (WHERE payment_status::text='paid'),0)::float AS gmv,
            MAX(created_at) FILTER (WHERE payment_status::text='paid')::text AS ultima_venta,
            MIN(created_at) FILTER (WHERE payment_status::text='paid')::text AS primera_venta,
            COALESCE(AVG(total) FILTER (WHERE payment_status::text='paid'),0)::float AS ticket_promedio
        FROM public.tienda_nube_orders
        WHERE (
              user_id = :uid
           OR (:dni IS NOT NULL AND "number" LIKE :num_prefix)
        )
          AND created_at >= NOW() - make_interval(days => :d)
    """, {"uid": int(user_id), "d": int(days), "dni": drop_dni or None, "num_prefix": drop_number_prefix or ""}) or [(0, 0, 0, None, None, 0)]
    tnv = tn_v[0]
    tn_kpi = {
        "ventas_pagadas": max(int(tnv[0] or 0), tn_orders_paid),
        "ventas_pagadas_intent": tn_orders_paid,
        "ventas_pagadas_tno": int(tnv[0] or 0),
        "ordenes_totales": max(int(tnv[1] or 0), tn_orders_paid),
        "gmv": float(tnv[2] or 0),
        "ultima_venta": tnv[3],
        "primera_venta": tnv[4],
        "ticket_promedio": float(tnv[5] or 0),
    }

    # Tiendas TN conectadas (cruce por store_id, no por userId).
    tn_stores = q(eng, """
        SELECT COUNT(*)::int
        FROM public."User" u
        INNER JOIN public."TiendaNubeCredential" t ON t.store_id = u.store_id
        WHERE u.id = :uid AND u.store_id IS NOT NULL
    """, {"uid": int(user_id)}) or [(0,)]
    tn_kpi["tiendas_conectadas"] = int(tn_stores[0][0] or 0)

    # TiendaNubeCredential — detalles de la tienda (store_id, status, URL si existe)
    tiendas_tn_detail: list[dict] = []
    store_id = user.get("store_id")
    if store_id:
        tnc_cols = list_columns(eng, "public", "TiendaNubeCredential")
        tnc_select = ["store_id::text"]
        tnc_extra: list[str] = []
        for col, cast in [
            ("status", "::text"),
            ("created_at", "::text"),
            ("user_id", "::text"),
            ("store_name", ""),
            ("store_url", ""),
            ("app_id", "::text"),
            ("updated_at", "::text"),
        ]:
            if col in tnc_cols:
                tnc_select.append(f"COALESCE({col}{cast}, '') AS {col}")
                tnc_extra.append(col)
        tnc_rows = q(eng, f"""
            SELECT {", ".join(tnc_select)}
            FROM public."TiendaNubeCredential"
            WHERE store_id = :sid
            LIMIT 10
        """, {"sid": store_id}) or []
        for r in tnc_rows:
            d: dict = {"store_id": r[0]}
            for i, col in enumerate(tnc_extra, 1):
                d[col] = r[i] if r[i] else None
            tiendas_tn_detail.append(d)

    # CustomerPaymentAccount (Talo) — cuenta(s) registrada(s) para este dropshipper
    cpa_cols = list_columns(eng, "public", "CustomerPaymentAccount")
    cpa_select = ['id::text', '"createdAt"::text']
    cpa_extra: list[str] = []
    for col, cast in [
        ("cbu", ""),
        ("cbu_alias", ""),
        ("alias", ""),
        ("bank_name", ""),
        ("account_owner", ""),
        ("status", "::text"),
    ]:
        if col in cpa_cols:
            cpa_select.append(f"COALESCE({col}{cast}, '') AS {col}")
            cpa_extra.append(col)
    talo_accounts_rows = q(eng, f"""
        SELECT {", ".join(cpa_select)}
        FROM public."CustomerPaymentAccount"
        WHERE "userId" = :uid
        ORDER BY id
        LIMIT 5
    """, {"uid": int(user_id)}) or []
    talo_accounts: list[dict] = []
    for r in talo_accounts_rows:
        acc: dict = {"id": int(r[0]) if r[0] else None, "creado_en": r[1]}
        for i, col in enumerate(cpa_extra, 2):
            acc[col] = r[i] if r[i] else None
        talo_accounts.append(acc)

    # Referidos: usuarios que este dropshipper refirio (con link a sus perfiles)
    referidos_list: list[dict] = []
    if int(user.get("cant_referidos") or 0) > 0:
        ref_rows = q(eng, """
            SELECT u2.id::int,
                   COALESCE(NULLIF(u2.fantasy_name,''), u2.name, u2.email, '') AS nombre,
                   u2.email,
                   u2."createdAt"::text,
                   sm2.name AS plan,
                   u2.subscription_status::text,
                   EXTRACT(DAY FROM (u2.end_date_subscription - NOW()))::int AS dias_vence
            FROM public."User" u2
            LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm2 ON sm2.id = u2."subscriptionId"
            WHERE u2."referrerId" = :uid
            ORDER BY u2."createdAt" DESC
            LIMIT 50
        """, {"uid": int(user_id)}) or []
        referidos_list = [{
            "user_id": int(r[0]) if r[0] else None,
            "nombre": r[1] or "",
            "email": r[2] or "",
            "creado_en": r[3],
            "plan": r[4] or "",
            "sub_status": r[5] or "",
            "dias_al_vencimiento": int(r[6]) if r[6] is not None else None,
        } for r in ref_rows]

    # Derivar canal del dropshipper
    has_meli = bool(user.get("cuenta_meli_id")) or ventas_kpi["ventas_pagadas"] > 0
    has_tn = tn_kpi["tiendas_conectadas"] > 0 or tn_kpi["ventas_pagadas"] > 0
    if has_meli and has_tn:
        user["canal"] = "ambos"
    elif has_meli:
        user["canal"] = "meli"
    elif has_tn:
        user["canal"] = "tn"
    else:
        user["canal"] = "sin_canal"

    # KPIs de pagos Talo (PaymentIntent / CustomerPaymentAccount)
    # Total/deuda no se filtran por periodo (son estado actual).
    # pagado_total_period y splits TN/ML SI se filtran por periodo.
    pagos = q(eng, """
        SELECT
            COUNT(*)::int AS total_intents,
            COUNT(*) FILTER (WHERE pi."status"='PROCESSED')::int AS procesados,
            COALESCE(SUM(pi."paidAmount") FILTER (WHERE pi."status"='PROCESSED'),0)::float AS pagado_total,
            COALESCE(SUM(pi."pendingAmount") FILTER (WHERE pi."status"<>'PROCESSED'),0)::float AS deuda_pendiente,
            COUNT(*) FILTER (WHERE pi."status"<>'PROCESSED' AND COALESCE(pi."pendingAmount",0) > 0)::int AS pagos_con_deuda,
            MAX(pi."createdAt") FILTER (WHERE pi."status"='PROCESSED')::text AS ultimo_pago,
            -- Splits por origen (period filtered, status=PROCESSED)
            COALESCE(SUM(pi."paidAmount") FILTER (
                WHERE pi."status"='PROCESSED'
                  AND pi."createdAt" >= NOW() - make_interval(days => :d)
                  AND COALESCE(array_length(pi."orderIds",1),0) > 0
            ),0)::float AS pagado_tn_period,
            COALESCE(SUM(pi."paidAmount") FILTER (
                WHERE pi."status"='PROCESSED'
                  AND pi."createdAt" >= NOW() - make_interval(days => :d)
                  AND COALESCE(array_length(pi."mlOrderIds",1),0) > 0
            ),0)::float AS pagado_ml_period,
            COALESCE(SUM(pi."paidAmount") FILTER (
                WHERE pi."status"='PROCESSED'
                  AND pi."createdAt" >= NOW() - make_interval(days => :d)
            ),0)::float AS pagado_total_period,
            COUNT(*) FILTER (
                WHERE pi."status"='PROCESSED'
                  AND pi."createdAt" >= NOW() - make_interval(days => :d)
                  AND COALESCE(array_length(pi."orderIds",1),0) > 0
            )::int AS pagos_tn_period_count,
            COUNT(*) FILTER (
                WHERE pi."status"='PROCESSED'
                  AND pi."createdAt" >= NOW() - make_interval(days => :d)
                  AND COALESCE(array_length(pi."mlOrderIds",1),0) > 0
            )::int AS pagos_ml_period_count
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
    """, {"uid": int(user_id), "d": int(days)}) or [(0, 0, 0, 0, 0, None, 0, 0, 0, 0, 0)]
    pg = pagos[0]
    pagos_kpi = {
        "total_intents": int(pg[0] or 0),
        "procesados": int(pg[1] or 0),
        "pagado_total": float(pg[2] or 0),
        "deuda_pendiente": float(pg[3] or 0),
        "pagos_con_deuda": int(pg[4] or 0),
        "ultimo_pago": pg[5],
        # Nuevo: ventas pagadas a Unidrop dentro del periodo, desglosadas por origen.
        "pagado_tn_period": float(pg[6] or 0),
        "pagado_ml_period": float(pg[7] or 0),
        "pagado_total_period": float(pg[8] or 0),
        "pagos_tn_period_count": int(pg[9] or 0),
        "pagos_ml_period_count": int(pg[10] or 0),
    }

    # Ticket promedio que el dropshipper paga a Unidrop (ground truth PaymentIntent).
    # Distinto del ticket_promedio de OML que es el precio al cliente final.
    ventas_kpi["ticket_promedio_intent"] = (
        round(pagos_kpi["pagado_ml_period"] / ml_orders_paid, 2)
        if ml_orders_paid > 0 else 0.0
    )

    # Fallback ultima_venta: OML no tiene el order → usar fecha del PaymentIntent.
    if not ventas_kpi.get("ultima_venta") and ml_orders_paid > 0:
        _pi_last = q(eng, """
            SELECT MAX(pi."createdAt")::text
            FROM public."PaymentIntent" pi
            INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
            WHERE cpa."userId" = :uid AND pi."status" = 'PROCESSED'
              AND COALESCE(array_length(pi."mlOrderIds",1),0) > 0
        """, {"uid": int(user_id)}) or [(None,)]
        ventas_kpi["ultima_venta"] = _pi_last[0][0]

    # PaymentIntentSubscription — historial COMPLETO (no filtrado por periodo).
    # Esta tabla tiene userId directo y es el ground truth de pagos de suscripcion.
    # Distinta de PaymentTransactionSubscription (que es el cobro via Talo).
    pis_cols = list_columns(eng, "public", "PaymentIntentSubscription")
    pis_amount_col = '"paidAmount"' if "paidAmount" in pis_cols else ('"amount"' if "amount" in pis_cols else "0")
    pis_expected_col = '"expectedAmount"' if "expectedAmount" in pis_cols else "0"
    sub_intent_rows = q(eng, f"""
        SELECT pis.id::int,
               pis.status::text,
               pis."createdAt"::text,
               COALESCE({pis_amount_col}, 0)::float AS paid,
               COALESCE({pis_expected_col}, 0)::float AS expected,
               sm.name AS plan_nombre
        FROM public."PaymentIntentSubscription" pis
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm
              ON sm.id = pis."subscriptionMeliId"
        WHERE pis."userId" = :uid
        ORDER BY pis."createdAt" DESC NULLS LAST
        LIMIT 36
    """, {"uid": int(user_id)}) or []
    subscription_intents = [{
        "id": int(r[0]) if r[0] else None,
        "status": r[1] or "",
        "fecha": r[2],
        "pagado": round(float(r[3] or 0), 2),
        "esperado": round(float(r[4] or 0), 2),
        "plan": r[5] or user.get("plan") or "",
    } for r in sub_intent_rows]
    sub_procesadas = [s for s in subscription_intents if s["status"].upper() == "PROCESSED"]
    sub_pendientes = [s for s in subscription_intents if s["status"].upper() == "PENDING"]
    sub_ltv = {
        "total_pagado": round(sum(s["pagado"] for s in sub_procesadas), 2),
        "cant_procesadas": len(sub_procesadas),
        "ultimo_pago": sub_procesadas[0]["fecha"] if sub_procesadas else None,
        "cant_pendientes": len(sub_pendientes),
        "monto_pendiente": round(sum(s["esperado"] for s in sub_pendientes), 2),
    }

    # Suscripciones pagadas en el periodo (PaymentTransactionSubscription) — para
    # el breakdown por periodo en el bloque "Ventas pagadas a Unidrop".
    subs_rows = q(eng, """
        SELECT pts.id,
               pts."taloTransactionId",
               pts.amount::float,
               pts.currency,
               pts."transactionTimestamp"::text
        FROM public."PaymentTransactionSubscription" pts
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pts."customerAccountId"
        WHERE cpa."userId" = :uid
          AND pts."transactionTimestamp" >= NOW() - make_interval(days => :d)
        ORDER BY pts."transactionTimestamp" DESC NULLS LAST
        LIMIT 50
    """, {"uid": int(user_id), "d": int(days)}) or []
    suscripciones_pagadas = [{
        "id": int(r[0]) if r[0] else None,
        "talo_transaction_id": r[1] or "",
        "amount": round(float(r[2] or 0), 2),
        "currency": r[3] or "ARS",
        "fecha": r[4],
        "plan": user.get("plan") or "",
    } for r in subs_rows]
    suscripciones_total = round(sum(s["amount"] for s in suscripciones_pagadas), 2)

    # Publicaciones
    pub = q(eng, """
        SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pum."status" = 'active')::int AS activas,
            MAX(pum."createdAt")::text AS ultima
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
        INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
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
        "ordenes_tn": 0,
        "gmv_tn": 0.0,
    } for r in monthly]

    # Serie mensual TN (12m) — linkage por user_id o number prefix
    monthly_tn = q(eng, """
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
               COUNT(*) FILTER (WHERE payment_status::text='paid')::int AS ordenes,
               COALESCE(SUM(total) FILTER (WHERE payment_status::text='paid'), 0)::float AS gmv
        FROM public.tienda_nube_orders
        WHERE (user_id = :uid OR (:dni IS NOT NULL AND "number" LIKE :num_prefix))
          AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1
    """, {"uid": int(user_id), "dni": drop_dni or None, "num_prefix": drop_number_prefix or ""}) or []
    tn_monthly_map: dict[str, dict] = {r[0]: {"ordenes_tn": int(r[1] or 0), "gmv_tn": float(r[2] or 0)} for r in monthly_tn}
    # Merge TN into MELI series
    meli_meses = {m["mes"] for m in monthly_series}
    for m in monthly_series:
        tn_data = tn_monthly_map.get(m["mes"], {})
        m["ordenes_tn"] = tn_data.get("ordenes_tn", 0)
        m["gmv_tn"] = round(tn_data.get("gmv_tn", 0.0), 2)
    # Add TN-only months (no MELI activity that month)
    for mes, tn_data in tn_monthly_map.items():
        if mes not in meli_meses:
            monthly_series.append({
                "mes": mes, "ordenes": 0, "gmv": 0.0, "profit": 0.0,
                "ordenes_tn": tn_data["ordenes_tn"], "gmv_tn": round(tn_data["gmv_tn"], 2),
            })
    monthly_series.sort(key=lambda x: x["mes"])

    # Ultimas ventas MELI: ground truth = mlOrderIds desnormalizados de PaymentIntents
    # PROCESSED del dropshipper. Para cada ML order ID, buscamos enriquecimiento en
    # OrderMercadoLibre por su mlOrderId. Si no existe, devolvemos al menos el ID +
    # fecha del intent (asi nunca decimos 'Sin ventas registradas' cuando hay pagos).
    last_orders_intent = q(eng, """
        SELECT unnest(pi."mlOrderIds")::text AS ml_order_id,
               pi."createdAt"::text AS fecha_intent,
               pi.id AS intent_id
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
          AND pi."status" = 'PROCESSED'
          AND COALESCE(array_length(pi."mlOrderIds",1),0) > 0
        ORDER BY pi."createdAt" DESC NULLS LAST
        LIMIT 50
    """, {"uid": int(user_id)}) or []

    ml_ids_list = list({r[0] for r in last_orders_intent if r[0]})
    enrich: dict[str, dict] = {}
    if ml_ids_list:
        # IDs vienen de PaymentIntent.mlOrderIds (TEXT[] en DB). Los inlineamos
        # como array literal para evitar el conflicto :param::text[] con
        # SQLAlchemy/text() (los : del cast rompen el parser de bindparams).
        # Sanitizamos: solo dejamos strings con digitos/guiones (formato ML ID).
        import re as _re
        safe_ids = [str(s) for s in ml_ids_list if _re.match(r"^[A-Za-z0-9_-]+$", str(s))]
        if safe_ids:
            ids_literal = "ARRAY[" + ",".join("'" + i + "'" for i in safe_ids) + "]::text[]"
            # BUGFIX: matcheamos contra AMBAS columnas (id interno + mlOrderId
            # externo). Esto cubre los dos casos posibles de como Unidrop guarda
            # los IDs en PaymentIntent.mlOrderIds[] (algunas integrations guardan
            # el id interno, otras el externo). Indexamos por el campo que matcheo
            # (preservamos el key original del intent) para que orders.append lo
            # encuentre.
            try:
                erows = q(eng, f"""
                    SELECT o."mlOrderId"::text AS ml_order_id_ext,
                           o.id::text         AS internal_id_str,
                           o.id               AS order_id,
                           o."status",
                           o."dateCreated"::text AS fecha,
                           COALESCE(p.gmv,0)::float AS total,
                           COALESCE(o."profit_for_subscription",0)::float AS profit_unidrop,
                           COALESCE(o."shipping_cost",0)::float AS shipping_cost,
                           o."number" AS number
                    FROM mercado_libre_dev."OrderMercadoLibre" o
                    LEFT JOIN (
                        SELECT "orderId", SUM("totalAmount")::float AS gmv
                        FROM mercado_libre_dev."PaymentMercadoLibre"
                        GROUP BY 1
                    ) p ON p."orderId" = o.id
                    WHERE o."mlOrderId"::text = ANY({ids_literal})
                       OR o.id::text          = ANY({ids_literal})
                """) or []
                for er in erows:
                    info = {
                        "id": int(er[2]) if er[2] else None,
                        "status": er[3] or "",
                        "fecha": er[4],
                        "total": float(er[5] or 0),
                        "profit_unidrop": float(er[6] or 0),
                        "shipping_cost": float(er[7] or 0),
                        "number": er[8] or "",
                    }
                    # Indexamos por AMBAS keys posibles - asi orders.append matchea
                    # con el ml_id del intent sin importar como esta guardado
                    if er[0]:
                        enrich[er[0]] = info
                    if er[1]:
                        enrich[er[1]] = info
                log.info(
                    "dropshipper %s ml enrich: %d intents ids, %d matched (rows=%d)",
                    user_id, len(safe_ids), len(enrich), len(erows),
                )
            except Exception as e:
                log.warning("dropshipper enrich ml orders fail: %s", e)

    orders: list[dict] = []
    for r in last_orders_intent:
        ml_id = r[0]
        intent_fecha = r[1]
        info = enrich.get(ml_id, {})
        orders.append({
            "id": info.get("id"),
            "ml_order_id": ml_id,
            "number": info.get("number") or "",
            "status": info.get("status") or "paid (via Talo)",
            "fecha": info.get("fecha") or intent_fecha,
            "total": round(float(info.get("total") or 0), 2),
            "profit_unidrop": round(float(info.get("profit_unidrop") or 0), 2),
            "shipping_cost": round(float(info.get("shipping_cost") or 0), 2),
            "synced_in_oml": ml_id in enrich,
        })

    # Ultimas ventas TN (tienda_nube_orders) - linkage por user_id o number prefix.
    # Esta seccion antes no existia en el detail: solo veiamos KPIs agregados.
    last_tn_orders = q(eng, """
        SELECT tno.tienda_nube_id, tno."number", tno.created_at::text AS fecha,
               tno.payment_status::text AS status,
               COALESCE(tno.total, 0)::float AS total
        FROM public.tienda_nube_orders tno
        WHERE (
              tno.user_id = :uid
           OR (:dni IS NOT NULL AND tno."number" LIKE :num_prefix)
        )
        ORDER BY tno.created_at DESC NULLS LAST
        LIMIT 50
    """, {"uid": int(user_id), "dni": drop_dni or None, "num_prefix": drop_number_prefix or ""}) or []
    tn_orders_list = [{
        "id": int(r[0]) if r[0] else None,
        "number": r[1] or "",
        "fecha": r[2],
        "status": r[3] or "",
        "total": round(float(r[4] or 0), 2),
    } for r in last_tn_orders]

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

    # Top clientes finales (compradores TN del dropshipper) - drill a End Consumer 360
    try:
        from app.services import end_consumers_unidrop as ec_unidrop
        top_clientes_finales = ec_unidrop.top_end_consumers_for_dropshipper(
            int(user_id), period_days=int(days), limit=20,
        )
    except Exception:
        top_clientes_finales = []

    # Vista unificada estilo Unidrop panel (filas ML + TN combinadas por fecha)
    try:
        unified_orders = dropshipper_unified_orders(int(user_id), limit=50, dni=drop_dni or None)
    except Exception as e:
        log.warning("dropshipper unified_orders fail uid=%s: %s", user_id, e)
        unified_orders = []

    return {
        "user": user,
        "ventas": ventas_kpi,  # MELI
        "ventas_tn": tn_kpi,   # Tienda Nube (cliente final)
        "pagos": pagos_kpi,
        "publicaciones": pubs,
        "monthly": monthly_series,
        "ultimas_ventas": orders,
        "ultimas_ventas_tn": tn_orders_list,
        "ultimos_pagos": pagos_list,
        "unified_orders": unified_orders,
        "top_clientes_finales": top_clientes_finales,
        "suscripciones": {
            "total_pagado": suscripciones_total,
            "cantidad": len(suscripciones_pagadas),
            "items": suscripciones_pagadas,
        },
        # Datos adicionales de unidrop_api
        "tiendas_tn_detail": tiendas_tn_detail,       # campos de TiendaNubeCredential
        "talo_accounts": talo_accounts,               # CustomerPaymentAccount (CBU, alias)
        "referidos_list": referidos_list,             # usuarios referidos por este dropshipper
        "subscription_intents": subscription_intents, # PaymentIntentSubscription all-time (historial suscripcion)
        "sub_ltv": sub_ltv,                           # resumen LTV suscripcion
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def dropshipper_unified_orders(
    user_id: int,
    *,
    limit: int = 50,
    intent_id: int | None = None,
    dni: str | None = None,
) -> list[dict]:
    """Vista unificada estilo Unidrop panel: filas ML + TN combinadas por fecha.

    Cada fila representa UNA orden (ML o TN) que fue cobrada via PaymentIntent.
    Si `intent_id` es no-null, devuelve solo las ordenes de ese intent (para el
    click-to-filter del frontend).

    Schema fuentes:
    - mercado_libre_dev."OrderMercadoLibre" — ordenes ML (id, mlOrderId, number)
    - public.tienda_nube_orders             — ordenes TN (tienda_nube_id, number)
    - public."PaymentIntent"                — linkage (mlOrderIds[], orderIds[])
    - public."CustomerPaymentAccount"       — mapeo intent -> user

    Considera que IDs en PaymentIntent.mlOrderIds[]/orderIds[] pueden ser tanto
    internos como externos segun la integration: matcheamos por ambos.
    """
    eng = get_engine("unidrop")

    # Auto-resolve DNI si no se paso (para la ruta /unified-orders que no lo tiene)
    if not dni:
        _dni_rows = q(eng, 'SELECT u.dni FROM public."User" u WHERE u.id = :uid LIMIT 1', {"uid": int(user_id)}) or []
        if _dni_rows and _dni_rows[0][0]:
            dni = str(_dni_rows[0][0]).strip() or None

    # 1) Bajamos los intents PROCESSED del user + sus arrays de IDs
    intent_filter = "AND pi.id = :intent_id" if intent_id else ""
    # PaymentIntent.mlOrderIds y .orderIds son bigint[]. Los expandimos via
    # subselect para devolverlos como text[] de forma segura sin pelearnos con
    # COALESCE cross-type.
    intents = q(eng, f"""
        SELECT pi.id,
               pi."createdAt"::text,
               (SELECT COALESCE(array_agg(x::text), ARRAY[]::text[])
                  FROM unnest(COALESCE(pi."mlOrderIds", ARRAY[]::bigint[])) AS x) AS ml_ids,
               (SELECT COALESCE(array_agg(x::text), ARRAY[]::text[])
                  FROM unnest(COALESCE(pi."orderIds",   ARRAY[]::bigint[])) AS x) AS tn_ids,
               COALESCE(pi."paidAmount",0)::float AS paid
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        WHERE cpa."userId" = :uid
          AND pi."status" = 'PROCESSED'
          {intent_filter}
        ORDER BY pi."createdAt" DESC NULLS LAST
        LIMIT 200
    """, {"uid": int(user_id), "intent_id": intent_id}) or []

    if not intents:
        return []

    # Indices para matchear despues
    ml_id_to_intent: dict[str, int] = {}
    tn_id_to_intent: dict[str, int] = {}
    all_ml_ids: set[str] = set()
    all_tn_ids: set[str] = set()
    intent_meta: dict[int, dict] = {}
    for it in intents:
        iid = int(it[0])
        intent_meta[iid] = {"id": iid, "fecha": it[1], "paid": float(it[4] or 0)}
        for x in (it[2] or []):
            if x is None: continue
            s = str(x)
            all_ml_ids.add(s)
            ml_id_to_intent.setdefault(s, iid)
        for x in (it[3] or []):
            if x is None: continue
            s = str(x)
            all_tn_ids.add(s)
            tn_id_to_intent.setdefault(s, iid)

    import re as _re
    safe_ml = [s for s in all_ml_ids if _re.match(r"^[A-Za-z0-9_-]+$", s)]
    safe_tn = [s for s in all_tn_ids if _re.match(r"^[A-Za-z0-9_-]+$", s)]

    ml_rows: list[dict] = []
    tn_rows: list[dict] = []
    enriched_ml_ids: set[str] = set()

    # 2) Enrich ML — probamos multiples schemas posibles. Si todos fallan,
    # quedan filas "stub" (fallback) para que la UI siempre muestre algo.
    if safe_ml:
        ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in safe_ml) + "]::text[]"
        SCHEMA_CANDIDATES = ['mercado_libre_dev', 'public', 'mercado_libre', 'meli']
        erows: list = []
        last_err = ""
        for sch in SCHEMA_CANDIDATES:
            try:
                erows = q(eng, f"""
                    SELECT o."mlOrderId"::text AS ext_id,
                           o.id::text         AS internal_id,
                           o.id               AS id_num,
                           o."number",
                           o."dateCreated"::text AS fecha,
                           o."status",
                           o."paymentStatus",
                           o."shippingStatus",
                           COALESCE(p.gmv,0)::float AS total,
                           COALESCE(o."merchandise_cost",0)::float AS merch_cost,
                           COALESCE(o."shipping_cost",0)::float AS shipping_cost,
                           COALESCE(o."profit_for_subscription",0)::float AS profit_unidrop,
                           o."buyer_name",
                           o."shipping_type"
                    FROM {sch}."OrderMercadoLibre" o
                    LEFT JOIN (
                        SELECT "orderId", SUM("totalAmount")::float AS gmv
                        FROM {sch}."PaymentMercadoLibre"
                        GROUP BY 1
                    ) p ON p."orderId" = o.id
                    WHERE o."mlOrderId"::text = ANY({ids_lit})
                       OR o.id::text          = ANY({ids_lit})
                       OR regexp_replace(o."mlOrderId"::text, '^ML[-_]?', '') = ANY({ids_lit})
                """) or []
                if erows:
                    log.info("unified_orders ML enrich uid=%s OK schema=%s rows=%d",
                             user_id, sch, len(erows))
                    break
            except Exception as e:
                last_err = str(e)[:120]
                continue
        if not erows and last_err:
            log.warning("unified_orders ML enrich todos schemas fallan uid=%s: %s", user_id, last_err)

        for er in erows:
            key_intent = ml_id_to_intent.get(er[0]) or ml_id_to_intent.get(er[1])
            if er[0]: enriched_ml_ids.add(er[0])
            if er[1]: enriched_ml_ids.add(er[1])
            ml_rows.append({
                "origen": "ml",
                "internal_id": int(er[2]) if er[2] else None,
                "external_id": er[0] or "",
                "number": er[3] or "",
                "fecha": er[4],
                "status": er[5] or "",
                "payment_status": er[6] or "",
                "shipping_status": er[7] or "",
                "total": round(float(er[8] or 0), 2),
                "merch_cost": round(float(er[9] or 0), 2),
                "shipping_cost": round(float(er[10] or 0), 2),
                "profit_unidrop": round(float(er[11] or 0), 2),
                "buyer_name": er[12] or "",
                "shipping_type": er[13] or "",
                "intent_id": key_intent,
                "enriched": True,
                "items": [],
                "shipment": None,
            })

        # Fallback: para ML ids que NO matchearon en ningun schema, generamos
        # una fila stub con el paid_amount del intent. Esto evita que el row se
        # pierda con $0 cuando OrderMercadoLibre no tiene el registro
        # (ej: orden muy nueva o schema fuera de sync).
        for mlid in safe_ml:
            if mlid in enriched_ml_ids: continue
            intent_id_for = ml_id_to_intent.get(mlid)
            meta = intent_meta.get(intent_id_for, {}) if intent_id_for else {}
            ml_rows.append({
                "origen": "ml",
                "internal_id": None,
                "external_id": mlid,
                "number": "",
                "fecha": meta.get("fecha") or "",
                "status": "paid (via Talo)",
                "payment_status": "paid",
                "shipping_status": "",
                "total": round(float(meta.get("paid") or 0), 2),
                "merch_cost": 0.0,
                "shipping_cost": 0.0,
                "profit_unidrop": 0.0,
                "buyer_name": "",
                "shipping_type": "",
                "intent_id": intent_id_for,
                "enriched": False,
                "items": [],
                "shipment": None,
            })

    # 2b) Supplemental: fetch OML por numero DROP-{dni}-* para recuperar "sin number".
    # El PaymentIntent.mlOrderIds[] a veces guarda IDs que no matchean el mlOrderId en
    # OML, generando stub rows sin numero. Consultando OML por prefix de numero podemos
    # actualizar esos stubs Y agregar ordenes que no estaban en ningun PaymentIntent.
    if dni and not intent_id:
        _num_pfx = f"DROP-{dni}-%"
        try:
            sup_erows = q(eng, """
                SELECT o."mlOrderId"::text AS ext_id,
                       o.id::text         AS internal_id,
                       o.id               AS id_num,
                       o."number",
                       o."dateCreated"::text AS fecha,
                       o."status",
                       o."paymentStatus",
                       o."shippingStatus",
                       COALESCE(p.gmv,0)::float AS total,
                       COALESCE(o."merchandise_cost",0)::float AS merch_cost,
                       COALESCE(o."shipping_cost",0)::float AS shipping_cost,
                       COALESCE(o."profit_for_subscription",0)::float AS profit_unidrop,
                       o."buyer_name",
                       o."shipping_type"
                FROM mercado_libre_dev."OrderMercadoLibre" o
                LEFT JOIN (
                    SELECT "orderId", SUM("totalAmount")::float AS gmv
                    FROM mercado_libre_dev."PaymentMercadoLibre"
                    GROUP BY 1
                ) p ON p."orderId" = o.id
                WHERE o."number" LIKE :num_pfx
                ORDER BY o."dateCreated" DESC NULLS LAST
                LIMIT 200
            """, {"num_pfx": _num_pfx}) or []

            if sup_erows:
                existing_by_ext = {r["external_id"]: i for i, r in enumerate(ml_rows) if r.get("external_id")}
                existing_by_int = {str(r["internal_id"]): i for i, r in enumerate(ml_rows) if r.get("internal_id")}
                existing_numbers: set[str] = {r["number"] for r in ml_rows if r.get("number")}

                for er in sup_erows:
                    num   = er[3] or ""
                    ext_id = er[0] or ""
                    int_id = er[1] or ""

                    # Buscar si ya tenemos esta orden (stub o enriched)
                    idx = existing_by_ext.get(ext_id) if ext_id else None
                    if idx is None and int_id:
                        idx = existing_by_int.get(int_id)

                    if idx is not None:
                        # Actualizar stub con datos reales
                        r = ml_rows[idx]
                        if not r.get("number") and num:
                            r["number"] = num
                        if not r.get("internal_id") and int_id:
                            r["internal_id"] = int(er[2]) if er[2] else None
                        r["status"] = er[5] or r["status"]
                        r["payment_status"] = er[6] or r["payment_status"]
                        r["shipping_status"] = er[7] or r["shipping_status"]
                        if float(er[8] or 0) > 0 and r.get("total", 0) == 0:
                            r["total"] = round(float(er[8]), 2)
                        r["merch_cost"] = round(float(er[9] or 0), 2)
                        r["shipping_cost"] = round(float(er[10] or 0), 2)
                        r["profit_unidrop"] = round(float(er[11] or 0), 2)
                        if er[12] and not r.get("buyer_name"):
                            r["buyer_name"] = er[12]
                        r["enriched"] = True
                    elif num and num not in existing_numbers:
                        # Orden no encontrada via PaymentIntent — agregar directamente
                        ml_rows.append({
                            "origen": "ml",
                            "internal_id": int(er[2]) if er[2] else None,
                            "external_id": ext_id,
                            "number": num,
                            "fecha": er[4],
                            "status": er[5] or "",
                            "payment_status": er[6] or "",
                            "shipping_status": er[7] or "",
                            "total": round(float(er[8] or 0), 2),
                            "merch_cost": round(float(er[9] or 0), 2),
                            "shipping_cost": round(float(er[10] or 0), 2),
                            "profit_unidrop": round(float(er[11] or 0), 2),
                            "buyer_name": er[12] or "",
                            "shipping_type": er[13] or "",
                            "intent_id": None,
                            "enriched": True,
                            "items": [],
                            "shipment": None,
                        })
                        existing_numbers.add(num)
                log.info(
                    "unified_orders sup ML uid=%s sup_rows=%d ml_total=%d",
                    user_id, len(sup_erows), len(ml_rows),
                )
        except Exception as _sup_err:
            log.warning("unified_orders supplemental ML fail uid=%s: %s", user_id, str(_sup_err)[:200])

    # 2c) Enrich via _OrderMercadoLibreToPaymentIntent (join table Prisma)
    # Mas confiable que comparar mlOrderId strings: FK directa intent.id -> oml.id.
    # Cubre stubs donde el mlOrderId en PI no matcheo con OML por formato distinto.
    _all_intent_ids = list(intent_meta.keys()) if intent_meta else []
    if _all_intent_ids:
        _ji_lit = ",".join(str(i) for i in _all_intent_ids)
        try:
            _jt_cols = list_columns(eng, "public", "_OrderMercadoLibreToPaymentIntent")
            _jt_a = next((c for c in ["A", "a", "order_id", "oml_id"] if c in _jt_cols), None)
            _jt_b = next((c for c in ["B", "b", "intent_id", "payment_intent_id"] if c in _jt_cols), None)
            log.info("ML join-table cols=%s A=%s B=%s", _jt_cols, _jt_a, _jt_b)
            if _jt_a and _jt_b:
                _jt_rows = q(eng, f"""
                    SELECT jt."{_jt_b}"::int AS intent_id,
                           o.id::text AS internal_id,
                           o."mlOrderId"::text AS ext_id,
                           o."number",
                           o."buyer_name",
                           o."dateCreated"::text AS fecha,
                           o."status",
                           o."paymentStatus",
                           o."shippingStatus",
                           COALESCE(o."merchandise_cost",0)::float AS merch_cost,
                           COALESCE(o."shipping_cost",0)::float AS shipping_cost,
                           COALESCE(o."profit_for_subscription",0)::float AS profit,
                           COALESCE(p.gmv,0)::float AS total,
                           o."shipping_type"
                    FROM public."_OrderMercadoLibreToPaymentIntent" jt
                    JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = jt."{_jt_a}"
                    LEFT JOIN (
                        SELECT "orderId", SUM("totalAmount")::float AS gmv
                        FROM mercado_libre_dev."PaymentMercadoLibre"
                        GROUP BY 1
                    ) p ON p."orderId" = o.id
                    WHERE jt."{_jt_b}"::int IN ({_ji_lit})
                """) or []
                if _jt_rows:
                    _ex2 = {r["external_id"]: i for i, r in enumerate(ml_rows) if r.get("external_id")}
                    _in2 = {str(r["internal_id"]): i for i, r in enumerate(ml_rows) if r.get("internal_id")}
                    for jr in _jt_rows:
                        iid = int(jr[0]) if jr[0] else None
                        int_id = jr[1] or ""; ext_id = jr[2] or ""; num = jr[3] or ""; buyer = jr[4] or ""
                        idx = _in2.get(int_id)
                        if idx is None and ext_id: idx = _ex2.get(ext_id)
                        if idx is not None:
                            r = ml_rows[idx]
                            if int_id and not r.get("internal_id"):
                                r["internal_id"] = int(int_id) if int_id.isdigit() else None
                                if int_id not in _in2: _in2[int_id] = idx
                            if num and not r.get("number"):   r["number"] = num
                            if buyer and not r.get("buyer_name"): r["buyer_name"] = buyer
                            r["status"] = jr[6] or r.get("status", "")
                            r["payment_status"] = jr[7] or r.get("payment_status", "")
                            r["shipping_status"] = jr[8] or r.get("shipping_status", "")
                            if float(jr[9] or 0) > 0 and not r.get("merch_cost"):
                                r["merch_cost"] = round(float(jr[9]), 2)
                            if float(jr[10] or 0) > 0 and not r.get("shipping_cost"):
                                r["shipping_cost"] = round(float(jr[10]), 2)
                            if float(jr[11] or 0) > 0 and not r.get("profit_unidrop"):
                                r["profit_unidrop"] = round(float(jr[11]), 2)
                            if float(jr[12] or 0) > 0 and r.get("total", 0) == 0:
                                r["total"] = round(float(jr[12]), 2)
                            r["enriched"] = True
                        elif ext_id or num:
                            new_idx = len(ml_rows)
                            _ex2[ext_id] = new_idx
                            ml_rows.append({
                                "origen": "ml", "internal_id": int(int_id) if int_id and int_id.isdigit() else None,
                                "external_id": ext_id, "number": num, "fecha": jr[5],
                                "status": jr[6] or "", "payment_status": jr[7] or "", "shipping_status": jr[8] or "",
                                "merch_cost": round(float(jr[9] or 0), 2), "shipping_cost": round(float(jr[10] or 0), 2),
                                "profit_unidrop": round(float(jr[11] or 0), 2), "total": round(float(jr[12] or 0), 2),
                                "buyer_name": buyer, "shipping_type": jr[13] or "", "intent_id": iid,
                                "enriched": True, "items": [], "shipment": None,
                            })
                    log.info("ML join-table uid=%s jt_rows=%d ml_total=%d", user_id, len(_jt_rows), len(ml_rows))
        except Exception as _jt_err:
            log.warning("ML join-table fail uid=%s: %s", user_id, str(_jt_err)[:200])

    # 2d) WebhookOrder como fuente de buyer_name para stubs
    # WebhookOrder (12K rows) tiene orders no sincronizadas a OML.
    # Solo busca buyer info para rows que aun no tienen buyer_name.
    _stubs_sin_buyer = [r for r in ml_rows if not r.get("buyer_name") and r.get("external_id")]
    if _stubs_sin_buyer:
        _wo_ext_ids = [r["external_id"] for r in _stubs_sin_buyer]
        _wo_lit = "ARRAY[" + ",".join("'" + i + "'" for i in _wo_ext_ids) + "]::text[]"
        try:
            _wo_cols = list_columns(eng, "mercado_libre_dev", "WebhookOrder")
            log.info("WebhookOrder cols=%s", _wo_cols[:20])
            _wo_order_col = next((c for c in ["orderId", "mlOrderId", "order_id", "id"] if c in _wo_cols), None)
            _wo_buyer_col = next((c for c in ["buyerNickname", "buyerName", "buyer_name", "buyer", "buyerId"] if c in _wo_cols), None)
            _wo_number_col = next((c for c in ["number", "orderNumber", "order_number"] if c in _wo_cols), None)
            _wo_status_col = next((c for c in ["status", "orderStatus"] if c in _wo_cols), None)
            if _wo_order_col and _wo_buyer_col:
                _wo_num_sel = f'COALESCE("{_wo_number_col}"::text, \'\')' if _wo_number_col else "''"
                _wo_st_sel = f'COALESCE("{_wo_status_col}"::text, \'\')' if _wo_status_col else "''"
                _wo_rows = q(eng, f"""
                    SELECT "{_wo_order_col}"::text,
                           COALESCE("{_wo_buyer_col}"::text, '') AS buyer,
                           {_wo_num_sel} AS num,
                           {_wo_st_sel} AS status
                    FROM mercado_libre_dev."WebhookOrder"
                    WHERE "{_wo_order_col}"::text = ANY({_wo_lit})
                """) or []
                if _wo_rows:
                    _wo_map = {r[0]: {"buyer": r[1], "num": r[2], "status": r[3]} for r in _wo_rows if r[0]}
                    for r in _stubs_sin_buyer:
                        if r.get("external_id") in _wo_map:
                            wd = _wo_map[r["external_id"]]
                            if wd["buyer"] and not r.get("buyer_name"):
                                r["buyer_name"] = wd["buyer"]
                            if wd["num"] and not r.get("number"):
                                r["number"] = wd["num"]
                            if wd["status"]:
                                r["status"] = wd["status"]
                    log.info("WebhookOrder uid=%s wo_rows=%d", user_id, len(_wo_rows))
        except Exception as _wo_err:
            log.warning("WebhookOrder fail uid=%s: %s", user_id, str(_wo_err)[:200])

    # 3) Enrich TN — DOS queries separadas merged en Python (UNION ALL en SQL
    # tambien fallaba silenciosamente; sospechamos algo en SQLAlchemy text()
    # con ANY(ARRAY[...]::text[]). Bajamos a single-WHERE por query, que
    # confirmamos funciona con count=11 del debug anterior.)
    uid_int = int(user_id)
    # Columnas mínimas que SABEMOS existen (last_tn_orders ya las usa).
    # Las extras (contact_name, billing_province, contact_identification) las
    # traemos con un SELECT defensivo aparte que si falla por schema no rompe.
    base_select = """
        SELECT tno.tienda_nube_id::text AS internal_id,
               tno."number",
               tno.created_at::text AS fecha,
               tno.payment_status::text AS payment_status,
               COALESCE(tno.total,0)::float AS total
        FROM public.tienda_nube_orders tno
    """
    erows_all: list = []
    erows_by_intent: list = []
    erows_by_user: list = []
    # Brazo (b) — por user_id. SOLO si NO estamos filtrando por intent_id
    # especifico (cuando hay intent_id queremos ver SOLO las orders ligadas
    # a ese intent, no todas las del dropshipper).
    if not intent_id:
        try:
            erows_by_user = q(eng, f"""
                {base_select}
                WHERE tno.user_id = {uid_int}
                ORDER BY tno.created_at DESC NULLS LAST
                LIMIT 200
            """) or []
        except Exception as e:
            log.warning("unified_orders TN by_user fail uid=%s: %s", user_id, str(e)[:200])
    # Brazo (a) — por tienda_nube_id IN safe_tn (las orders ligadas a intents)
    if safe_tn:
        tn_ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in safe_tn) + "]::text[]"
        try:
            erows_by_intent = q(eng, f"""
                {base_select}
                WHERE tno.tienda_nube_id::text = ANY({tn_ids_lit})
                LIMIT 200
            """) or []
        except Exception as e:
            log.warning("unified_orders TN by_intent fail uid=%s: %s", user_id, str(e)[:200])
    # Merge + dedup por internal_id (user-link primero, intent-link agrega lo que falte)
    seen_ids: set[str] = set()
    erows = []
    for er in (erows_by_user + erows_by_intent):
        k = er[0] or ""
        if k in seen_ids: continue
        seen_ids.add(k)
        erows.append(er)
    erows = erows[:200]
    log.info("unified_orders TN uid=%s by_user=%d by_intent=%d total_dedup=%d",
             user_id, len(erows_by_user), len(erows_by_intent), len(erows))
    try:
        for er in erows:
            key_intent = tn_id_to_intent.get(er[0])
            tn_rows.append({
                "origen": "tn",
                "internal_id": int(er[0]) if er[0] and er[0].isdigit() else None,
                "external_id": er[0] or "",
                "number": er[1] or "",
                "fecha": er[2],
                "status": er[3] or "",
                "payment_status": er[3] or "",
                "shipping_status": "",
                "total": round(float(er[4] or 0), 2),
                "merch_cost": 0.0,
                "shipping_cost": 0.0,
                "profit_unidrop": 0.0,
                "buyer_name": "",
                "billing_province": "",
                "billing_city": "",
                "billing_address": "",
                "billing_zipcode": "",
                "contact_email": "",
                "contact_phone": "",
                "contact_dni": "",
                "shipping_address": "",
                "shipping_city": "",
                "shipping_zipcode": "",
                "shipping_type": "",
                "intent_id": key_intent,
                "enriched": True,
                "items": [],
                "shipment": None,
            })
    except Exception as e:
        log.warning("unified_orders TN enrich fail uid=%s: %s", user_id, e)

    # Enriquecer buyer_name + shipping_cost + billing location con queries defensivas
    # (si una col no existe, q() devuelve None y seguimos sin esa data)
    if tn_rows:
        ids_for_enrich = ",".join("'" + str(r["internal_id"]) + "'" for r in tn_rows if r.get("internal_id"))
        if ids_for_enrich:
            # Buyer name + contact + billing/shipping address. Defensive: usamos
            # list_columns para saber que columnas existen y construir SELECT dinamicamente.
            tno_all_cols = list_columns(eng, "public", "tienda_nube_orders")
            # Columna de nombre: probamos varios candidatos
            _name_candidates = ["contact_name", "buyer_name", "customer_name", "client_name"]
            _name_col = next((c for c in _name_candidates if c in tno_all_cols), None)
            _id_col   = next((c for c in ["contact_identification", "buyer_dni", "customer_dni"] if c in tno_all_cols), None)
            _id_col_sql = f'"{_id_col}"::text' if _id_col else "NULL"
            if _name_col:
                _name_expr = f"COALESCE(NULLIF(\"{_name_col}\"::text, ''), {_id_col_sql}, '')"
            elif _id_col:
                _name_expr = f"COALESCE(\"{_id_col}\"::text, '')"
            else:
                _name_expr = "''"
            # Columnas opcionales (contact + address)
            _opt_cols: list[tuple[str, str]] = [
                ("billing_province",  "billing_province"),
                ("billing_city",      "billing_city"),
                ("billing_address",   "billing_address"),
                ("billing_zipcode",   "billing_zipcode"),
                ("contact_email",     "contact_email"),
                ("contact_phone",     "contact_phone"),
                ("contact_identification", "contact_dni"),
                ("shipping_address",  "shipping_address"),
                ("shipping_city",     "shipping_city"),
                ("shipping_zipcode",  "shipping_zipcode"),
            ]
            _opt_select: list[str] = []
            _opt_keys:   list[str] = []
            for col, alias in _opt_cols:
                if col in tno_all_cols:
                    _opt_select.append(f"COALESCE(\"{col}\"::text, '') AS {alias}")
                    _opt_keys.append(alias)
            _extra_sql = (", " + ", ".join(_opt_select)) if _opt_select else ""
            loc_rows = q(eng, f"""
                SELECT tienda_nube_id::text,
                       {_name_expr} AS buyer_name
                       {_extra_sql}
                FROM public.tienda_nube_orders
                WHERE tienda_nube_id::text IN ({ids_for_enrich})
            """) or []
            if loc_rows:
                loc_map: dict[str, dict] = {}
                for lr in loc_rows:
                    if not lr[0]: continue
                    entry: dict = {"buyer_name": lr[1] or ""}
                    for i, key in enumerate(_opt_keys, 2):
                        entry[key] = lr[i] or ""
                    loc_map[lr[0]] = entry
                for r in tn_rows:
                    iid = str(r.get("internal_id") or "")
                    if iid not in loc_map: continue
                    loc = loc_map[iid]
                    if loc["buyer_name"]:
                        r["buyer_name"] = loc["buyer_name"]
                    for key in _opt_keys:
                        if key in loc and not r.get(key):
                            r[key] = loc[key]
            # Shipping cost — probar variantes de nombre de columna
            for col_name in ["shipping_cost", "shippingCost", "shipping_amount", "shipping_total"]:
                ship_rows = q(eng, f"""
                    SELECT tienda_nube_id::text, COALESCE({col_name}, 0)::float
                    FROM public.tienda_nube_orders
                    WHERE tienda_nube_id::text IN ({ids_for_enrich})
                      AND {col_name} IS NOT NULL
                """) or []
                if ship_rows:
                    ship_map = {sr[0]: float(sr[1] or 0) for sr in ship_rows if sr[0]}
                    for r in tn_rows:
                        iid = str(r.get("internal_id") or "")
                        if iid in ship_map:
                            r["shipping_cost"] = round(ship_map[iid], 2)
                    log.info("unified_orders TN shipping_cost OK col=%s rows=%d", col_name, len(ship_rows))
                    break

    # 4a) Items + envío TN — carga bulk por internal_id
    if tn_rows:
        tn_internal = [str(r["internal_id"]) for r in tn_rows if r.get("internal_id")]
        if tn_internal:
            tn_ids_bulk = ",".join("'" + i + "'" for i in tn_internal)
            # tienda_nube_order_items
            tni_rows = q(eng, f"""
                SELECT order_id::text, sku, name, quantity::int, price::float
                FROM public.tienda_nube_order_items
                WHERE order_id::text IN ({tn_ids_bulk})
                ORDER BY order_id
            """) or []
            items_by_tn: dict[str, list] = {}
            for ir in tni_rows:
                k = ir[0] or ""
                items_by_tn.setdefault(k, []).append({
                    "sku": ir[1] or "", "name": ir[2] or "",
                    "qty": int(ir[3] or 0), "price": round(float(ir[4] or 0), 2),
                })
            log.info("unified_orders TN items uid=%s orders=%d items=%d",
                     user_id, len(tn_internal), len(tni_rows))
            # oca_shipments (status, fecha_entrega, costo_envio)
            oca_ship: dict[str, dict] = {}
            oca_rows = q(eng, f"""
                SELECT order_tienda_nube_id::text,
                       COALESCE(ultimo_estado_oca, status::text, '') AS estado,
                       fecha_entrega::text,
                       COALESCE(costo_envio, 0)::float
                FROM public.oca_shipments
                WHERE order_tienda_nube_id::text IN ({tn_ids_bulk})
            """) or []
            for sr in oca_rows:
                k = sr[0] or ""
                oca_ship[k] = {"carrier": "OCA", "status": sr[1] or "", "entregado": sr[2], "costo": float(sr[3] or 0)}
            # lightdata_shipments
            ld_ship: dict[str, dict] = {}
            ld_rows = q(eng, f"""
                SELECT orden_tn_id::text, COALESCE(estado, '') AS estado,
                       COALESCE(costo_envio_ars, 0)::float
                FROM public.lightdata_shipments
                WHERE orden_tn_id::text IN ({tn_ids_bulk})
            """) or []
            for sr in ld_rows:
                k = sr[0] or ""
                ld_ship[k] = {"carrier": "Lightdata", "status": sr[1] or "", "entregado": None, "costo": float(sr[2] or 0)}
            # Apply to rows
            for r in tn_rows:
                iid = str(r.get("internal_id") or "")
                r["items"] = items_by_tn.get(iid, [])
                ship = oca_ship.get(iid) or ld_ship.get(iid)
                r["shipment"] = ship
                if ship and ship.get("status"):
                    r["shipping_status"] = ship["status"]

    # 4b) Items ML — OrderItemMercadoLibre.orderId ES el mlOrderId externo (no el id interno).
    # Usamos external_id para el join. sellerSKU contiene nuestro SKU de catálogo.
    if ml_rows:
        ml_ext_for_items = [str(r["external_id"]) for r in ml_rows if r.get("external_id")]
        if ml_ext_for_items:
            oi_cols = list_columns(eng, "mercado_libre_dev", "OrderItemMercadoLibre")
            log.info("ML items oi_cols=%s", oi_cols)
            # sellerSKU / seller_sku = nuestro SKU (SBUNIB4, PARA005, etc.)
            sku_col = next((c for c in ["sellerSKU", "seller_sku", "sellerCustomField", "seller_custom_field", "sku"] if c in oi_cols), None)
            oid_col = next((c for c in ["orderId", "order_id"] if c in oi_cols), None)
            price_col = next((c for c in ["unitPrice", "unit_price"] if c in oi_cols), None)
            qty_col = "quantity" if "quantity" in oi_cols else None
            title_col = "title" if "title" in oi_cols else None
            type_col = "type" if "type" in oi_cols else None  # "COMBO" | "item"
            cost_col = next((c for c in ["cost", "merchandiseCost", "merchandise_cost"] if c in oi_cols), None)
            if sku_col and oid_col and qty_col:
                ml_ext_bulk = ",".join("'" + i + "'" for i in ml_ext_for_items)
                oi_price = f'COALESCE(oi."{price_col}", 0)::float' if price_col else "0::float"
                oi_title = f'COALESCE(oi."{title_col}"::text, \'\')' if title_col else "''"
                oi_type = f'COALESCE(oi."{type_col}"::text, \'\')' if type_col else "''"
                oi_cost = f'COALESCE(oi."{cost_col}", 0)::float' if cost_col else "0::float"
                ml_item_rows = q(eng, f"""
                    SELECT oi."{oid_col}"::text,
                           COALESCE(oi."{sku_col}"::text, '') AS sku,
                           {oi_title} AS title,
                           COALESCE(oi."{qty_col}", 0)::int AS qty,
                           {oi_price} AS unit_price,
                           {oi_type} AS item_type,
                           {oi_cost} AS cost
                    FROM mercado_libre_dev."OrderItemMercadoLibre" oi
                    WHERE oi."{oid_col}"::text IN ({ml_ext_bulk})
                    ORDER BY oi.id ASC
                """) or []
                items_by_ml_ext: dict[str, list] = {}
                for ir in ml_item_rows:
                    k = ir[0] or ""
                    items_by_ml_ext.setdefault(k, []).append({
                        "sku":       ir[1] or "",
                        "name":      ir[2] or "",
                        "qty":       int(ir[3] or 0),
                        "price":     round(float(ir[4] or 0), 2),
                        "item_type": ir[5] or "",   # "COMBO" o "item"
                        "cost":      round(float(ir[6] or 0), 2),
                    })
                log.info("unified_orders ML items uid=%s sku_col=%s orders=%d items=%d",
                         user_id, sku_col, len(ml_ext_for_items), len(ml_item_rows))
                for r in ml_rows:
                    ext = str(r.get("external_id") or "")
                    if ext in items_by_ml_ext:
                        r["items"] = items_by_ml_ext[ext]
        # MercadoLibreReturn — orderId también es el mlOrderId externo
        ml_ext_all = [str(r["external_id"]) for r in ml_rows if r.get("external_id")]
        if ml_ext_all:
            ret_cols = list_columns(eng, "mercado_libre_dev", "MercadoLibreReturn")
            ret_order_col = next((c for c in ["orderId", "order_id"] if c in ret_cols), None)
            if ret_order_col:
                ret_ext_bulk = ",".join("'" + i + "'" for i in ml_ext_all)
                ret_rows = q(eng, f"""
                    SELECT "{ret_order_col}"::text, COUNT(*)::int AS cant
                    FROM mercado_libre_dev."MercadoLibreReturn"
                    WHERE "{ret_order_col}"::text IN ({ret_ext_bulk})
                    GROUP BY 1
                """) or []
                returns_by_order = {r[0]: int(r[1] or 0) for r in ret_rows if r[0]}
                for r in ml_rows:
                    ext = str(r.get("external_id") or "")
                    if ext in returns_by_order:
                        r["returns_count"] = returns_by_order[ext]

    # 4c) Stub ML enrichment desde tablas extra de mercado_libre_dev
    # Para órdenes que no matchearon en OML: descubrimos schema y enriquecemos
    # con Shipment, Buyer, y cualquier tabla que tenga mlOrderId directo.
    _stub_ml = [r for r in ml_rows if not r.get("internal_id")]
    if _stub_ml:
        _stub_ext_ids = [r["external_id"] for r in _stub_ml if r.get("external_id")]
        if _stub_ext_ids:
            try:
                _ml_tbls = q(eng, """
                    SELECT t.table_name,
                           string_agg(c.column_name, ',' ORDER BY c.ordinal_position) AS cols
                    FROM information_schema.tables t
                    JOIN information_schema.columns c
                         ON c.table_schema = t.table_schema AND c.table_name = t.table_name
                    WHERE t.table_schema = 'mercado_libre_dev'
                    GROUP BY t.table_name
                    ORDER BY t.table_name
                """) or []
                _avail: dict[str, list[str]] = {r[0]: (r[1] or "").split(",") for r in _ml_tbls}
                log.info("ML schema discovery uid=%s tables=%s", user_id, list(_avail.keys()))

                _stub_lit = "ARRAY[" + ",".join("'" + i + "'" for i in _stub_ext_ids) + "]::text[]"

                # Intenta Shipment por mlOrderId (tracking / estado envío)
                for _sname in ["ShipmentMercadoLibre", "MercadoLibreShipment", "MercadoLibreShipping"]:
                    if _sname not in _avail:
                        continue
                    _sc = _avail[_sname]
                    _so = next((c for c in ["mlOrderId", "orderId", "order_id"] if c in _sc), None)
                    if not _so:
                        continue
                    _ss = next((c for c in ["status", "shippingStatus", "shipping_status"] if c in _sc), None)
                    _sk = next((c for c in ["carrier", "logisticType", "logistic_type", "shippingType"] if c in _sc), None)
                    try:
                        _shp_sel = f'"{_so}"::text'
                        _shp_sel += f', COALESCE("{_ss}"::text, \'\')' if _ss else ", ''"
                        _shp_sel += f', COALESCE("{_sk}"::text, \'\')' if _sk else ", ''"
                        _shp_r = q(eng, f"""
                            SELECT {_shp_sel}
                            FROM mercado_libre_dev."{_sname}"
                            WHERE "{_so}"::text = ANY({_stub_lit})
                        """) or []
                        if _shp_r:
                            _shp_map = {sr[0]: {"carrier": sr[2] or "MELI", "status": sr[1] or "", "entregado": None, "costo": 0.0} for sr in _shp_r if sr[0]}
                            for r in _stub_ml:
                                if r.get("external_id") in _shp_map:
                                    r["shipment"] = _shp_map[r["external_id"]]
                                    if _shp_map[r["external_id"]].get("status"):
                                        r["shipping_status"] = _shp_map[r["external_id"]]["status"]
                            log.info("ML stub shipment enrich table=%s rows=%d", _sname, len(_shp_r))
                        break
                    except Exception as _se:
                        log.warning("ML stub shipment %s fail: %s", _sname, str(_se)[:80])

                # Intenta tablas de buyer para nombre del comprador
                for _bname, _bcols in _avail.items():
                    if "buyer" not in _bname.lower():
                        continue
                    _bo = next((c for c in ["mlOrderId", "orderId", "order_id"] if c in _bcols), None)
                    _bn = next((c for c in ["nickname", "name", "buyer_name", "full_name", "username"] if c in _bcols), None)
                    if not _bo or not _bn:
                        continue
                    try:
                        _br = q(eng, f"""
                            SELECT "{_bo}"::text, COALESCE("{_bn}"::text, '')
                            FROM mercado_libre_dev."{_bname}"
                            WHERE "{_bo}"::text = ANY({_stub_lit})
                        """) or []
                        if _br:
                            _bmap = {b[0]: b[1] for b in _br if b[0] and b[1]}
                            for r in _stub_ml:
                                if r.get("external_id") in _bmap and not r.get("buyer_name"):
                                    r["buyer_name"] = _bmap[r["external_id"]]
                            log.info("ML stub buyer enrich table=%s rows=%d", _bname, len(_br))
                    except Exception as _be:
                        log.warning("ML stub buyer %s fail: %s", _bname, str(_be)[:80])

                # Intenta items por mlOrderId directo (OrderItemMercadoLibre
                # normalmente usa orderId interno, pero algunas integraciones
                # tienen mlOrderId como columna extra)
                if "OrderItemMercadoLibre" in _avail:
                    _ic = _avail["OrderItemMercadoLibre"]
                    _ml_col = next((c for c in ["mlOrderId", "ml_order_id"] if c in _ic), None)
                    if _ml_col:
                        _sku_c = next((c for c in ["sellerCustomField", "seller_custom_field", "sku"] if c in _ic), None)
                        _qty_c = "quantity" if "quantity" in _ic else None
                        _ttl_c = "title" if "title" in _ic else None
                        _prc_c = next((c for c in ["unitPrice", "unit_price"] if c in _ic), None)
                        if _sku_c and _qty_c:
                            try:
                                _ii_sel = f'"{_ml_col}"::text'
                                _ii_sel += f', COALESCE(oi."{_sku_c}"::text, \'\')'
                                _ii_sel += f', COALESCE(oi."{_ttl_c}"::text, \'\')' if _ttl_c else ", ''"
                                _ii_sel += f', COALESCE(oi."{_qty_c}", 0)::int'
                                _ii_sel += f', COALESCE(oi."{_prc_c}", 0)::float' if _prc_c else ", 0::float"
                                _ii_rows = q(eng, f"""
                                    SELECT {_ii_sel}
                                    FROM mercado_libre_dev."OrderItemMercadoLibre" oi
                                    WHERE "{_ml_col}"::text = ANY({_stub_lit})
                                """) or []
                                if _ii_rows:
                                    _imap: dict[str, list] = {}
                                    for ir in _ii_rows:
                                        _imap.setdefault(ir[0], []).append({
                                            "sku": ir[1] or "", "name": ir[2] or "",
                                            "qty": int(ir[3] or 0), "price": round(float(ir[4] or 0), 2),
                                        })
                                    for r in _stub_ml:
                                        if r.get("external_id") in _imap:
                                            r["items"] = _imap[r["external_id"]]
                                    log.info("ML stub items via mlOrderId rows=%d", len(_ii_rows))
                            except Exception as _ie:
                                log.warning("ML stub items mlOrderId fail: %s", str(_ie)[:80])

            except Exception as _disc_err:
                log.warning("ML stub enrichment fail uid=%s: %s", user_id, str(_disc_err)[:150])

    # 4) Combinar y ordenar por fecha desc
    unified = ml_rows + tn_rows
    unified.sort(key=lambda x: x.get("fecha") or "", reverse=True)

    # 5) Limit
    return unified[:int(limit)]


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
