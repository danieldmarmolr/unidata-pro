"""
Vista global de órdenes Unidrop: ML + TN de todos los dropshippers, paginada.
Sin pipeline de enriquecimiento completo — datos directos de DB para performance.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window


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
    days = resolve_window(period, from_iso, to_iso)["days"]

    include_ml = channel in ("all", "ml")
    include_tn = channel in ("all", "tn")

    parts: list[str] = []

    if include_ml:
        parts.append("""
            SELECT
                u.id AS user_id,
                COALESCE(u.fantasy_name, u.name, u.email) AS dropshipper_name,
                'ml'::text AS origen,
                COALESCE(oml."number", oml.id::text) AS "number",
                oml.id::text AS external_id,
                oml."dateCreated" AS fecha,
                COALESCE(oml.status, '') AS status,
                COALESCE(oml."paymentStatus", '') AS payment_status,
                COALESCE(oml."shippingStatus", '') AS shipping_status,
                COALESCE(oml."totalAmount", 0)::float AS total,
                COALESCE(oml."merchandise_cost", 0)::float AS merch_cost,
                COALESCE(oml."shipping_cost", 0)::float AS shipping_cost,
                COALESCE(oml."profit_for_subscription", 0)::float AS profit_unidrop,
                COALESCE(oml."buyer_name", '') AS buyer_name,
                '' AS buyer_city,
                '' AS buyer_province,
                COALESCE(oml."shipping_type", '') AS shipping_type,
                FALSE AS label_downloaded
            FROM mercado_libre_dev."OrderMercadoLibre" oml
            JOIN public."User" u ON u.id = oml."userId"
            WHERE oml."dateCreated" >= NOW() - make_interval(days => :days)
              AND oml.status IN ('paid','confirmed','shipped','delivered')
        """)

    if include_tn:
        parts.append("""
            SELECT
                u.id AS user_id,
                COALESCE(u.fantasy_name, u.name, u.email) AS dropshipper_name,
                'tn'::text AS origen,
                COALESCE(tno."number", tno.tienda_nube_id::text) AS "number",
                tno.tienda_nube_id::text AS external_id,
                tno.created_at AS fecha,
                tno.payment_status::text AS status,
                tno.payment_status::text AS payment_status,
                COALESCE(tno.shipping_status, '') AS shipping_status,
                COALESCE(tno.total, 0)::float AS total,
                0::float AS merch_cost,
                0::float AS shipping_cost,
                0::float AS profit_unidrop,
                COALESCE(tno.contact_name, '') AS buyer_name,
                COALESCE(tno.billing_city, '') AS buyer_city,
                COALESCE(tno.billing_province, '') AS buyer_province,
                COALESCE(tno.shipping_carrier, '') AS shipping_type,
                COALESCE(tno.label_downloaded, FALSE) AS label_downloaded
            FROM public.tienda_nube_orders tno
            JOIN public."User" u ON u.id = tno.user_id
            WHERE tno.created_at >= NOW() - make_interval(days => :days)
        """)

    if not parts:
        return {"items": [], "total": 0, "limit": limit, "offset": offset,
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    union_sql = " UNION ALL ".join(f"({p})" for p in parts)

    # Outer WHERE filters — values validated by FastAPI Literal types in the router
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
        # Map pipeline step labels to raw DB values
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
    params: dict = {"days": days, **extra_params}

    total = int(scalar(eng, f"SELECT COUNT(*) FROM ({union_sql}) x WHERE {where_sql}", params) or 0)

    rows_sql = f"""
        SELECT user_id, dropshipper_name, origen, "number", external_id, fecha::text,
               status, payment_status, shipping_status, total, merch_cost, shipping_cost,
               profit_unidrop, buyer_name, buyer_city, buyer_province, shipping_type, label_downloaded
        FROM ({union_sql}) x
        WHERE {where_sql}
        ORDER BY fecha DESC
        LIMIT :lim OFFSET :off
    """
    rows = q(eng, rows_sql, {**params, "lim": limit, "off": offset}) or []

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
