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
from app.services._utils import q, scalar, resolve_window

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
        "primera_venta": v[4],
        "gmv": float(v[5] or 0),
        "costo_mercaderia": float(v[6] or 0),
        "costo_envio": float(v[7] or 0),
        "profit_unidrop": float(v[8] or 0),
        "ticket_promedio": float(v[9] or 0),
        "tasa_cancelacion_pct": round(int(v[2] or 0) / max(int(v[1] or 1), 1) * 100, 1),
        "intents_ml_count": ml_intents,  # cuantos PaymentIntent cubren MELI
    }

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

    # Suscripciones pagadas en el periodo (PaymentTransactionSubscription).
    # El plan al momento del pago no se persiste, asi que tageamos con el
    # plan actual del dropshipper como referencia.
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
    } for r in monthly]

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
        unified_orders = dropshipper_unified_orders(int(user_id), limit=50)
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
        "ultimas_ventas_tn": tn_orders_list,  # tabla TN con `number` para link a Unidrop
        "ultimos_pagos": pagos_list,
        "unified_orders": unified_orders,  # filas ML+TN combinadas por fecha
        # Clientes FINALES del dropshipper (no son dropshippers, son compradores)
        "top_clientes_finales": top_clientes_finales,
        # Suscripciones pagadas (PaymentTransactionSubscription) en periodo
        "suscripciones": {
            "total_pagado": suscripciones_total,
            "cantidad": len(suscripciones_pagadas),
            "items": suscripciones_pagadas,
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def dropshipper_unified_orders(
    user_id: int,
    *,
    limit: int = 50,
    intent_id: int | None = None,
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
            })

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
                "buyer_name": "",  # se enriquece abajo si la col existe
                "shipping_type": "",
                "intent_id": key_intent,
                "enriched": True,
            })
    except Exception as e:
        log.warning("unified_orders TN enrich fail uid=%s: %s", user_id, e)

    # Enriquecer buyer_name + shipping_cost con queries defensivas
    # (si una col no existe, q() devuelve None y seguimos sin esa data)
    if tn_rows:
        ids_for_enrich = ",".join("'" + str(r["internal_id"]) + "'" for r in tn_rows if r.get("internal_id"))
        if ids_for_enrich:
            # Buyer name (con fallback a contact_identification = DNI)
            try:
                buyer_rows = q(eng, f"""
                    SELECT tienda_nube_id::text,
                           COALESCE(NULLIF(contact_name, ''), contact_identification, '')
                    FROM public.tienda_nube_orders
                    WHERE tienda_nube_id::text IN ({ids_for_enrich})
                """) or []
                buyer_map = {br[0]: br[1] for br in buyer_rows if br[0]}
                for r in tn_rows:
                    iid = str(r.get("internal_id") or "")
                    if iid in buyer_map and buyer_map[iid]:
                        r["buyer_name"] = buyer_map[iid]
            except Exception:
                pass
            # Shipping cost — probar variantes de nombre de columna
            for col_name in ["shipping_cost", "shippingCost", "shipping_amount", "shipping_total"]:
                try:
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
                        log.info("unified_orders TN shipping_cost OK col=%s rows=%d",
                                 col_name, len(ship_rows))
                        break  # primera col que funciona gana
                except Exception:
                    continue

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
