"""
Vista global de órdenes Unidrop: ML + TN de todos los dropshippers, paginada.

Columnas y patrones de fecha copiados de drilldowns.unidrop_orders_combined_paid
que es la query confirmada funcionando en producción.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window

log = logging.getLogger("unidata.dashboards")

_ML_SUB = """
    SELECT
        COALESCE(u.id, 0)::int                                               AS user_id,
        COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar') AS dropshipper_name,
        'ml'::text                                                           AS origen,
        COALESCE(o."number", o.id::text)                                     AS "number",
        o.id::text                                                           AS external_id,
        o."dateCreated"::text                                                AS fecha,
        o.status::text                                                       AS status,
        ''::text                                                             AS payment_status,
        ''::text                                                             AS shipping_status,
        COALESCE(o."totalAmount", 0)::float                                  AS total,
        0::float                                                             AS merch_cost,
        COALESCE(o."shipping_cost", 0)::float                                AS shipping_cost,
        COALESCE(o."profit_for_subscription", 0)::float                      AS profit_unidrop,
        COALESCE(o."buyer_name", '')                                         AS buyer_name,
        ''::text                                                             AS buyer_city,
        ''::text                                                             AS buyer_province,
        ''::text                                                             AS shipping_type,
        FALSE                                                                AS label_downloaded
    FROM mercado_libre_dev."OrderMercadoLibre" o
    LEFT JOIN public."User" u
         ON u.dni::text = split_part(o."number", '-', 2)
    WHERE o."number" LIKE 'DROP-%'
      AND o."dateCreated" >= :from_ts AND o."dateCreated" < :to_ts
"""

_TN_SUB = """
    SELECT
        COALESCE(u.id, 0)::int                                               AS user_id,
        COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar') AS dropshipper_name,
        'tn'::text                                                           AS origen,
        COALESCE(tno."number", tno.tienda_nube_id::text)                     AS "number",
        tno.tienda_nube_id::text                                             AS external_id,
        tno.created_at::text                                                 AS fecha,
        tno.payment_status::text                                             AS status,
        tno.payment_status::text                                             AS payment_status,
        ''::text                                                             AS shipping_status,
        COALESCE(tno.total, 0)::float                                        AS total,
        0::float                                                             AS merch_cost,
        0::float                                                             AS shipping_cost,
        0::float                                                             AS profit_unidrop,
        COALESCE(NULLIF(tno.contact_name, ''), '')                           AS buyer_name,
        ''::text                                                             AS buyer_city,
        ''::text                                                             AS buyer_province,
        ''::text                                                             AS shipping_type,
        FALSE                                                                AS label_downloaded
    FROM public.tienda_nube_orders tno
    LEFT JOIN public."User" u ON u.id = tno.user_id
    WHERE tno.created_at >= :from_ts AND tno.created_at < :to_ts
"""


def orders_global_unidrop(
    period: str = "7d",
    channel: str = "all",
    shipping_type: str | None = None,
    status_filter: str | None = None,
    search_drop: str | None = None,
    user_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    date_params = {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}
    log.warning("orders_global_unidrop: period=%s from=%s to=%s uid=%s channel=%s", period, win["from_ts"], win["to_ts"], user_id, channel)

    include_ml = channel in ("all", "ml")
    include_tn = channel in ("all", "tn")

    subs = []
    if include_ml:
        subs.append(_ML_SUB)
    if include_tn:
        subs.append(_TN_SUB)

    if not subs:
        return {"items": [], "total": 0, "limit": limit, "offset": offset,
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    union_sql = " UNION ALL ".join(f"({s})" for s in subs)

    where_clauses = ["1=1"]
    extra_params: dict = {}

    if shipping_type and shipping_type.lower() not in ("all", ""):
        st = shipping_type.lower()
        if st in ("pr", "punto"):
            where_clauses.append(
                "(LOWER(shipping_type) LIKE '%pr%' OR LOWER(shipping_type) LIKE '%punto%'"
                " OR LOWER(shipping_type) LIKE '%drop_off%')"
            )
        elif st in ("flex", "flexi"):
            where_clauses.append(
                "(LOWER(shipping_type) LIKE '%flexi%' OR LOWER(shipping_type) LIKE '%self%'"
                " OR LOWER(shipping_type) = 'flex')"
            )
        elif st == "full":
            where_clauses.append("LOWER(shipping_type) LIKE '%full%'")
        elif st == "oca":
            where_clauses.append("LOWER(shipping_type) LIKE '%oca%'")
        elif st in ("lightdata", "unifast"):
            where_clauses.append(
                "(LOWER(shipping_type) LIKE '%lightdata%' OR LOWER(shipping_type) LIKE '%unifast%')"
            )
        elif st == "andreani":
            where_clauses.append("LOWER(shipping_type) LIKE '%andreani%'")

    if status_filter and status_filter.lower() not in ("all", ""):
        sf = status_filter.lower()
        STATUS_MAP = {
            "paid": "paid",
            "confirmed": "confirmed",
            "shipped": "shipped",
            "delivered": "delivered",
            "cancelled": "cancel",
        }
        raw = STATUS_MAP.get(sf, sf)
        where_clauses.append(
            "(LOWER(status) LIKE :sf OR LOWER(payment_status) LIKE :sf OR LOWER(shipping_status) LIKE :sf)"
        )
        extra_params["sf"] = f"%{raw}%"

    if search_drop and search_drop.strip():
        where_clauses.append("LOWER(dropshipper_name) LIKE LOWER(:search_drop)")
        extra_params["search_drop"] = f"%{search_drop.strip()}%"

    if user_id:
        where_clauses.append("user_id = :user_id")
        extra_params["user_id"] = user_id

    where_sql = " AND ".join(where_clauses)
    params: dict = {**date_params, **extra_params}

    # Diagnostic: test each source independently with date filter
    _ml_nd = scalar(eng, 'SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre" WHERE "number" LIKE \'DROP-%\'')
    _ml_d = scalar(eng, 'SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre" WHERE "number" LIKE \'DROP-%\' AND "dateCreated" >= :from_ts AND "dateCreated" < :to_ts', date_params)
    _ml_max = scalar(eng, 'SELECT MAX("dateCreated")::text FROM mercado_libre_dev."OrderMercadoLibre" WHERE "number" LIKE \'DROP-%\'')
    _tn_nd = scalar(eng, "SELECT COUNT(*) FROM public.tienda_nube_orders")
    _tn_d = scalar(eng, "SELECT COUNT(*) FROM public.tienda_nube_orders WHERE created_at >= :from_ts AND created_at < :to_ts", date_params)
    _tn_max = scalar(eng, "SELECT MAX(created_at)::text FROM public.tienda_nube_orders")
    log.warning("DIAG ML: no_date=%s with_date=%s max_date=%s", _ml_nd, _ml_d, _ml_max)
    log.warning("DIAG TN: no_date=%s with_date=%s max_date=%s", _tn_nd, _tn_d, _tn_max)

    total = int(scalar(eng, f"""
        SELECT COUNT(*) FROM ({union_sql}) x WHERE {where_sql}
    """, params) or 0)
    log.warning("orders_global_unidrop RESULT: total=%d from=%s to=%s", total, win["from_ts"], win["to_ts"])

    rows = q(eng, f"""
        SELECT user_id, dropshipper_name, origen, "number", external_id, fecha,
               status, payment_status, shipping_status, total, merch_cost, shipping_cost,
               profit_unidrop, buyer_name, buyer_city, buyer_province, shipping_type, label_downloaded
        FROM ({union_sql}) x
        WHERE {where_sql}
        ORDER BY fecha DESC NULLS LAST
        LIMIT :lim OFFSET :off
    """, {**params, "lim": limit, "off": offset}) or []

    items = [{
        "user_id": int(r[0]) if r[0] else 0,
        "dropshipper_name": r[1] or "",
        "origen": r[2] or "ml",
        "number": r[3] or "",
        "external_id": r[4] or "",
        "fecha": str(r[5]) if r[5] else "",
        "status": r[6] or "",
        "payment_status": r[7] or "",
        "shipping_status": r[8] or "",
        "total": round(float(r[9] or 0), 2),
        "merch_cost": round(float(r[10] or 0), 2),
        "shipping_cost": round(float(r[11] or 0), 2),
        "profit_unidrop": round(float(r[12] or 0), 2),
        "buyer_name": r[13] or "",
        "buyer_city": r[14] or "",
        "buyer_province": r[15] or "",
        "shipping_type": r[16] or "",
        "label_downloaded": bool(r[17]),
    } for r in rows]

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
