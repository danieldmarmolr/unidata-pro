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
    limit: int = 1000,
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

    items = [dict(zip(keys, r)) for r in rows]

    # Filtros derivados (lado python)
    if riesgo == "sin_publicar":
        items = [it for it in items if (it.get("pub_activas") or 0) == 0]
    elif riesgo == "sin_vender":
        items = [it for it in items if (it.get("ventas_pagadas") or 0) == 0]
    elif riesgo == "con_deuda":
        items = [it for it in items if (it.get("deuda_pendiente") or 0) > 0]
    elif riesgo == "token_expira":
        items = [it for it in items if it.get("requiere_reauth") is True]

    if actividad == "activo":
        # Tiene venta en los ultimos 30d
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
        def _is_active(it):
            uv = it.get("ultima_venta")
            if not uv: return False
            try:
                d = dt.datetime.fromisoformat(uv.replace(" ", "T"))
                if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
                return d >= cutoff
            except Exception:
                return False
        items = [it for it in items if _is_active(it)]
    elif actividad == "inactivo":
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
        def _is_inactive(it):
            uv = it.get("ultima_venta")
            if not uv: return True
            try:
                d = dt.datetime.fromisoformat(uv.replace(" ", "T"))
                if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
                return d < cutoff
            except Exception:
                return True
        items = [it for it in items if _is_inactive(it)]

    # Stats agregados (sobre la lista filtrada)
    total = len(items)
    sum_gmv = sum(float(it.get("gmv") or 0) for it in items)
    sum_profit = sum(float(it.get("profit_unidrop") or 0) for it in items)
    sum_pago = sum(float(it.get("pago_unidrop_total") or 0) for it in items)
    sum_deuda = sum(float(it.get("deuda_pendiente") or 0) for it in items)

    sin_publicar = sum(1 for it in items if (it.get("pub_activas") or 0) == 0)
    sin_vender = sum(1 for it in items if (it.get("ventas_pagadas") or 0) == 0)
    con_deuda = sum(1 for it in items if (it.get("deuda_pendiente") or 0) > 0)
    token_expira = sum(1 for it in items if it.get("requiere_reauth") is True)

    return {
        "items": items,
        "total": total,
        "stats": {
            "total": total,
            "gmv": round(sum_gmv, 0),
            "profit_unidrop": round(sum_profit, 0),
            "pago_unidrop": round(sum_pago, 0),
            "deuda_pendiente": round(sum_deuda, 0),
            "sin_publicar": sin_publicar,
            "sin_vender": sin_vender,
            "con_deuda": con_deuda,
            "token_expira": token_expira,
        },
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
