"""
Vista global de ordenes Unidrop: ML + TN de todos los dropshippers, paginada.
Respeta el filtro de fecha del topbar (period + custom range).

Estrategia: query independiente por canal (ML / TN), unir resultados en Python.
Si una falla, la otra sigue (mas robusto que UNION ALL).
"""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, DBAPIError

from app.db.engines import get_engine
from app.services._utils import resolve_window

log = logging.getLogger("unidata.dashboards")


def _exec_safe(engine, sql: str, params: dict | None = None) -> list:
    """Ejecuta y devuelve filas. En caso de error, loggea el error completo
    (no como warning silencioso) para facilitar debugging."""
    try:
        with engine.connect() as c:
            return list(c.execute(text(sql), params or {}).all())
    except Exception as e:
        # Loggear el ERROR completo (no warning) para diagnostico
        log.error("orders_global SQL failed: %s :: %s", str(e)[:500], sql.strip()[:200])
        return []


def _fetch_ml(eng, from_ts: dt.datetime, to_ts: dt.datetime) -> list[dict]:
    """Fetch ML orders en el rango. Solo orders DROP-*.
    Schema OML real: NO existe paymentStatus ni shippingStatus.
    Usamos status + tags (array) + label_downloaded para derivar estado."""
    sql = """
        SELECT
            COALESCE(u.id, 0)::int                                                AS user_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar')  AS dropshipper_name,
            COALESCE(NULLIF(o."number", ''), o.id::text)                          AS "number",
            o.id::text                                                            AS external_id,
            o."dateCreated"::text                                                 AS fecha,
            COALESCE(o."status"::text, '')                                        AS status,
            COALESCE(o."totalAmount", 0)::float                                   AS total,
            COALESCE(o."merchandise_cost", 0)::float                              AS merch_cost,
            COALESCE(o."shipping_cost", 0)::float                                 AS shipping_cost,
            COALESCE(o."profit_for_subscription", 0)::float                       AS profit_unidrop,
            COALESCE(o."buyer_name", '')                                          AS buyer_name,
            COALESCE(NULLIF(o."shipping_carrier", ''),
                     o."shipping_option_reference", '')                           AS shipping_type,
            COALESCE(o."label_downloaded", FALSE)                                 AS label_downloaded,
            COALESCE(o."cancel_by_unidrop", FALSE)                                AS cancel_by_unidrop,
            COALESCE(o.tags, ARRAY[]::text[])                                     AS tags
        FROM mercado_libre_dev."OrderMercadoLibre" o
        LEFT JOIN public."User" u
             ON u.dni::text = split_part(o."number", '-', 2)
        WHERE o."number" LIKE 'DROP-%'
          AND o."dateCreated" >= :from_ts
          AND o."dateCreated" <  :to_ts
        ORDER BY o."dateCreated" DESC NULLS LAST
    """
    rows = _exec_safe(eng, sql, {"from_ts": from_ts, "to_ts": to_ts})
    out = []
    for r in rows:
        tags = list(r[14] or [])
        status_raw = (r[5] or "").lower()
        # Derivar payment_status / shipping_status desde status + tags
        payment_status = "paid" if status_raw == "paid" or "paid" in tags else status_raw
        shipping_status = ""
        if "delivered" in tags:
            shipping_status = "delivered"
        elif "shipped" in tags:
            shipping_status = "shipped"
        elif "ready_to_print" in tags or "ready_to_ship" in tags:
            shipping_status = "ready_to_ship"
        out.append({
            "user_id": int(r[0]) if r[0] else 0,
            "dropshipper_name": r[1] or "",
            "origen": "ml",
            "number": r[2] or "",
            "external_id": r[3] or "",
            "fecha": str(r[4]) if r[4] else "",
            "status": r[5] or "",
            "payment_status": payment_status,
            "shipping_status": shipping_status,
            "total": round(float(r[6] or 0), 2),
            "merch_cost": round(float(r[7] or 0), 2),
            "shipping_cost": round(float(r[8] or 0), 2),
            "profit_unidrop": round(float(r[9] or 0), 2),
            "buyer_name": r[10] or "",
            "shipping_type": r[11] or "",
            "label_downloaded": bool(r[12]),
            "cancel_by_unidrop": bool(r[13]),
            "buyer_city": "",
            "buyer_province": "",
            "is_combo": False,
        })
    log.info("orders_global ML fetched: %d rows", len(out))
    return out


def _fetch_tn(eng, from_ts: dt.datetime, to_ts: dt.datetime) -> list[dict]:
    """Fetch TN orders en el rango.
    Schema TN real: NO existe shipping_cost (usar shipping_price o shipping_option_cost).
    NO existe contact_name (usar contact_identification o shipping_address->>'name').
    """
    sql = """
        SELECT
            COALESCE(u.id, 0)::int                                                AS user_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'Sin asignar')  AS dropshipper_name,
            COALESCE(NULLIF(tno."number", ''), tno.tienda_nube_id::text)          AS "number",
            tno.tienda_nube_id::text                                              AS external_id,
            tno.created_at::text                                                  AS fecha,
            COALESCE(tno.payment_status::text, '')                                AS payment_status,
            COALESCE(tno.shipping_status::text, '')                               AS shipping_status,
            COALESCE(tno.total, 0)::float                                         AS total,
            GREATEST(COALESCE(tno.total_cost, 0)::float
                     - COALESCE(tno.shipping_price, tno.shipping_option_cost, 0)::float,
                     0)                                                            AS merch_cost,
            COALESCE(tno.shipping_price, tno.shipping_option_cost, 0)::float       AS shipping_cost,
            COALESCE(NULLIF(tno.shipping_address->>'name', ''),
                     tno.contact_identification, '')                              AS buyer_name,
            COALESCE(tno.shipping_option, '')                                     AS shipping_type,
            COALESCE(tno.label_downloaded, FALSE)                                 AS label_downloaded,
            COALESCE(tno.cancel_by_unidrop, FALSE)                                AS cancel_by_unidrop
        FROM public.tienda_nube_orders tno
        LEFT JOIN public."User" u ON u.id = tno.user_id
        WHERE tno.created_at >= :from_ts
          AND tno.created_at <  :to_ts
        ORDER BY tno.created_at DESC NULLS LAST
    """
    rows = _exec_safe(eng, sql, {"from_ts": from_ts, "to_ts": to_ts})
    out = []
    for r in rows:
        out.append({
            "user_id": int(r[0]) if r[0] else 0,
            "dropshipper_name": r[1] or "",
            "origen": "tn",
            "number": r[2] or "",
            "external_id": r[3] or "",
            "fecha": str(r[4]) if r[4] else "",
            "status": r[5] or "",
            "payment_status": r[5] or "",
            "shipping_status": r[6] or "",
            "total": round(float(r[7] or 0), 2),
            "merch_cost": round(float(r[8] or 0), 2),
            "shipping_cost": round(float(r[9] or 0), 2),
            "profit_unidrop": 0.0,
            "buyer_name": r[10] or "",
            "shipping_type": r[11] or "",
            "label_downloaded": bool(r[12]),
            "cancel_by_unidrop": bool(r[13]),
            "buyer_city": "",
            "buyer_province": "",
            "is_combo": False,
        })
    log.info("orders_global TN fetched: %d rows", len(out))
    return out


def _enrich_combo_ml(eng, items: list[dict]) -> None:
    """Marca is_combo=True para ML orders cuyos items contienen orderType='COMBO'."""
    ml_ids = [str(it["external_id"]) for it in items if it["origen"] == "ml" and it["external_id"]]
    if not ml_ids:
        return
    ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in ml_ids) + "]::text[]"
    sql = f"""
        SELECT DISTINCT oi."orderId"::text AS order_ext_id
        FROM mercado_libre_dev."OrderItemMercadoLibre" oi
        WHERE oi."orderId"::text = ANY({ids_lit})
          AND UPPER(COALESCE(oi."orderType"::text, '')) = 'COMBO'
    """
    rows = _exec_safe(eng, sql)
    combo_set = {r[0] for r in rows if r[0]}
    for it in items:
        if it["origen"] == "ml" and it["external_id"] in combo_set:
            it["is_combo"] = True


def _enrich_combo_tn(eng, items: list[dict]) -> None:
    """Marca is_combo=True para TN orders cuyos items contienen order_type='COMBO'."""
    tn_ids = [str(it["external_id"]) for it in items if it["origen"] == "tn" and it["external_id"]]
    if not tn_ids:
        return
    ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in tn_ids) + "]::text[]"
    sql = f"""
        SELECT DISTINCT toi.tienda_nube_order_id::text AS order_ext_id
        FROM public.tienda_nube_order_items toi
        WHERE toi.tienda_nube_order_id::text = ANY({ids_lit})
          AND UPPER(COALESCE(toi.order_type::text, '')) = 'COMBO'
    """
    rows = _exec_safe(eng, sql)
    combo_set = {r[0] for r in rows if r[0]}
    for it in items:
        if it["origen"] == "tn" and it["external_id"] in combo_set:
            it["is_combo"] = True


def _enrich_address_ml(eng, items: list[dict]) -> None:
    """Saca ciudad/provincia del shipping_address_detail JSONB para ML orders."""
    ml_ids = [str(it["external_id"]) for it in items if it["origen"] == "ml" and it["external_id"]]
    if not ml_ids:
        return
    ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in ml_ids) + "]::text[]"
    sql = f"""
        SELECT id::text,
               COALESCE(shipping_address_detail->>'city', ''),
               COALESCE(shipping_address_detail->>'state', '')
        FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE id::text = ANY({ids_lit})
    """
    rows = _exec_safe(eng, sql)
    addr_map = {r[0]: (r[1] or "", r[2] or "") for r in rows if r[0]}
    for it in items:
        if it["origen"] == "ml" and it["external_id"] in addr_map:
            city, prov = addr_map[it["external_id"]]
            it["buyer_city"] = city
            it["buyer_province"] = prov


def _enrich_address_tn(eng, items: list[dict]) -> None:
    """Saca ciudad/provincia del shipping_address JSONB para TN orders."""
    tn_ids = [str(it["external_id"]) for it in items if it["origen"] == "tn" and it["external_id"]]
    if not tn_ids:
        return
    ids_lit = "ARRAY[" + ",".join("'" + i + "'" for i in tn_ids) + "]::text[]"
    sql = f"""
        SELECT tienda_nube_id::text,
               COALESCE(shipping_address->>'city', ''),
               COALESCE(shipping_address->>'province',
                        shipping_address->>'state', '')
        FROM public.tienda_nube_orders
        WHERE tienda_nube_id::text = ANY({ids_lit})
    """
    rows = _exec_safe(eng, sql)
    addr_map = {r[0]: (r[1] or "", r[2] or "") for r in rows if r[0]}
    for it in items:
        if it["origen"] == "tn" and it["external_id"] in addr_map:
            city, prov = addr_map[it["external_id"]]
            it["buyer_city"] = city
            it["buyer_province"] = prov


def orders_global_unidrop(
    period: str = "30d",
    channel: str = "all",
    shipping_type: str | None = None,
    status_filter: str | None = None,
    combo_filter: str | None = None,
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

    log.info("orders_global_unidrop start period=%s channel=%s window=%s→%s",
             period, channel, from_ts.isoformat(), to_ts.isoformat())

    include_ml = channel in ("all", "ml")
    include_tn = channel in ("all", "tn")

    all_items: list[dict] = []
    if include_ml:
        all_items.extend(_fetch_ml(eng, from_ts, to_ts))
    if include_tn:
        all_items.extend(_fetch_tn(eng, from_ts, to_ts))

    log.info("orders_global_unidrop pre-enrich: ml=%d tn=%d total=%d",
             sum(1 for i in all_items if i["origen"] == "ml"),
             sum(1 for i in all_items if i["origen"] == "tn"),
             len(all_items))

    # Enriquecer is_combo + city/province (defensivo, si falla seguimos sin esos campos)
    if all_items:
        try:
            _enrich_combo_ml(eng, all_items)
        except Exception as e:
            log.error("orders_global combo_ml enrich failed: %s", str(e)[:200])
        try:
            _enrich_combo_tn(eng, all_items)
        except Exception as e:
            log.error("orders_global combo_tn enrich failed: %s", str(e)[:200])
        try:
            _enrich_address_ml(eng, all_items)
        except Exception as e:
            log.error("orders_global address_ml enrich failed: %s", str(e)[:200])
        try:
            _enrich_address_tn(eng, all_items)
        except Exception as e:
            log.error("orders_global address_tn enrich failed: %s", str(e)[:200])

    # Filtrar in-memory (lo hicimos antes en SQL pero ahora es por simplicidad)
    def matches(it: dict) -> bool:
        if shipping_type and shipping_type.lower() not in ("all", ""):
            st = shipping_type.lower()
            t = (it.get("shipping_type") or "").lower()
            if st in ("pr", "punto"):
                if not ("pr" in t or "punto" in t or "drop_off" in t):
                    return False
            elif st in ("flex", "flexi"):
                if not ("flexi" in t or "self" in t or t == "flex"):
                    return False
            elif st == "full":
                if "full" not in t:
                    return False
            elif st == "oca":
                if "oca" not in t:
                    return False
            elif st in ("lightdata", "unifast"):
                if not ("lightdata" in t or "unifast" in t):
                    return False
            elif st == "andreani":
                if "andreani" not in t:
                    return False
        if status_filter and status_filter.lower() not in ("all", ""):
            sf = status_filter.lower()
            STATUS_MAP = {
                "paid": "paid", "confirmed": "confirmed", "shipped": "shipped",
                "delivered": "delivered", "cancelled": "cancel",
            }
            raw = STATUS_MAP.get(sf, sf)
            if not (raw in (it.get("status") or "").lower()
                    or raw in (it.get("payment_status") or "").lower()
                    or raw in (it.get("shipping_status") or "").lower()):
                return False
        if combo_filter and combo_filter.lower() in ("combo", "ind", "individual"):
            if combo_filter.lower() == "combo" and not it.get("is_combo"):
                return False
            if combo_filter.lower() in ("ind", "individual") and it.get("is_combo"):
                return False
        if search_drop and search_drop.strip():
            if search_drop.strip().lower() not in (it.get("dropshipper_name") or "").lower():
                return False
        if user_id:
            if int(it.get("user_id") or 0) != int(user_id):
                return False
        return True

    filtered = [it for it in all_items if matches(it)]

    total = len(filtered)
    total_ml = sum(1 for i in filtered if i["origen"] == "ml")
    total_tn = sum(1 for i in filtered if i["origen"] == "tn")
    combo_count = sum(1 for i in filtered if i.get("is_combo"))
    ind_count = total - combo_count

    # Sort y paginacion
    filtered.sort(key=lambda x: x.get("fecha") or "", reverse=True)
    paged = filtered[offset:offset + limit]

    log.info("orders_global_unidrop done: total=%d (ml=%d tn=%d combo=%d ind=%d) returned=%d",
             total, total_ml, total_tn, combo_count, ind_count, len(paged))

    return {
        "items": paged,
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
