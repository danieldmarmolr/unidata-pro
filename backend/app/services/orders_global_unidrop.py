"""
Vista global de órdenes Unidrop: ML + TN de todos los dropshippers, paginada.

ML: consulta OrderMercadoLibre directamente por number LIKE 'DROP-%',
    extrae DNI del formato DROP-{dni}-{seq} para unir a User.
    El join via pi."mlOrderIds" = ANY(oml.id) no funciona porque los IDs
    en el array no coinciden con oml.id (comportamiento confirmado en logs).

TN: ancla en PaymentIntent PROCESSED con cast text para el join a tienda_nube_orders.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar

log = logging.getLogger("unidata.dashboards")

PERIOD_DAYS = {"today": 1, "yesterday": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def _ml_date_clause(period: str, from_iso: str | None, to_iso: str | None) -> tuple[str, dict]:
    if period == "custom" and from_iso and to_iso:
        return (
            'oml."dateCreated" >= :from_iso::timestamp AND oml."dateCreated" <= :to_iso::timestamp',
            {"from_iso": from_iso, "to_iso": to_iso},
        )
    days = PERIOD_DAYS.get(period, 30)
    return 'oml."dateCreated" >= NOW() - make_interval(days => :days)', {"days": days}


def _tn_date_clause(period: str, from_iso: str | None, to_iso: str | None) -> tuple[str, dict]:
    if period == "custom" and from_iso and to_iso:
        return (
            'pi."createdAt" >= :from_iso::timestamp AND pi."createdAt" <= :to_iso::timestamp',
            {"from_iso": from_iso, "to_iso": to_iso},
        )
    days = PERIOD_DAYS.get(period, 30)
    return 'pi."createdAt" >= NOW() - make_interval(days => :days)', {"days": days}


def _ml_sub(date_clause: str) -> str:
    """ML orders: OML por numero DROP-{dni}-* → join User via DNI extraido del numero."""
    return f"""
    SELECT
        u.id::int                                               AS user_id,
        COALESCE(u.fantasy_name, u.name, u.email)               AS dropshipper_name,
        'ml'::text                                              AS origen,
        COALESCE(oml."number", oml.id::text)                    AS "number",
        oml.id::text                                            AS external_id,
        oml."dateCreated"                                       AS fecha,
        COALESCE(oml.status, '')                                AS status,
        COALESCE(oml."paymentStatus", '')                       AS payment_status,
        COALESCE(oml."shippingStatus", '')                      AS shipping_status,
        COALESCE(oml."totalAmount", 0)::float                   AS total,
        COALESCE(oml."merchandise_cost", 0)::float              AS merch_cost,
        COALESCE(oml."shipping_cost", 0)::float                 AS shipping_cost,
        COALESCE(oml."profit_for_subscription", 0)::float       AS profit_unidrop,
        COALESCE(oml."buyer_name", '')                          AS buyer_name,
        ''                                                      AS buyer_city,
        ''                                                      AS buyer_province,
        COALESCE(oml."shipping_type", '')                       AS shipping_type,
        FALSE                                                   AS label_downloaded
    FROM mercado_libre_dev."OrderMercadoLibre" oml
    JOIN public."User" u
         ON u.dni::text = split_part(oml."number", '-', 2)
    WHERE oml."number" LIKE 'DROP-%'
      AND {date_clause}"""


def _tn_sub(date_clause: str) -> str:
    """TN orders: PaymentIntent PROCESSED → tienda_nube_orders via text cast."""
    return f"""
    SELECT
        cpa."userId"::int                                       AS user_id,
        COALESCE(u.fantasy_name, u.name, u.email)               AS dropshipper_name,
        'tn'::text                                              AS origen,
        COALESCE(tno."number", tno.tienda_nube_id::text)        AS "number",
        tno.tienda_nube_id::text                                AS external_id,
        tno.created_at                                          AS fecha,
        tno.payment_status::text                                AS status,
        tno.payment_status::text                                AS payment_status,
        COALESCE(tno.shipping_status, '')                       AS shipping_status,
        COALESCE(tno.total, 0)::float                           AS total,
        0::float                                                AS merch_cost,
        0::float                                                AS shipping_cost,
        0::float                                                AS profit_unidrop,
        COALESCE(tno.contact_name, '')                          AS buyer_name,
        COALESCE(tno.billing_city, '')                          AS buyer_city,
        COALESCE(tno.billing_province, '')                      AS buyer_province,
        COALESCE(tno.shipping_carrier, '')                      AS shipping_type,
        COALESCE(tno.label_downloaded, FALSE)                   AS label_downloaded
    FROM public."PaymentIntent" pi
    JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
    JOIN public."User" u ON u.id = cpa."userId"
    JOIN public.tienda_nube_orders tno
         ON tno.tienda_nube_id::text = ANY(pi."orderIds"::text[])
    WHERE pi."status" = 'PROCESSED'
      AND {date_clause}
      AND COALESCE(array_length(pi."orderIds", 1), 0) > 0"""


def orders_global_unidrop(
    period: str = "7d",
    channel: str = "all",
    shipping_type: str | None = None,
    status_filter: str | None = None,
    search_drop: str | None = None,
    limit: int = 100,
    offset: int = 0,
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    eng = get_engine("unidrop")

    ml_date, ml_params = _ml_date_clause(period, from_iso, to_iso)
    tn_date, tn_params = _tn_date_clause(period, from_iso, to_iso)

    include_ml = channel in ("all", "ml")
    include_tn = channel in ("all", "tn")

    parts: list[tuple[str, dict]] = []
    if include_ml:
        parts.append((_ml_sub(ml_date), ml_params))
    if include_tn:
        parts.append((_tn_sub(tn_date), tn_params))

    if not parts:
        return {"items": [], "total": 0, "limit": limit, "offset": offset,
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    # ML y TN pueden tener distintos params solo si son mismos keys con mismo valor
    # (ambos usan :days o ambos usan :from_iso/:to_iso) — safe para UNION ALL
    merged_params: dict = {}
    for _, p in parts:
        merged_params.update(p)

    union_sql = " UNION ALL ".join(f"({sub})" for sub, _ in parts)

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

    where_sql = " AND ".join(where_clauses)
    params: dict = {**merged_params, **extra_params}

    # Debug: conteos separados por canal para diagnosticar
    if include_ml:
        _ml_only = _ml_sub(ml_date)
        _ml_cnt = int(scalar(eng, f"SELECT COUNT(*) FROM ({_ml_only}) x", ml_params) or 0)
        log.warning("orders_global DEBUG ml_count=%d period=%s", _ml_cnt, period)
    if include_tn:
        _tn_only = _tn_sub(tn_date)
        _tn_cnt = int(scalar(eng, f"SELECT COUNT(*) FROM ({_tn_only}) x", tn_params) or 0)
        log.warning("orders_global DEBUG tn_count=%d period=%s", _tn_cnt, period)

    # Debug: contar OML DROP sin join a User
    _raw_drop = int(scalar(eng, """
        SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre" oml
        WHERE oml."number" LIKE 'DROP-%'
          AND oml."dateCreated" >= NOW() - make_interval(days => 90)
    """, {}) or 0)
    log.warning("orders_global DEBUG raw_drop_count=%d (no user join)", _raw_drop)

    total = int(scalar(eng, f"""
        SELECT COUNT(*) FROM ({union_sql}) x WHERE {where_sql}
    """, params) or 0)

    log.warning("orders_global_unidrop: period=%s total=%d", period, total)

    rows = q(eng, f"""
        SELECT user_id, dropshipper_name, origen, "number", external_id, fecha::text,
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
