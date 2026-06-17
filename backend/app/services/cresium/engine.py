"""Orquestador del motor de payouts Cresium. Port de RefundOrdersService +
CresiumRefundDispatcherService + applyEvent de Unidrop-Back.

Coordina: verificacion anti-fraude de cuentas, materializacion de orders con
snapshot, los 2 calls salientes (make-a-transfer + signature-request), y la
aplicacion idempotente de eventos terminales (webhook/polling). En SUCCESS,
auto-marca la devolucion como transferida en la tabla de tracking existente
(ml_return_actions / subscription_refund_requests).

Mapeo de la clasificacion de status (identico a Unidrop):
  SUCCESS  : SUCCESS, COMPLETED, WITHDRAWAL_SUCCESS
  FAILED   : FAILED, REJECTED, WITHDRAWAL_FAILED, ERROR
  CANCELED : CANCELED, CANCELLED
  resto    : intermedio (PENDING/PROCESSING) -> solo se registra, sin transicion
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

from app.db import cresium_payouts_db as db
from app.db import ml_return_actions_db
from app.db import refund_requests_db
from app.services.cresium import bank_address, config, transfer

log = logging.getLogger("unidata.cresium.engine")

SYSTEM_USER_ID = 0
SYSTEM_EMAIL = "cresium-engine@unidata"

SUCCESS_STATUSES = {"SUCCESS", "COMPLETED", "WITHDRAWAL_SUCCESS"}
FAILED_STATUSES = {"FAILED", "REJECTED", "WITHDRAWAL_FAILED", "ERROR"}
CANCELED_STATUSES = {"CANCELED", "CANCELLED"}

# Mensaje generico (no filtra el nombre del env var faltante).
_NOT_READY_MSG = (
    "Cresium no esta listo: revisar FEATURE_CRESIUM_REFUNDS_ENABLED=true y que "
    "esten cargadas las credenciales CRESIUM_*."
)


class CresiumDisabledError(Exception):
    """Cresium deshabilitado o sin credenciales — no se puede llamar a Cresium."""


# ─── Verificacion de cuenta ──────────────────────────────────────────────────

def verify_account(*, dropshipper_user_id: int, value: str, tax_id: str) -> dict:
    """Resuelve un CBU/CVU/alias contra Cresium, valida el match anti-fraude
    (taxId del dropper vs CUIT del titular) y cachea el resultado en la app DB.
    NO escribe en unidrop_api."""
    result = bank_address.lookup(value)
    if not result.ok:
        return db.upsert_verified_account({
            "dropshipper_user_id": dropshipper_user_id, "value": value, "tax_id": tax_id,
            "is_verified": False,
        })

    holder_tax_id = bank_address.normalize_tax_id(result.data.uuid) if result.data.uuid else None
    is_verified = holder_tax_id is not None and bank_address.tax_id_matches(tax_id, holder_tax_id)

    return db.upsert_verified_account({
        "dropshipper_user_id": dropshipper_user_id,
        "value": value,
        "tax_id": tax_id,
        "cresium_to_id": str(result.data.id) if result.data.id is not None else None,
        "holder_name": result.data.owner_name,
        "holder_tax_id": holder_tax_id,
        "bank_name": result.data.bank_name,
        "is_verified": is_verified,
    })


# ─── Creacion de orders ──────────────────────────────────────────────────────

def _idempotency_key(*parts: Any) -> str:
    raw = ":".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _candidate_value(recipient: dict) -> str | None:
    """El valor que se resuelve contra Cresium: CBU/CVU primero, alias si no."""
    return (recipient.get("recipient_cbu") or recipient.get("recipient_cvu")
            or recipient.get("recipient_alias") or None)


def _create_order(*, source_type: str, idk: str, ids: dict, amount: float, dropshipper: dict,
                  recipient: dict, batch_id: int | None,
                  triggered_by_user_id: int | None, triggered_by_email: str | None) -> dict:
    """Materializa (idempotente) una payout order. Guarda SIEMPRE el candidato
    bancario en recipient_*. Si ya hay una verificacion cacheada con
    cresium_to_id para ese mismo valor, arranca en READY_TO_TRANSFER; si no, en
    PENDING_VERIFICATION (la verificacion contra Cresium se corre aparte)."""
    cresium_to_id = None
    status = "PENDING_VERIFICATION"
    value = _candidate_value(recipient)
    if value:
        va = db.get_verified_account(dropshipper["user_id"])
        if va and va.get("cresium_to_id") and va.get("value") == value:
            cresium_to_id = va["cresium_to_id"]
            status = "READY_TO_TRANSFER"

    data = {
        "source_type": source_type,
        "ml_order_id": ids.get("ml_order_id"),
        "return_idx": ids.get("return_idx"),
        "subscription_refund_request_id": ids.get("subscription_refund_request_id"),
        "batch_id": batch_id,
        "dropshipper_user_id": dropshipper["user_id"],
        "dropshipper_dni": dropshipper.get("dni"),
        "dropshipper_name": dropshipper.get("name"),
        "amount": amount,
        "currency": "ARS",
        "idempotency_key": idk,
        "recipient_cbu": recipient.get("recipient_cbu"),
        "recipient_cvu": recipient.get("recipient_cvu"),
        "recipient_alias": recipient.get("recipient_alias"),
        "recipient_holder_name": recipient.get("recipient_holder_name"),
        "recipient_tax_id": recipient.get("recipient_tax_id"),
        "cresium_to_id": cresium_to_id,
        "status": status,
        "triggered_by_user_id": triggered_by_user_id,
        "triggered_by_email": triggered_by_email,
    }
    return db.create_order(data)


def create_ml_return_order(*, ml_order_id: int, return_idx: int, amount: float, dropshipper: dict,
                           recipient: dict, batch_id: int | None = None,
                           triggered_by_user_id: int | None = None,
                           triggered_by_email: str | None = None) -> dict:
    return _create_order(
        source_type="ml_return",
        idk=_idempotency_key("ml_return", ml_order_id, return_idx),
        ids={"ml_order_id": ml_order_id, "return_idx": return_idx},
        amount=amount, dropshipper=dropshipper, recipient=recipient, batch_id=batch_id,
        triggered_by_user_id=triggered_by_user_id, triggered_by_email=triggered_by_email,
    )


def create_subscription_order(*, subscription_refund_request_id: int, amount: float, dropshipper: dict,
                              recipient: dict, batch_id: int | None = None,
                              triggered_by_user_id: int | None = None,
                              triggered_by_email: str | None = None) -> dict:
    return _create_order(
        source_type="subscription",
        idk=_idempotency_key("subscription", subscription_refund_request_id),
        ids={"subscription_refund_request_id": subscription_refund_request_id},
        amount=amount, dropshipper=dropshipper, recipient=recipient, batch_id=batch_id,
        triggered_by_user_id=triggered_by_user_id, triggered_by_email=triggered_by_email,
    )


# ─── Verificacion de la order contra Cresium ─────────────────────────────────

def verify_order(order_id: int) -> dict:
    """Resuelve el candidato bancario de la order contra Cresium, valida el
    match anti-fraude y, si pasa, promueve PENDING_VERIFICATION ->
    READY_TO_TRANSFER congelando cresium_to_id + titular. Gated por el flag."""
    if not config.enabled():
        raise CresiumDisabledError("FEATURE_CRESIUM_REFUNDS_ENABLED=false")
    order = db.get_order(order_id)
    if not order:
        raise ValueError(f"Payout order {order_id} no encontrada")
    if order["status"] != "PENDING_VERIFICATION":
        return order

    value = _candidate_value(order)
    if not value:
        db.mark_failed(order_id, "Sin datos bancarios para verificar (cbu/cvu/alias vacios)", category="cliente")
        return db.get_order(order_id)

    va = verify_account(
        dropshipper_user_id=order["dropshipper_user_id"],
        value=value,
        tax_id=order.get("recipient_tax_id") or order.get("dropshipper_dni") or "",
    )
    if not va.get("is_verified") or not va.get("cresium_to_id"):
        log.info("[verify_order] order %s no verifico (value=%s) — queda PENDING_VERIFICATION", order_id, value)
        return db.get_order(order_id)

    promoted = db.promote_pending_to_ready(order_id, {
        "recipient_cbu": order.get("recipient_cbu"),
        "recipient_cvu": order.get("recipient_cvu"),
        "recipient_alias": order.get("recipient_alias"),
        "recipient_holder_name": va.get("holder_name") or order.get("recipient_holder_name"),
        "recipient_tax_id": va.get("holder_tax_id") or order.get("recipient_tax_id"),
        "cresium_to_id": va["cresium_to_id"],
    })
    return promoted or db.get_order(order_id)


def verify_batch(batch_id: int) -> dict:
    pending = [o for o in db.list_orders(batch_id=batch_id, limit=1000) if o["status"] == "PENDING_VERIFICATION"]
    verified = 0
    for o in pending:
        try:
            res = verify_order(o["id"])
            if res.get("status") == "READY_TO_TRANSFER":
                verified += 1
        except Exception as e:  # noqa: BLE001
            log.warning("[verify_batch] order %s fallo: %s", o["id"], e)
    return {"verified": verified, "pending_before": len(pending)}


# ─── Enviar a Cresium (verify + submit por item, estilo Unidev) ──────────────

def verify_and_submit(order_id: int) -> dict:
    """Envia UNA order a Cresium: verifica la cuenta (bank-address + anti-fraude)
    y, si pasa, la submitea (preview + signature-request). Categoriza el
    resultado estilo Unidev. Devuelve {ok, code, estado}.
      estado: en_cresium | error_cliente | error_cresium | realizada
    """
    if not config.ready():
        raise CresiumDisabledError(_NOT_READY_MSG)
    order = db.get_order(order_id)
    if not order:
        raise ValueError(f"Payout order {order_id} no encontrada")

    st = order["status"]
    if st in ("SUBMITTING", "SIGNATURE_REQUEST_CREATED", "PROCESSING"):
        return {"ok": True, "code": "YA_EN_CURSO", "estado": "en_cresium", "order_id": order_id}
    if st == "SUCCESS":
        return {"ok": True, "code": "YA_REALIZADA", "estado": "realizada", "order_id": order_id}

    # Paso 1: verificar la cuenta si todavia no esta lista.
    if st == "PENDING_VERIFICATION":
        verified = verify_order(order_id)
        if verified.get("status") != "READY_TO_TRANSFER":
            reason = verified.get("failure_reason") or "La cuenta no verifico contra Cresium (titular/CBU)"
            db.mark_failed(order_id, reason, category="cliente")
            return {"ok": False, "code": "ERROR_DATOS_CLIENTE", "estado": "error_cliente", "order_id": order_id}
        st = "READY_TO_TRANSFER"

    # Paso 2: submit (make-a-transfer + signature-request).
    if st == "READY_TO_TRANSFER":
        try:
            submit_to_cresium(order_id)
            return {"ok": True, "code": "ENVIADA", "estado": "en_cresium", "order_id": order_id}
        except CresiumDisabledError:
            raise
        except Exception as e:  # noqa: BLE001 - submit_to_cresium ya marco FAILED con categoria
            cur = db.get_order(order_id) or {}
            cat = cur.get("error_category") or "cresium"
            if cur.get("status") != "FAILED":
                db.mark_failed(order_id, str(e), category=cat)
            estado = "error_cliente" if cat == "cliente" else "error_cresium"
            return {"ok": False, "code": cat.upper(), "estado": estado, "order_id": order_id}

    # Estado no enviable (FAILED/CANCELED se reintentan con su accion dedicada).
    return {"ok": False, "code": "ESTADO_NO_ENVIABLE",
            "estado": db.tab_for_order(st, order.get("error_category")), "order_id": order_id}


def reintentar(order_id: int) -> dict:
    """Reintenta una order en error (Reintentar / Re-verificar de la UI):
    reabre FAILED/CANCELED al punto correcto (READY si ya tiene cuenta
    verificada, PENDING si hay que re-verificar) y corre verify_and_submit."""
    if not config.ready():
        raise CresiumDisabledError(_NOT_READY_MSG)
    order = db.get_order(order_id)
    if not order:
        raise ValueError(f"Payout order {order_id} no encontrada")
    if order["status"] not in ("FAILED", "CANCELED"):
        # Ya salio del error (otra accion / evento) — no-op idempotente.
        return {"ok": True, "code": "NO_ERROR",
                "estado": db.tab_for_order(order["status"], order.get("error_category")), "order_id": order_id}
    target = "READY_TO_TRANSFER" if order.get("cresium_to_id") else "PENDING_VERIFICATION"
    db.reopen_order(order_id, target)
    return verify_and_submit(order_id)


# ─── Submit saliente (2 calls a Cresium) ─────────────────────────────────────

def submit_to_cresium(order_id: int) -> dict:
    """Ejecuta los 2 calls salientes para una order en READY_TO_TRANSFER:
      1) make-a-transfer  (POST /v3/transaction/preview)
      2) signature-request (POST /v3/signature-request/TRANSACTION_REQUEST)
    Persiste ids intermedios para no perder estado si el step 2 falla.
    Idempotente: no-op si la order no esta en READY_TO_TRANSFER. Skipea el step
    1 si ya hay cresium_transaction_id (evita duplicar la transaccion en un
    retry)."""
    order = db.get_order(order_id)
    if not order:
        raise ValueError(f"Payout order {order_id} no encontrada")

    if order["status"] != "READY_TO_TRANSFER":
        log.info("[submit] order %s no esta en READY_TO_TRANSFER (status=%s) — no-op", order_id, order["status"])
        return order

    if not config.ready():
        raise CresiumDisabledError(_NOT_READY_MSG)

    # Claim atomico READY_TO_TRANSFER -> SUBMITTING ANTES de cualquier call
    # saliente. Si otro proceso ya lo claimeo (confirm_batch concurrente / doble
    # click), claim devuelve None y hacemos no-op — nunca dos make-a-transfer
    # para la misma order.
    order = db.claim_for_submit(order_id)
    if not order:
        log.info("[submit] order %s ya fue claimeada por otro proceso — no-op", order_id)
        return db.get_order(order_id)

    if not order.get("cresium_to_id"):
        reason = "La cuenta bancaria no tiene cresium_to_id (no fue verificada contra Cresium)"
        db.mark_failed(order_id, reason, category="cliente")
        raise ValueError(reason)

    description = _description_for(order)
    amount_str = f"{float(order['amount']):.2f}"

    # ── Step 1: make-a-transfer ──────────────────────────────────────────────
    tx_id = order.get("cresium_transaction_id")
    if tx_id:
        log.info("[submit] order %s ya tenia cresium_transaction_id=%s — skip make-a-transfer", order_id, tx_id)
    else:
        try:
            transfer_res = transfer.create_transfer(
                to_id=int(order["cresium_to_id"]),
                amount=amount_str,
                currency_code=order["currency"],
                description=description,
                external_id=order.get("idempotency_key"),
            )
            tx_id = transfer_res.transaction_id
            db.set_transaction_ids(order_id, preview_id=tx_id, transaction_id=tx_id)
            log.info("[submit] make-a-transfer OK order %s txId=%s", order_id, tx_id)
        except Exception as err:  # noqa: BLE001 - cualquier error -> FAILED recuperable, nunca dejar SUBMITTING colgado
            db.mark_failed(order_id, f"make-a-transfer: {err}", category="cresium")
            raise

    # ── Step 2: signature-request ────────────────────────────────────────────
    try:
        sr = transfer.create_signature_request(transaction_id=tx_id)
        updated = db.mark_signature_request_created(order_id, sr.signature_request_id)
        log.info("[submit] signature-request OK order %s srId=%s", order_id, sr.signature_request_id)
        return updated or db.get_order(order_id)
    except Exception as err:  # noqa: BLE001 - cualquier error -> FAILED (con tx_id huerfano anotado), nunca SUBMITTING colgado
        db.mark_failed(order_id, f"signature-request fallo post make-a-transfer (txId={tx_id}): {err}", category="cresium")
        raise


def _description_for(order: dict) -> str:
    if order["source_type"] == "ml_return":
        return f"Refund ML devolucion DROP {order.get('dropshipper_dni')} (order {order.get('ml_order_id')})"
    return f"Refund suscripcion DROP {order.get('dropshipper_dni')} (req {order.get('subscription_refund_request_id')})"


# ─── Eventos terminales (webhook / polling) ──────────────────────────────────

def apply_event(
    *,
    payout_order_id: int,
    cresium_tx_id: str,
    status: str,
    type_: str | None = None,
    total_amount: float | None = None,
    net_amount: float | None = None,
    fees: Any = None,
    raw_payload: Any = None,
    source: str,
) -> dict:
    """Aplica un evento de Cresium idempotentemente. El evento se persiste para
    auditoria con dedup por (cresium_tx_id, status). La transicion terminal se
    RE-APLICA siempre (no solo en la primera entrega): las CAS de
    mark_success/failed/canceled son idempotentes (no-op si ya esta en el
    estado destino), asi que una transicion que se perdio porque el evento ya
    estaba commiteado se auto-cura en la siguiente entrega (webhook o polling)."""
    status = (status or "").upper()

    # insert para auditoria (dedup via ON CONFLICT). Que sea duplicado NO frena
    # la re-aplicacion de la transicion terminal de abajo.
    inserted = db.insert_event({
        "payout_order_id": payout_order_id,
        "cresium_tx_id": cresium_tx_id,
        "type": type_ or "UNKNOWN",
        "status": status or "UNKNOWN",
        "total_amount": total_amount,
        "net_amount": net_amount,
        "fees": fees,
        "raw_payload": raw_payload if raw_payload is not None else {},
        "source": source,
    })
    is_duplicate = inserted is None

    # Guardar el status crudo de Cresium para la UI (esperando firma vs procesando).
    db.set_cresium_status(payout_order_id, status)

    if status in SUCCESS_STATUSES:
        _mark_success(payout_order_id, cresium_tx_id)
        return {"kind": "processed", "transition": "SUCCESS", "duplicate_event": is_duplicate}
    if status in FAILED_STATUSES:
        db.mark_failed(payout_order_id, status, transaction_id=cresium_tx_id)
        return {"kind": "processed", "transition": "FAILED", "duplicate_event": is_duplicate}
    if status in CANCELED_STATUSES:
        db.mark_canceled(payout_order_id, "Canceled by signer", transaction_id=cresium_tx_id)
        return {"kind": "processed", "transition": "CANCELED", "duplicate_event": is_duplicate}

    if is_duplicate:
        return {"kind": "duplicate"}
    log.info("[applyEvent] status intermedio (%s) registrado para order %s — sin transicion", status, payout_order_id)
    return {"kind": "no_terminal_status", "status": status}


def _mark_success(order_id: int, cresium_tx_id: str) -> None:
    """Marca la order SUCCESS y auto-marca la devolucion como transferida en su
    tabla de tracking. La flag de la tabla de tracking es best-effort: si falla,
    la order SUCCESS sigue siendo la fuente de verdad."""
    updated = db.mark_success(order_id, transaction_id=cresium_tx_id, receipt_url=None)
    if not updated:
        return  # ya estaba en SUCCESS (idempotente)

    note = f"Cresium SUCCESS txId={cresium_tx_id}"
    try:
        if updated["source_type"] == "ml_return":
            flipped = ml_return_actions_db.mark_transferred_system(
                int(updated["ml_order_id"]),
                return_idx=int(updated["return_idx"] or 1),
                user_id=SYSTEM_USER_ID,
                user_email=SYSTEM_EMAIL,
                note=note,
                amount_arg=float(updated["amount"]),
                dropshipper_user_id=updated.get("dropshipper_user_id"),
                dropshipper_dni=updated.get("dropshipper_dni"),
            )
        else:
            flipped = refund_requests_db.mark_transferred_system(
                int(updated["subscription_refund_request_id"]),
                user_id=SYSTEM_USER_ID,
                user_email=SYSTEM_EMAIL,
                note=note,
                refund_amount_arg=float(updated["amount"]),
            )
        if not flipped:
            # La plata se movio (order en SUCCESS) pero la fila de tracking ya
            # estaba en un estado terminal distinto — un operador debe reconciliar.
            log.error(
                "[markSuccess] ANOMALIA: order %s en SUCCESS pero la devolucion (%s) no se pudo marcar "
                "transferida (fila ya terminal). Reconciliar manualmente. txId=%s",
                order_id, updated["source_type"], cresium_tx_id,
            )
    except Exception as e:  # noqa: BLE001 - best-effort linkage
        log.error("[markSuccess] order %s en SUCCESS pero fallo el flip de la devolucion: %s", order_id, e)


def dispatch_incoming_event(
    *,
    cresium_transaction_id: str | None,
    external_reference: str | None,
    status: str,
    type_: str | None = None,
    total_amount: float | None = None,
    net_amount: float | None = None,
    fees: Any = None,
    raw_payload: Any = None,
    source: str,
) -> dict:
    """Localiza la order del evento y delega a apply_event. Si no hay match,
    devuelve no_match (puede ser trafico de otra UEN)."""
    order = db.find_order_by_cresium_event(
        cresium_transaction_id=cresium_transaction_id, idempotency_key=external_reference
    )
    if not order:
        log.warning("[dispatch] sin order para txId=%s extRef=%s", cresium_transaction_id, external_reference)
        return {"kind": "no_match", "transaction_id": cresium_transaction_id}

    return apply_event(
        payout_order_id=order["id"],
        cresium_tx_id=cresium_transaction_id or order.get("cresium_transaction_id"),
        status=status,
        type_=type_,
        total_amount=total_amount,
        net_amount=net_amount,
        fees=fees,
        raw_payload=raw_payload,
        source=source,
    )


# ─── Retry / polling ─────────────────────────────────────────────────────────

def retry_failed(order_id: int, *, operator_id: int, operator_email: str) -> dict:
    # Chequear ready() ANTES de mutar la DB: si falta una credencial no queremos
    # resetear FAILED->READY_TO_TRANSFER y dejar la order en un estado que no
    # podemos ejecutar.
    if not config.ready():
        raise CresiumDisabledError(_NOT_READY_MSG)
    reset = db.reset_failed_to_ready(order_id, operator_id, operator_email)
    if not reset:
        raise ValueError("Solo se pueden reintentar orders en estado FAILED")
    return submit_to_cresium(order_id)


def poll_single(order_id: int) -> dict:
    order = db.get_order(order_id)
    if not order or not order.get("cresium_transaction_id"):
        return {"kind": "no_tx"}
    if not config.ready():
        raise CresiumDisabledError(_NOT_READY_MSG)
    data = transfer.get_transaction(order["cresium_transaction_id"])
    return apply_event(
        payout_order_id=order_id,
        cresium_tx_id=order["cresium_transaction_id"],
        status=str(data.get("status") or ""),
        type_=data.get("type"),
        total_amount=data.get("totalAmount"),
        net_amount=data.get("netAmount"),
        fees=data.get("amounts"),
        raw_payload=data,
        source="polling",
    )


def poll_pending(max_age_days: int = 7, limit: int = 50) -> dict:
    # Reconciliacion (red de seguridad del webhook): corre siempre que Cresium
    # este listo. Se usa desde el scheduler para mover En Cresium -> Realizadas.
    if not config.ready():
        return {"polled": 0, "skipped": "not_ready"}
    orders = db.pollable_orders(max_age_days=max_age_days, limit=limit)
    polled = 0
    for i, o in enumerate(orders):
        if i:
            time.sleep(0.6)  # Cresium rate-limitea (~429) si le pegamos en rafaga
        try:
            poll_single(o["id"])
            polled += 1
        except Exception as e:  # noqa: BLE001
            log.warning("[poll] order %s fallo: %s", o["id"], e)
    return {"polled": polled, "candidates": len(orders)}
