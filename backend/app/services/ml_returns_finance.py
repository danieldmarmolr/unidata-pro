"""Vista unificada de devoluciones de Mercado Libre para Finanzas.

Junta (todo en unidrop_api):
- mercado_libre_dev."MercadoLibreReturn"          — claim/devolucion (fuente principal)
- mercado_libre_dev."MercadoLibreReturnItem"      — lineas devueltas (sku, qty, monto)
- mercado_libre_dev."MercadoLibreReturnAttachment"— fotos del comprador
- mercado_libre_dev."MercadoLibreReturnHistory"   — timeline real de transiciones
- mercado_libre_dev."OrderMercadoLibre"           — number DROP-{dni}-N, foto, monto
- public."User"                                   — dropshipper (nombre, email, DNI)
- public."CustomerPaymentAccount"                 — CBU, alias, titular (para transferir)
- mercado_libre_dev."MercadoLibreUserAccount"     — nickname + flag "sin token"
- contabillium_dev."ContabilliumInvoice"          — link factura, numero
- ml_return_actions (Supabase)                    — estado interno Finanzas + audit

Tabs por `MercadoLibreReturn.status` (enum real del schema):
- NOTIFICADA             (128) — claim recien notificado por ML
- EN_CAMINO              (113) — mercaderia volviendo al deposito
- TRANSFERENCIA_PENDIENTE (60) — llego, falta plata al dropshipper (cola accionable)
- CERRADA                 (27) — caso terminado en ML

Mas pseudo-tabs derivados de finance_action (NO del schema ML):
- TRANSFERIDA_FZ — Finanzas marco como transferido
- RECHAZADA_FZ  — Finanzas rechazo
"""
from __future__ import annotations

import logging
from typing import Any

from app.db import ml_return_actions_db
from app.db.engines import get_engine
from app.services._utils import list_columns, q

log = logging.getLogger("unidata.ml_returns_finance")


# Buckets validos para el filtro de tab. Los 4 primeros vienen del enum status
# de MercadoLibreReturn; los 2 ultimos los gestionamos nosotros en Supabase.
ML_STATUSES = ("NOTIFICADA", "EN_CAMINO", "TRANSFERENCIA_PENDIENTE", "CERRADA")
FZ_STATUSES = ("transferida_fz", "rechazada_fz")
TABS = ("todas", *ML_STATUSES, *FZ_STATUSES)


def list_ml_returns(
    *,
    tab: str = "todas",
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """
    tab: NOTIFICADA | EN_CAMINO | TRANSFERENCIA_PENDIENTE | CERRADA | transferida_fz | rechazada_fz | todas
    search: prefix-match contra DNI, nombre, email, number, claim, tracking, sku, titulo item
    """
    eng = get_engine("unidrop")

    where: list[str] = []
    params: dict[str, Any] = {}
    # Si el tab es un status del enum ML, filtramos en SQL (mas barato).
    if tab in ML_STATUSES:
        where.append('r.status::text = :sql_status')
        params["sql_status"] = tab

    if search:
        params["s"] = f"%{search.strip()}%"
        params["s_exact"] = search.strip()
        where.append(
            "(u.dni ILIKE :s "
            "OR u.name ILIKE :s "
            "OR u.email ILIKE :s "
            "OR u.fantasy_name ILIKE :s "
            "OR o.\"number\" ILIKE :s "
            "OR r.\"orderId\"::text = :s_exact "
            "OR r.\"claimId\"::text = :s_exact "
            "OR r.\"returnTrackingCode\" ILIKE :s "
            "OR mla.nickname ILIKE :s)"
        )

    where_sql = (" AND " + " AND ".join(where)) if where else ""

    # 1) Query principal: MercadoLibreReturn + OML + User + MLA
    rows = q(eng, f"""
        SELECT
            r.id::int                                       AS return_pk,
            r."claimId"::bigint                             AS claim_id,
            r."returnId"::bigint                            AS return_id_ml,
            r."shipmentId"::bigint                          AS shipment_id,
            r."orderId"::bigint                             AS ml_order_id,
            r."mlAccountId"::int                            AS return_mla_id,
            r.status::text                                  AS ml_status,
            COALESCE(r.reason::text, '')                    AS reason,
            COALESCE(r."amountToRefund", 0)::float          AS amount_to_refund,
            COALESCE(r."returnTrackingCode", '')            AS tracking_code,
            COALESCE(r.carrier, '')                         AS carrier,
            COALESCE(r."discrepancyType"::text, '')         AS discrepancy_type,
            COALESCE(r."discrepancyNote", '')               AS discrepancy_note,
            COALESCE(r."discrepancyPhotoUrl", '')           AS discrepancy_photo,
            r."receivedAt"::text                            AS received_at,
            r."createdAt"::text                             AS created_at,
            r."updatedAt"::text                             AS updated_at,
            o."number"                                      AS order_number,
            COALESCE(o."totalAmount", 0)::float             AS order_total,
            COALESCE(o."status", '')                        AS order_status,
            o."dateCreated"::text                           AS order_date,
            o."userId"::bigint                              AS order_user_id,
            o."sellerId"::bigint                            AS order_seller_id,
            u.id::bigint                                    AS user_id,
            COALESCE(u.dni, '')                             AS dni,
            COALESCE(u.name, '')                            AS user_name,
            COALESCE(u.fantasy_name, '')                    AS fantasy_name,
            COALESCE(u.email, '')                           AS user_email,
            COALESCE(u.phone, '')                           AS user_phone,
            COALESCE(u.cuit, '')                            AS user_cuit,
            mla.id::bigint                                  AS mla_id,
            COALESCE(mla.nickname, '')                      AS mla_nickname,
            COALESCE(mla."requiresReauth", false)           AS sin_token,
            mla."expiresAt"::text                           AS token_expira
        FROM mercado_libre_dev."MercadoLibreReturn" r
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = r."orderId"
        LEFT JOIN public."User" u ON u.id = o."userId"
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
            ON mla.id = u."mercadoLibreAccountId"
        WHERE 1=1 {where_sql}
        ORDER BY r."createdAt" DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """, {**params, "limit": int(limit) + 200, "offset": int(offset)}) or []

    if not rows:
        return {"items": [], "count": 0, "total": 0, "counts_by_bucket": _empty_counts()}

    return_pks = list({int(r[0]) for r in rows if r[0] is not None})
    ml_order_ids = list({int(r[4]) for r in rows if r[4]})
    user_ids = list({int(r[23]) for r in rows if r[23]})

    # 2) Items devueltos por return (MercadoLibreReturnItem.returnId = MercadoLibreReturn.id)
    items_by_return: dict[int, list[dict]] = {}
    if return_pks:
        item_rows = q(eng, """
            SELECT "returnId"::int       AS rid,
                   "itemId"              AS item_id,
                   title,
                   COALESCE(sku, '')     AS sku,
                   quantity::int         AS qty,
                   COALESCE("unitPrice", 0)::float AS unit_price,
                   COALESCE(reason, '')  AS reason
            FROM mercado_libre_dev."MercadoLibreReturnItem"
            WHERE "returnId" = ANY(:ids)
            ORDER BY id ASC
        """, {"ids": return_pks}) or []
        for ir in item_rows:
            items_by_return.setdefault(int(ir[0]), []).append({
                "item_id": ir[1], "title": ir[2] or "", "sku": ir[3] or "",
                "qty": int(ir[4] or 1), "unit_price": round(float(ir[5] or 0), 2),
                "reason": ir[6] or "",
            })

    # 3) Attachments (fotos del comprador) por return
    attachments_by_return: dict[int, list[dict]] = {}
    if return_pks:
        att_rows = q(eng, """
            SELECT "returnId"::int  AS rid,
                   url,
                   type,
                   "createdAt"::text AS at
            FROM mercado_libre_dev."MercadoLibreReturnAttachment"
            WHERE "returnId" = ANY(:ids)
            ORDER BY id ASC
        """, {"ids": return_pks}) or []
        for ar in att_rows:
            attachments_by_return.setdefault(int(ar[0]), []).append({
                "url": ar[1], "type": ar[2] or "image", "created_at": ar[3],
            })

    # 4) Historial (timeline) por return
    history_by_return: dict[int, list[dict]] = {}
    if return_pks:
        hist_rows = q(eng, """
            SELECT "returnId"::int                  AS rid,
                   COALESCE("fromStatus"::text, '') AS from_status,
                   "toStatus"::text                 AS to_status,
                   "actorId"::int                   AS actor_id,
                   COALESCE(note, '')               AS note,
                   "createdAt"::text                AS at
            FROM mercado_libre_dev."MercadoLibreReturnHistory"
            WHERE "returnId" = ANY(:ids)
            ORDER BY "createdAt" ASC, id ASC
        """, {"ids": return_pks}) or []
        for hr in hist_rows:
            history_by_return.setdefault(int(hr[0]), []).append({
                "from_status": hr[1] or "",
                "to_status": hr[2] or "",
                "actor_id": int(hr[3]) if hr[3] is not None else None,
                "note": hr[4] or "",
                "at": hr[5],
            })

    # 5) Thumbnail/foto fallback desde OrderItemMercadoLibre (top 1 por order)
    thumb_by_oid: dict[int, str] = {}
    if ml_order_ids:
        thumb_rows = q(eng, """
            SELECT DISTINCT ON (oi."orderId")
                   oi."orderId"::bigint, COALESCE(oi.thumbnail, '')
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            WHERE oi."orderId" = ANY(:ids)
            ORDER BY oi."orderId", oi.id ASC
        """, {"ids": ml_order_ids}) or []
        thumb_by_oid = {int(r[0]): r[1] for r in thumb_rows if r[1]}

    # 6) Bank accounts del dropshipper
    bank_by_uid: dict[int, dict] = {}
    if user_ids:
        cpa_cols = list_columns(eng, "public", "CustomerPaymentAccount")
        bank_select = ['"userId"::bigint AS uid']
        bank_extra: list[str] = []
        for col in ("cbu", "cbu_alias", "alias", "bank_name", "account_owner"):
            if col in cpa_cols:
                bank_select.append(f'COALESCE("{col}", \'\') AS {col}')
                bank_extra.append(col)
        if "status" in cpa_cols:
            bank_select.append('COALESCE(status::text, \'\') AS status')
            bank_extra.append("status")
        bank_rows = q(eng, f"""
            SELECT DISTINCT ON ("userId") {', '.join(bank_select)}
            FROM public."CustomerPaymentAccount"
            WHERE "userId" = ANY(:ids)
            ORDER BY "userId", id ASC
        """, {"ids": user_ids}) or []
        for br in bank_rows:
            d: dict = {}
            for i, col in enumerate(bank_extra, 1):
                d[col] = br[i] if br[i] else None
            bank_by_uid[int(br[0])] = d

    # 7) Facturas Contabilium por order ID
    invoice_by_oid: dict[int, dict] = {}
    if ml_order_ids:
        ids_lit = ",".join(str(i) for i in ml_order_ids)
        inv_rows = q(eng, f"""
            SELECT "idVentaIntegracion"::bigint     AS oid,
                   COALESCE(id::text, '')           AS inv_id,
                   COALESCE("tipoFc", '')           AS tipo,
                   COALESCE("numeroComprobante",'') AS numero,
                   COALESCE("linkPublico", '')      AS link,
                   "fechaEmision"::text             AS fecha,
                   COALESCE(total, 0)::float        AS total
            FROM contabillium_dev."ContabilliumInvoice"
            WHERE "idVentaIntegracion" IN ({ids_lit})
        """) or []
        for ir in inv_rows:
            invoice_by_oid[int(ir[0])] = {
                "id": ir[1], "tipo": ir[2], "numero": ir[3],
                "link": ir[4], "fecha": ir[5], "total": round(float(ir[6]), 2),
            }

    # 8) Acciones de Finanzas (Supabase) por ml_order_id
    actions_by_key = ml_return_actions_db.list_actions(ml_order_ids)
    actions_by_oid: dict[int, dict] = {}
    for (oid, _idx), act in actions_by_key.items():
        if oid not in actions_by_oid:
            actions_by_oid[oid] = act

    # 9) Compose
    items: list[dict] = []
    for r in rows:
        return_pk = int(r[0])
        ml_order_id = int(r[4]) if r[4] else 0
        user_id = int(r[23]) if r[23] else None
        ml_status = r[6] or ""
        action = actions_by_oid.get(ml_order_id)

        finance_overlay = None
        if action and action.get("status") == "transferred":
            finance_overlay = "transferida_fz"
        elif action and action.get("status") == "rejected":
            finance_overlay = "rechazada_fz"

        items.append({
            "return_pk": return_pk,
            "claim_id": int(r[1]) if r[1] is not None else None,
            "return_id_ml": int(r[2]) if r[2] is not None else None,
            "shipment_id": int(r[3]) if r[3] is not None else None,
            "ml_order_id": ml_order_id,
            "return_mla_id": int(r[5]) if r[5] is not None else None,
            "ml_status": ml_status,
            "reason": r[7],
            "amount_to_refund": round(float(r[8] or 0), 2),
            "tracking_code": r[9],
            "carrier": r[10],
            "discrepancy_type": r[11],
            "discrepancy_note": r[12],
            "discrepancy_photo": r[13],
            "received_at": r[14],
            "created_at": r[15],
            "updated_at": r[16],
            "order_number": r[17] or "",
            "order_total": round(float(r[18] or 0), 2),
            "order_status": r[19],
            "order_date": r[20],
            "order_user_id": int(r[21]) if r[21] else None,
            "dropshipper": {
                "user_id": user_id,
                "dni": r[24] or "",
                "name": r[25] or "",
                "fantasy_name": r[26] or "",
                "email": r[27] or "",
                "phone": r[28] or "",
                "cuit": r[29] or "",
            },
            "ml_account": {
                "id": int(r[30]) if r[30] else None,
                "nickname": r[31] or "",
                "sin_token": bool(r[32]),
                "expires_at": r[33],
            },
            "return_items": items_by_return.get(return_pk, []),
            "attachments": attachments_by_return.get(return_pk, []),
            "history": history_by_return.get(return_pk, []),
            "thumbnail": thumb_by_oid.get(ml_order_id) or "",
            "bank": bank_by_uid.get(user_id) if user_id else None,
            "invoice": invoice_by_oid.get(ml_order_id),
            "finance_action": action,
            "finance_overlay": finance_overlay,
        })

    # 10) Filtro por finance_overlay (transferida_fz / rechazada_fz)
    if tab in FZ_STATUSES:
        items = [it for it in items if it["finance_overlay"] == tab]

    # 11) Counts por tab
    # Cuenta sobre el universo ya filtrado por search (status ML count incluye
    # solo lo del tab si tab in ML_STATUSES). Para los tabs ML, el count global
    # se recalcula con una query agregada barata.
    counts = _empty_counts()
    if tab in ML_STATUSES or tab in FZ_STATUSES or tab == "todas":
        # Counts globales por status ML (independiente del tab actual) — query barata
        status_counts = q(eng, """
            SELECT status::text, COUNT(*)::int
            FROM mercado_libre_dev."MercadoLibreReturn"
            GROUP BY 1
        """) or []
        for sc in status_counts:
            if sc[0] in ML_STATUSES:
                counts[sc[0]] = int(sc[1] or 0)
        counts["todas"] = sum(counts[s] for s in ML_STATUSES)
        # Overlay Finanzas counts (cruzando todas las actions con returns existentes)
        all_actions = ml_return_actions_db.list_actions(None)
        counts["transferida_fz"] = sum(
            1 for v in all_actions.values() if v.get("status") == "transferred"
        )
        counts["rechazada_fz"] = sum(
            1 for v in all_actions.values() if v.get("status") == "rejected"
        )

    return {
        "items": items[:limit],
        "count": len(items[:limit]),
        "total": len(items),
        "counts_by_bucket": counts,
    }


def _empty_counts() -> dict:
    return {
        "NOTIFICADA": 0,
        "EN_CAMINO": 0,
        "TRANSFERENCIA_PENDIENTE": 0,
        "CERRADA": 0,
        "transferida_fz": 0,
        "rechazada_fz": 0,
        "todas": 0,
    }


def get_ml_return(ml_order_id: int) -> dict | None:
    """Detalle de una devolucion ML especifica."""
    res = list_ml_returns(search=str(ml_order_id), tab="todas", limit=5)
    for it in res["items"]:
        if it["ml_order_id"] == int(ml_order_id):
            return it
    return None
