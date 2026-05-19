"""
Vista global de ordenes Unidrop: ML + TN de todos los dropshippers, paginada.
Respeta el filtro de fecha del topbar (period + custom range).
Devuelve campos enriquecidos: shipping_type, ciudad, provincia, payment/shipping
status, costos reales, is_combo (via items LATERAL).
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window

log = logging.getLogger("unidata.dashboards")


def _build_ml_sub(from_ts: dt.datetime, to_ts: dt.datetime) -> str:
    """Sub-query ML — ordenes DROP-* enriquecidas con shipping address (JSONB)."""
    return f"""
        SELECT
            COALESCE(u.id, 0)::int                                                AS user_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar')  AS dropshipper_name,
            'ml'::text                                                            AS origen,
            COALESCE(NULLIF(o."number", ''), o.id::text)                          AS "number",
            o.id::text                                                            AS external_id,
            o."dateCreated"::text                                                 AS fecha,
            COALESCE(o."status", '')::text                                        AS status,
            COALESCE(o."paymentStatus", '')::text                                 AS payment_status,
            COALESCE(o."shippingStatus", '')::text                                AS shipping_status,
            COALESCE(o."totalAmount", 0)::float                                   AS total,
            COALESCE(o."merchandise_cost", 0)::float                              AS merch_cost,
            COALESCE(o."shipping_cost", 0)::float                                 AS shipping_cost,
            COALESCE(o."profit_for_subscription", 0)::float                       AS profit_unidrop,
            COALESCE(o."buyer_name", '')                                          AS buyer_name,
            COALESCE(o."shipping_address_detail"->>'city', '')                    AS buyer_city,
            COALESCE(o."shipping_address_detail"->>'state', '')                   AS buyer_province,
            COALESCE(o."shipping_option_reference", '')                           AS shipping_type,
            COALESCE(o."label_downloaded", FALSE)                                 AS label_downloaded,
            COALESCE(o."cancel_by_unidrop", FALSE)                                AS cancel_by_unidrop,
            EXISTS(
                SELECT 1 FROM mercado_libre_dev."OrderItemMercadoLibre" oi
                WHERE oi."orderId"::text = o.id::text
                  AND UPPER(COALESCE(oi."orderType"::text, '')) = 'COMBO'
            ) AS is_combo
        FROM mercado_libre_dev."OrderMercadoLibre" o
        LEFT JOIN public."User" u
             ON u.dni::text = split_part(o."number", '-', 2)
        WHERE o."number" LIKE 'DROP-%'
          AND o."dateCreated" >= '{from_ts.isoformat()}'::timestamp
          AND o."dateCreated" <  '{to_ts.isoformat()}'::timestamp
    """


def _build_tn_sub(from_ts: dt.datetime, to_ts: dt.datetime) -> str:
    """Sub-query TN — ordenes de tienda nube enriquecidas con direccion + shipping."""
    return f"""
        SELECT
            COALESCE(u.id, 0)::int                                                AS user_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar')  AS dropshipper_name,
            'tn'::text                                                            AS origen,
            COALESCE(NULLIF(tno."number", ''), tno.tienda_nube_id::text)          AS "number",
            tno.tienda_nube_id::text                                              AS external_id,
            tno.created_at::text                                                  AS fecha,
            COALESCE(tno.payment_status::text, '')                                AS status,
            COALESCE(tno.payment_status::text, '')                                AS payment_status,
            COALESCE(tno.shipping_status::text, '')                               AS shipping_status,
            COALESCE(tno.total, 0)::float                                         AS total,
            GREATEST(COALESCE(tno.total_cost, 0)::float - COALESCE(tno.shipping_cost, 0)::float, 0) AS merch_cost,
            COALESCE(tno.shipping_cost, 0)::float                                 AS shipping_cost,
            0::float                                                              AS profit_unidrop,
            COALESCE(NULLIF(tno.contact_name, ''), '')                            AS buyer_name,
            COALESCE(tno.shipping_address->>'city', '')                           AS buyer_city,
            COALESCE(tno.shipping_address->>'province',
                     tno.shipping_address->>'state', '')                          AS buyer_province,
            COALESCE(tno.shipping_option, '')                                     AS shipping_type,
            COALESCE(tno.label_downloaded, FALSE)                                 AS label_downloaded,
            COALESCE(tno.cancel_by_unidrop, FALSE)                                AS cancel_by_unidrop,
            EXISTS(
                SELECT 1 FROM public.tienda_nube_order_items toi
                WHERE toi.tienda_nube_order_id::text = tno.tienda_nube_id::text
                  AND UPPER(COALESCE(toi.order_type::text, '')) = 'COMBO'
            ) AS is_combo
        FROM public.tienda_nube_orders tno
        LEFT JOIN public."User" u ON u.id = tno.user_id
        WHERE tno.created_at >= '{from_ts.isoformat()}'::timestamp
          AND tno.created_at <  '{to_ts.isoformat()}'::timestamp
    """


def orders_global_unidrop(
    period: str = "30d",
    channel: str = "all",
    shipping_type: str | None = None,
    status_filter: str | None = None,
    combo_filter: str | None = None,  # "all" | "combo" | "ind"
    search_drop: str | None = None,
    user_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso=from_iso, to_iso=to_iso)
    from_ts: dt.datetime = win["from_ts"]
    to_ts: dt.datetime = win["to_ts"]

    include_ml = channel in ("all", "ml")
    include_tn = channel in ("all", "tn")

    subs: list[str] = []
    if include_ml:
        subs.append(_build_ml_sub(from_ts, to_ts))
    if include_tn:
        subs.append(_build_tn_sub(from_ts, to_ts))

    if not subs:
        return {"items": [], "total": 0, "total_ml": 0, "total_tn": 0,
                "combo_count": 0, "ind_count": 0,
                "limit": limit, "offset": offset,
                "from": from_ts.isoformat(), "to": to_ts.isoformat(),
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    union_sql = " UNION ALL ".join(f"({s})" for s in subs)

    where_clauses = ["1=1"]
    params: dict = {}

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
        params["sf"] = f"%{raw}%"

    if combo_filter and combo_filter.lower() in ("combo", "ind", "individual"):
        if combo_filter.lower() == "combo":
            where_clauses.append("is_combo = TRUE")
        else:
            where_clauses.append("is_combo = FALSE")

    if search_drop and search_drop.strip():
        where_clauses.append("LOWER(dropshipper_name) LIKE LOWER(:search_drop)")
        params["search_drop"] = f"%{search_drop.strip()}%"

    if user_id:
        where_clauses.append("user_id = :user_id")
        params["user_id"] = user_id

    where_sql = " AND ".join(where_clauses)

    # Totals: total general + por canal + por is_combo
    agg_row = q(eng, f"""
        SELECT COUNT(*)::int                                AS total,
               COUNT(*) FILTER (WHERE origen = 'ml')::int   AS total_ml,
               COUNT(*) FILTER (WHERE origen = 'tn')::int   AS total_tn,
               COUNT(*) FILTER (WHERE is_combo = TRUE)::int AS combo_count,
               COUNT(*) FILTER (WHERE is_combo = FALSE)::int AS ind_count
        FROM ({union_sql}) x WHERE {where_sql}
    """, params) or [(0, 0, 0, 0, 0)]
    agg = agg_row[0] if agg_row else (0, 0, 0, 0, 0)
    total = int(agg[0] or 0)
    total_ml = int(agg[1] or 0)
    total_tn = int(agg[2] or 0)
    combo_count = int(agg[3] or 0)
    ind_count = int(agg[4] or 0)

    rows = q(eng, f"""
        SELECT user_id, dropshipper_name, origen, "number", external_id, fecha,
               status, payment_status, shipping_status, total, merch_cost, shipping_cost,
               profit_unidrop, buyer_name, buyer_city, buyer_province, shipping_type,
               label_downloaded, cancel_by_unidrop, is_combo
        FROM ({union_sql}) x
        WHERE {where_sql}
        ORDER BY fecha DESC NULLS LAST
        LIMIT :lim OFFSET :off
    """, {**params, "lim": limit, "off": offset}) or []

    log.info("orders_global_unidrop period=%s channel=%s window=%s→%s total=%d (ml=%d, tn=%d) returned=%d",
             period, channel, from_ts.isoformat(), to_ts.isoformat(),
             total, total_ml, total_tn, len(rows))

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
        "cancel_by_unidrop": bool(r[18]),
        "is_combo": bool(r[19]),
    } for r in rows]

    return {
        "items": items,
        "total": total,
        "total_ml": total_ml,
        "total_tn": total_tn,
        "combo_count": combo_count,
        "ind_count": ind_count,
        "limit": limit,
        "offset": offset,
        "from": from_ts.isoformat(),
        "to": to_ts.isoformat(),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
