"""Vista unificada de devoluciones de Mercado Libre para Finanzas.

Junta (todo en unidrop_api):
- mercado_libre_dev."MercadoLibreReturn"          — claim/devolucion (fuente principal)
- mercado_libre_dev."MercadoLibreReturnItem"      — lineas devueltas (sku, qty, monto)
- mercado_libre_dev."MercadoLibreReturnAttachment"— fotos del comprador
- mercado_libre_dev."MercadoLibreReturnHistory"   — timeline real de transiciones
- mercado_libre_dev."OrderMercadoLibre"           — number DROP-{dni}-N, foto, monto
- public."User"                                   — dropshipper (nombre, email, DNI)
- cresium."UserBankAccount"                       — CBU/CVU/alias/titular REAL del dropshipper (destino del reembolso; NO la CVU de cobro TaloPay)
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
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """
    tab: NOTIFICADA | EN_CAMINO | TRANSFERENCIA_PENDIENTE | CERRADA | transferida_fz | rechazada_fz | todas
    search: prefix-match contra DNI, nombre, email, number, claim, tracking, sku, titulo item
    from_date / to_date: 'YYYY-MM-DD'. Filtra r."createdAt" entre los rangos.
    """
    eng = get_engine("unidrop")

    # Schema discovery para buyer_* (varia entre instalaciones)
    oml_cols = list_columns(eng, "mercado_libre_dev", "OrderMercadoLibre")
    buyer_selects: list[str] = []
    buyer_keys: list[str] = []  # nombres en el dict de output
    for src, dst in [
        ("buyer_name", "name"),
        ("buyer_first_name", "first_name"),
        ("buyer_last_name", "last_name"),
        ("buyer_nickname", "nickname"),
        ("buyer_email", "email"),
        ("buyer_phone", "phone"),
        ("buyer_dni", "dni"),
        ("buyer_id", "id"),
    ]:
        if src in oml_cols:
            buyer_selects.append(f'COALESCE(o."{src}"::text, \'\') AS buyer_{dst}')
            buyer_keys.append(dst)
    buyer_select_sql = (", " + ", ".join(buyer_selects)) if buyer_selects else ""

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
    if from_date:
        where.append('r."createdAt" >= :from_date::date')
        params["from_date"] = from_date
    if to_date:
        where.append('r."createdAt" < (:to_date::date + INTERVAL \'1 day\')')
        params["to_date"] = to_date

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
            {buyer_select_sql}
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
    # + LEFT JOIN con OrderItemMercadoLibre para sacar el unitCost (costo dropper).
    # OrderItemMercadoLibre matchea por (orderId, itemId) → cruzamos via Return.orderId.
    items_by_return: dict[int, list[dict]] = {}
    if return_pks:
        # Detect unit cost column - varia en algunas instalaciones
        oi_cols = list_columns(eng, "mercado_libre_dev", "OrderItemMercadoLibre")
        cost_col = next(
            (c for c in ["unitCost", "cost", "merchandiseCost", "merchandise_cost"] if c in oi_cols),
            None,
        )
        cost_select = f'COALESCE(oi."{cost_col}", 0)::float AS unit_cost' if cost_col else "0::float AS unit_cost"
        thumb_select = 'COALESCE(oi.thumbnail, \'\') AS thumb' if "thumbnail" in oi_cols else "''::text AS thumb"

        item_rows = q(eng, f"""
            SELECT mri."returnId"::int       AS rid,
                   mri."itemId"              AS item_id,
                   mri.title,
                   COALESCE(mri.sku, '')     AS sku,
                   mri.quantity::int         AS qty,
                   COALESCE(mri."unitPrice", 0)::float AS unit_price,
                   {cost_select},
                   {thumb_select},
                   COALESCE(mri.reason, '')  AS reason
            FROM mercado_libre_dev."MercadoLibreReturnItem" mri
            LEFT JOIN mercado_libre_dev."MercadoLibreReturn" r ON r.id = mri."returnId"
            LEFT JOIN mercado_libre_dev."OrderItemMercadoLibre" oi
                ON oi."orderId" = r."orderId" AND oi."itemId"::text = mri."itemId"::text
            WHERE mri."returnId" = ANY(:ids)
            ORDER BY mri.id ASC
        """, {"ids": return_pks}) or []
        for ir in item_rows:
            items_by_return.setdefault(int(ir[0]), []).append({
                "item_id": ir[1], "title": ir[2] or "", "sku": ir[3] or "",
                "qty": int(ir[4] or 1),
                "unit_price": round(float(ir[5] or 0), 2),
                "unit_cost": round(float(ir[6] or 0), 2),
                "thumbnail": ir[7] or "",
                "reason": ir[8] or "",
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

    # 6) Cuenta bancaria REAL del dropshipper para el reembolso.
    # Fuente: cresium."UserBankAccount" (modulo de payouts de Unidrop) — cbu /
    # cvu / alias / bankName / holderName PERSONALES que el dropper cargo para
    # cobrar. NO usamos public."CustomerPaymentAccount": esa es la CVU de COBRO
    # de TaloPay (alias autogenerado `unidrop.*`, titularizada bajo el PSP), y
    # copiarla manda la transferencia a "Fox Talo Pay" en vez del dropshipper.
    # Si no hay banco real cargado (la mayoria), needs_bank=True y Finanzas le
    # pide los datos por WhatsApp en vez de transferir a la cuenta equivocada.
    # Prioridad: cuenta con CBU/CVU > default > mas reciente.
    bank_by_uid: dict[int, dict] = {}
    if user_ids:
        bank_rows = q(eng, """
            SELECT DISTINCT ON ("userId")
                   "userId"::bigint            AS uid,
                   COALESCE(cbu, '')           AS cbu,
                   COALESCE(cvu, '')           AS cvu,
                   COALESCE(alias, '')         AS alias,
                   COALESCE("bankName", '')    AS bank_name,
                   COALESCE("holderName", '')  AS holder_name,
                   COALESCE("holderTaxId", '') AS holder_tax_id,
                   COALESCE("isDefault", false) AS is_default
            FROM cresium."UserBankAccount"
            WHERE "userId" = ANY(:ids)
            ORDER BY "userId",
                     (CASE WHEN COALESCE(TRIM(cbu), '') <> '' OR COALESCE(TRIM(cvu), '') <> '' THEN 0
                           WHEN COALESCE(TRIM(alias), '') <> '' THEN 1
                           ELSE 2 END),
                     "isDefault" DESC NULLS LAST,
                     "updatedAt" DESC NULLS LAST,
                     id DESC
        """, {"ids": user_ids}) or []
        for br in bank_rows:
            cbu = (br[1] or "").strip()
            cvu = (br[2] or "").strip()
            alias = (br[3] or "").strip()
            bank_by_uid[int(br[0])] = {
                "cbu": cbu or None,
                "cvu": cvu or None,
                "alias": alias or None,
                "bank_name": (br[4] or "").strip() or None,
                "holder_name": (br[5] or "").strip() or None,
                "holder_tax_id": (br[6] or "").strip() or None,
                "is_default": bool(br[7]),
                # Con alias alcanza para transferir → solo pedimos datos si esta TODO vacio.
                "needs_bank": not (cbu or cvu or alias),
            }

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

    # 9) Compose — buyer info viene al final del row (despues de token_expira)
    # El offset para buyer fields empieza en 34 (los selects fijos son 0..33).
    BUYER_BASE_IDX = 34
    items: list[dict] = []
    for r in rows:
        return_pk = int(r[0])
        ml_order_id = int(r[4]) if r[4] else 0
        user_id = int(r[23]) if r[23] else None
        ml_status = r[6] or ""
        action = actions_by_oid.get(ml_order_id)

        buyer: dict = {}
        for i, key in enumerate(buyer_keys):
            v = r[BUYER_BASE_IDX + i] if len(r) > BUYER_BASE_IDX + i else None
            buyer[key] = v if v else None
        # display name: combinacion comun cuando hay first_name + last_name
        if not buyer.get("name") and (buyer.get("first_name") or buyer.get("last_name")):
            buyer["name"] = " ".join(x for x in [buyer.get("first_name"), buyer.get("last_name")] if x)

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
            "buyer": buyer if buyer else None,
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

    # 11) Counts por tab — respetan search + fechas, pero NO el tab actual
    # (asi el usuario ve cuanto hay en cada bucket de su busqueda actual).
    counts = _empty_counts()
    # WHERE solo con search + fechas (sin sql_status)
    count_where: list[str] = []
    count_params: dict[str, Any] = {}
    if search:
        count_params["s"] = f"%{search.strip()}%"
        count_params["s_exact"] = search.strip()
        count_where.append(
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
    if from_date:
        count_where.append('r."createdAt" >= :from_date::date')
        count_params["from_date"] = from_date
    if to_date:
        count_where.append('r."createdAt" < (:to_date::date + INTERVAL \'1 day\')')
        count_params["to_date"] = to_date
    count_where_sql = (" AND " + " AND ".join(count_where)) if count_where else ""

    status_counts = q(eng, f"""
        SELECT r.status::text AS s, COUNT(*)::int AS n
        FROM mercado_libre_dev."MercadoLibreReturn" r
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = r."orderId"
        LEFT JOIN public."User" u ON u.id = o."userId"
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
            ON mla.id = u."mercadoLibreAccountId"
        WHERE 1=1 {count_where_sql}
        GROUP BY 1
    """, count_params) or []
    for sc in status_counts:
        if sc[0] in ML_STATUSES:
            counts[sc[0]] = int(sc[1] or 0)
    counts["todas"] = sum(counts[s] for s in ML_STATUSES)
    # Overlay Finanzas counts: contar SOLO actions cuyo return cae en el set
    # del filtro actual (cruzar action.ml_order_id con los ml_order_ids
    # visibles). Si no hay filtro extra (no search/fechas), contamos todo.
    if search or from_date or to_date:
        # Necesitamos saber que ml_order_ids matchean el filtro
        oid_rows = q(eng, f"""
            SELECT r."orderId"::bigint AS oid
            FROM mercado_libre_dev."MercadoLibreReturn" r
            LEFT JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = r."orderId"
            LEFT JOIN public."User" u ON u.id = o."userId"
            LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
                ON mla.id = u."mercadoLibreAccountId"
            WHERE 1=1 {count_where_sql}
        """, count_params) or []
        filtered_oids = {int(r[0]) for r in oid_rows if r[0]}
        scoped_actions = ml_return_actions_db.list_actions(list(filtered_oids))
    else:
        scoped_actions = ml_return_actions_db.list_actions(None)
    counts["transferida_fz"] = sum(
        1 for v in scoped_actions.values() if v.get("status") == "transferred"
    )
    counts["rechazada_fz"] = sum(
        1 for v in scoped_actions.values() if v.get("status") == "rejected"
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
