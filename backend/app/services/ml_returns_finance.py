"""Vista unificada de devoluciones de Mercado Libre para Finanzas.

Junta:
- mercado_libre_dev."MercadoLibreReturn"    — claim/devolucion (estado MELI)
- mercado_libre_dev."OrderMercadoLibre"     — number DROP-{dni}-N, monto, foto
- public."User"                             — dropshipper (nombre, email, DNI, fantasy)
- public."CustomerPaymentAccount"           — CBU, alias, titular (para transferir)
- mercado_libre_dev."MercadoLibreUserAccount" — nickname + flag "sin token"
- contabillium_dev."ContabilliumInvoice"    — link factura, numero
- ml_return_actions (Supabase)              — estado interno Finanzas + audit

El listing soporta tabs derivados de la combinacion entre estado del claim ML
(receivedAt) y la accion de Finanzas (status en Supabase):

 - en_camino           : la mercaderia todavia no llego (receivedAt IS NULL)
                         y Finanzas no transfirio ni rechazo
 - recibida_pendiente  : llego mercaderia (receivedAt IS NOT NULL) y Finanzas
                         no transfirio aun (= cola accionable)
 - transferida         : Finanzas transfirio
 - rechazada           : Finanzas rechazo (no se devuelve la plata)
 - todas               : sin filtro
"""
from __future__ import annotations

import logging
from typing import Any

from app.db import ml_return_actions_db
from app.db.engines import get_engine
from app.services._utils import list_columns, q

log = logging.getLogger("unidata.ml_returns_finance")


def _ml_action_state(rec_at: str | None, action: dict | None) -> str:
    """Deriva el bucket de tab desde receivedAt + action.status."""
    if action and action.get("status") == "transferred":
        return "transferida"
    if action and action.get("status") == "rejected":
        return "rechazada"
    if rec_at:
        return "recibida_pendiente"
    return "en_camino"


def list_ml_returns(
    *,
    tab: str = "todas",
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Devuelve devoluciones ML con datos para gestionar transferencias por Finanzas.

    tab: en_camino | recibida_pendiente | transferida | rechazada | todas
    search: prefix-match contra DNI, nombre, email, number, return id, tracking
    """
    eng = get_engine("unidrop")

    # Schema discovery defensivo - algunas instalaciones de unidrop_api tienen mas
    # columnas opcionales en MercadoLibreReturn (notif, externalClaimId, etc).
    ret_cols = list_columns(eng, "mercado_libre_dev", "MercadoLibreReturn")

    # Columnas opcionales: las pedimos solo si existen en el schema actual
    extra_selects = []
    if "externalClaimId" in ret_cols:
        extra_selects.append('r."externalClaimId"::text AS external_claim_id')
    elif "claimId" in ret_cols:
        extra_selects.append('r."claimId"::text AS external_claim_id')
    else:
        extra_selects.append("NULL::text AS external_claim_id")

    if "notifiedAt" in ret_cols:
        extra_selects.append('r."notifiedAt"::text AS notified_at')
    else:
        extra_selects.append("NULL::text AS notified_at")

    extra_select_sql = (", " + ", ".join(extra_selects)) if extra_selects else ""

    where: list[str] = []
    params: dict[str, Any] = {}
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
            "OR r.\"returnTrackingCode\" ILIKE :s "
            "OR mla.nickname ILIKE :s)"
        )

    where_sql = (" AND " + " AND ".join(where)) if where else ""

    # 1) Query principal: junta todo lo que vive en unidrop_api
    rows = q(eng, f"""
        SELECT
            r.id::bigint                                    AS return_id,
            r."orderId"::bigint                             AS ml_order_id,
            COALESCE(r.status, '')                          AS ml_status,
            COALESCE(r.reason, '')                          AS reason,
            COALESCE(r."amountToRefund", 0)::float          AS amount_to_refund,
            COALESCE(r."returnTrackingCode", '')            AS tracking_code,
            COALESCE(r.carrier, '')                         AS carrier,
            COALESCE(r."discrepancyType", '')               AS discrepancy_type,
            COALESCE(r."discrepancyNote", '')               AS discrepancy_note,
            COALESCE(r."discrepancyPhotoUrl", '')           AS discrepancy_photo,
            r."receivedAt"::text                            AS received_at,
            r."createdAt"::text                             AS created_at,
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
            {extra_select_sql}
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
        return {"items": [], "count": 0, "total": 0}

    # 2) Items / foto / SKU — top item por order
    ml_order_ids = list({int(r[1]) for r in rows if r[1]})
    items_by_oid: dict[int, dict] = {}
    if ml_order_ids:
        item_rows = q(eng, """
            SELECT DISTINCT ON (oi."orderId")
                   oi."orderId"::bigint                 AS oid,
                   COALESCE(oi."sellerSku", '')         AS sku,
                   COALESCE(oi.title, '')               AS title,
                   COALESCE(oi.quantity, 1)::int        AS qty,
                   COALESCE(oi."unitPrice", 0)::float   AS unit_price,
                   COALESCE(oi.thumbnail, '')           AS thumbnail
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            WHERE oi."orderId" = ANY(:ids)
            ORDER BY oi."orderId", oi.id ASC
        """, {"ids": ml_order_ids}) or []
        items_by_oid = {int(r[0]): {
            "sku": r[1], "title": r[2], "qty": int(r[3] or 1),
            "unit_price": float(r[4] or 0), "thumbnail": r[5],
        } for r in item_rows}

    # 3) Datos bancarios (CustomerPaymentAccount) por userId
    user_ids = list({int(r[18]) for r in rows if r[18]})
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

    # 4) Facturas Contabilium por order ID (linkPublico, numero, tipo, total, fecha)
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

    # 5) Acciones de Finanzas desde Supabase
    actions_by_key = ml_return_actions_db.list_actions(ml_order_ids)
    # Para indexar por (ml_order_id, return_idx). El return_idx aca lo dejamos en 1
    # porque ahora no tenemos un mapeo 1:N tracking (un order = un return en la
    # practica). Si en el futuro queremos soportar multiples returns por order,
    # se cambia el index aca y en la tabla.
    actions_by_oid: dict[int, dict] = {}
    for (oid, _idx), act in actions_by_key.items():
        if oid not in actions_by_oid:
            actions_by_oid[oid] = act

    # 6) Compose
    items: list[dict] = []
    for r in rows:
        ml_order_id = int(r[1]) if r[1] else 0
        user_id = int(r[18]) if r[18] else None
        received_at = r[10]
        action = actions_by_oid.get(ml_order_id)
        bucket = _ml_action_state(received_at, action)

        items.append({
            "return_id": int(r[0]),
            "ml_order_id": ml_order_id,
            "ml_status": r[2],
            "reason": r[3],
            "amount_to_refund": round(float(r[4] or 0), 2),
            "tracking_code": r[5],
            "carrier": r[6],
            "discrepancy_type": r[7],
            "discrepancy_note": r[8],
            "discrepancy_photo": r[9],
            "received_at": received_at,
            "created_at": r[11],
            "order_number": r[12] or "",
            "order_total": round(float(r[13] or 0), 2),
            "order_status": r[14],
            "order_date": r[15],
            "order_user_id": int(r[16]) if r[16] else None,
            "dropshipper": {
                "user_id": user_id,
                "dni": r[19] or "",
                "name": r[20] or "",
                "fantasy_name": r[21] or "",
                "email": r[22] or "",
                "phone": r[23] or "",
                "cuit": r[24] or "",
            },
            "ml_account": {
                "id": int(r[25]) if r[25] else None,
                "nickname": r[26] or "",
                "sin_token": bool(r[27]),
                "expires_at": r[28],
            },
            "external_claim_id": r[29] if len(r) > 29 else None,
            "notified_at": r[30] if len(r) > 30 else None,
            "product": items_by_oid.get(ml_order_id),
            "bank": bank_by_uid.get(user_id) if user_id else None,
            "invoice": invoice_by_oid.get(ml_order_id),
            "finance_action": action,
            "bucket": bucket,
        })

    # 7) Filtro por tab (lo hacemos en Python despues de combinar todo)
    if tab in ("en_camino", "recibida_pendiente", "transferida", "rechazada"):
        items = [it for it in items if it["bucket"] == tab]

    # 8) Counts por bucket (sobre el universo de search, no del tab actual)
    # Para los counters de tabs (UI) traemos los totales por bucket.
    counts = {
        "en_camino": 0,
        "recibida_pendiente": 0,
        "transferida": 0,
        "rechazada": 0,
        "todas": len(rows),
    }
    for r in rows:
        ml_oid = int(r[1]) if r[1] else 0
        act = actions_by_oid.get(ml_oid)
        b = _ml_action_state(r[10], act)
        counts[b] = counts.get(b, 0) + 1

    return {
        "items": items[:limit],
        "count": len(items[:limit]),
        "total": len(items),
        "counts_by_bucket": counts,
    }


def get_ml_return(ml_order_id: int) -> dict | None:
    """Detalle de una devolucion ML especifica. Usa la misma query del listing
    filtrada por orderId."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT r."orderId"::text FROM mercado_libre_dev."MercadoLibreReturn" r
        WHERE r."orderId" = :oid LIMIT 1
    """, {"oid": int(ml_order_id)})
    if not rows:
        return None
    # Reusamos list con search en order ID
    res = list_ml_returns(search=str(ml_order_id), tab="todas", limit=5)
    for it in res["items"]:
        if it["ml_order_id"] == int(ml_order_id):
            return it
    return None
