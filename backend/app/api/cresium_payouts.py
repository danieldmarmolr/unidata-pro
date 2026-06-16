"""Endpoints del motor de payouts Cresium (cola del area Finanzas).

Flujo batch + preview + confirmacion humana:
  POST /api/cresium-payouts/batches                 -> arma el lote (re-deriva
                                                       monto+banco del backend)
  POST /api/cresium-payouts/batches/{id}/verify     -> verifica cuentas vs Cresium
  GET  /api/cresium-payouts/batches/{id}            -> preview del lote
  POST /api/cresium-payouts/batches/{id}/confirm    -> envia a Cresium (2 calls)

Otros:
  GET  /api/cresium-payouts                         -> listar orders
  GET  /api/cresium-payouts/orders/{id}             -> detalle + timeline
  POST /api/cresium-payouts/orders/{id}/retry       -> reintentar FAILED
  POST /api/cresium-payouts/orders/{id}/poll        -> forzar poll de status
  POST /api/cresium-payouts/verify-account          -> verificar una cuenta
  GET  /api/cresium-payouts/health                  -> estado del flag/config

Webhook (router publico, sin JWT, verificado por firma HMAC):
  POST /api/cresium/webhook
"""
from __future__ import annotations

import json
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import cresium_payouts_db as db
from app.db import refund_requests_db
from app.services import ml_returns_finance
from app.services.cresium import config, engine, webhooks
from app.services.cresium.engine import CresiumDisabledError

log = logging.getLogger("unidata.api.cresium_payouts")

router = APIRouter(prefix="/api/cresium-payouts", tags=["cresium-payouts"])
webhook_router = APIRouter(prefix="/api/cresium", tags=["cresium-webhook"])

_AREAS = ["finanzas", "administracion"]


# ─── Bodies ──────────────────────────────────────────────────────────────────

class BatchItem(BaseModel):
    source_type: Literal["ml_return", "subscription"]
    ml_order_id: int | None = None
    return_idx: int = Field(default=1, ge=1)
    subscription_refund_request_id: int | None = None


class CreateBatchBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    items: list[BatchItem] = Field(..., min_length=1, max_length=500)


class VerifyAccountBody(BaseModel):
    dropshipper_user_id: int
    value: str = Field(..., min_length=4, max_length=40)
    tax_id: str = Field(..., min_length=6, max_length=13)


# ─── Build / preview / verify / confirm ──────────────────────────────────────

@router.post("/batches")
def create_batch(body: CreateBatchBody, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    batch = db.create_batch(user_id=user["id"], user_email=user["email"], note=(body.note or "").strip() or None)

    created: list[dict] = []
    errors: list[dict] = []
    for it in body.items:
        try:
            if it.source_type == "ml_return":
                if not it.ml_order_id:
                    raise ValueError("ml_order_id requerido")
                order = _build_ml_order(it, batch["id"], user)
            else:
                if not it.subscription_refund_request_id:
                    raise ValueError("subscription_refund_request_id requerido")
                order = _build_subscription_order(it, batch["id"], user)
            created.append(order)
        except ValueError as e:
            errors.append({"item": it.model_dump(), "error": str(e)})

    db.recompute_batch_totals(batch["id"])
    return {"batch": db.get_batch(batch["id"]), "orders": created, "errors": errors}


def _build_ml_order(it: BatchItem, batch_id: int, user: dict) -> dict:
    detail = ml_returns_finance.get_ml_return(it.ml_order_id)
    if not detail:
        raise ValueError(f"Devolucion ML {it.ml_order_id} no encontrada")
    amount = float(detail.get("amount_to_refund") or 0)
    if amount <= 0:
        raise ValueError("Monto a reembolsar invalido (0)")
    drop = detail.get("dropshipper") or {}
    if not drop.get("user_id"):
        raise ValueError("Devolucion sin dropshipper asociado")
    bank = detail.get("bank") or {}
    recipient = {
        "recipient_cbu": bank.get("cbu"),
        "recipient_cvu": bank.get("cvu"),
        "recipient_alias": bank.get("alias"),
        "recipient_holder_name": bank.get("holder_name"),
        "recipient_tax_id": bank.get("holder_tax_id") or (drop.get("dni") or None),
    }
    return engine.create_ml_return_order(
        ml_order_id=it.ml_order_id, return_idx=it.return_idx, amount=amount,
        dropshipper={"user_id": drop["user_id"], "dni": drop.get("dni"), "name": drop.get("name")},
        recipient=recipient, batch_id=batch_id,
        triggered_by_user_id=user["id"], triggered_by_email=user["email"],
    )


def _build_subscription_order(it: BatchItem, batch_id: int, user: dict) -> dict:
    req = refund_requests_db.get_request(it.subscription_refund_request_id)
    if not req:
        raise ValueError(f"Solicitud de suscripcion {it.subscription_refund_request_id} no encontrada")
    amount = float(req.get("refund_amount_arg") or 0)
    if amount <= 0:
        raise ValueError("Monto solicitado invalido (0)")
    if not req.get("dropshipper_user_id"):
        raise ValueError("Solicitud sin dropshipper asociado")
    recipient = {
        "recipient_cbu": req.get("bank_cbu"),
        "recipient_cvu": None,
        "recipient_alias": req.get("bank_alias"),
        "recipient_holder_name": req.get("bank_holder_name"),
        "recipient_tax_id": req.get("bank_holder_cuit"),
    }
    return engine.create_subscription_order(
        subscription_refund_request_id=it.subscription_refund_request_id, amount=amount,
        dropshipper={"user_id": req["dropshipper_user_id"], "dni": req.get("dropshipper_dni"), "name": req.get("dropshipper_name")},
        recipient=recipient, batch_id=batch_id,
        triggered_by_user_id=user["id"], triggered_by_email=user["email"],
    )


@router.get("/batches")
def list_batches(user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    return {"batches": db.list_batches()}


@router.get("/batches/{batch_id}")
def get_batch(batch_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    batch = db.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Lote no encontrado")
    return {"batch": batch, "orders": db.list_orders(batch_id=batch_id, limit=1000)}


@router.post("/batches/{batch_id}/verify")
def verify_batch(batch_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    if not db.get_batch(batch_id):
        raise HTTPException(404, "Lote no encontrado")
    try:
        summary = engine.verify_batch(batch_id)
    except CresiumDisabledError:
        raise HTTPException(409, _DISABLED_MSG)
    return {**summary, "orders": db.list_orders(batch_id=batch_id, limit=1000)}


@router.post("/batches/{batch_id}/confirm")
def confirm_batch(batch_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    batch = db.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Lote no encontrado")
    if not config.ready():
        raise HTTPException(409, _DISABLED_MSG)

    # Barrera a nivel lote: claim draft->confirmed de entrada. Si no ganamos el
    # CAS el lote ya fue confirmado (doble click / retry de proxy / 2 operadores)
    # -> respuesta idempotente sin reprocesar.
    if not db.claim_batch_for_confirm(batch_id):
        return {
            "batch": db.get_batch(batch_id),
            "results": [],
            "orders": db.list_orders(batch_id=batch_id, limit=1000),
            "already_confirmed": True,
        }

    orders = db.list_orders(batch_id=batch_id, limit=1000)
    results: list[dict] = []
    for o in orders:
        if o["status"] != "READY_TO_TRANSFER":
            results.append({"order_id": o["id"], "skipped": o["status"]})
            continue
        try:
            updated = engine.submit_to_cresium(o["id"])
            results.append({"order_id": o["id"], "status": updated.get("status")})
        except Exception as e:  # noqa: BLE001
            results.append({"order_id": o["id"], "error": str(e)})

    return {"batch": db.get_batch(batch_id), "results": results, "orders": db.list_orders(batch_id=batch_id, limit=1000)}


# ─── Orders ──────────────────────────────────────────────────────────────────

@router.get("")
def list_orders(
    user: Annotated[dict, Depends(current_user)],
    status: Annotated[str | None, Query()] = None,
    source_type: Annotated[str | None, Query()] = None,
    batch_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    require_area(user, _AREAS)
    if status is not None and status not in db.STATUSES:
        raise HTTPException(422, f"status invalido; usar uno de {db.STATUSES}")
    if source_type is not None and source_type not in db.SOURCE_TYPES:
        raise HTTPException(422, f"source_type invalido; usar uno de {db.SOURCE_TYPES}")
    return {"orders": db.list_orders(status=status, source_type=source_type, batch_id=batch_id, limit=limit, offset=offset)}


@router.get("/health")
def health(user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    return {
        "enabled": config.enabled(),
        "polling_enabled": config.polling_enabled(),
        "base_url": config.base_url(),
        "webhook_public_url": config.webhook_public_url(),
    }


@router.get("/orders/{order_id}")
def get_order(order_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    order = db.get_order(order_id)
    if not order:
        raise HTTPException(404, "Orden no encontrada")
    return {"order": order, "events": db.list_events(order_id)}


@router.post("/orders/{order_id}/retry")
def retry(order_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    try:
        return engine.retry_failed(order_id, operator_id=user["id"], operator_email=user["email"])
    except CresiumDisabledError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    except RuntimeError:
        # credencial faltante — mensaje generico, no filtrar el nombre del env var
        raise HTTPException(409, _DISABLED_MSG)


@router.post("/orders/{order_id}/poll")
def poll(order_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    try:
        return engine.poll_single(order_id)
    except CresiumDisabledError as e:
        raise HTTPException(409, str(e))
    except RuntimeError:
        raise HTTPException(409, _DISABLED_MSG)


@router.post("/verify-account")
def verify_account(body: VerifyAccountBody, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    if not config.enabled():
        raise HTTPException(409, _DISABLED_MSG)
    try:
        return engine.verify_account(
            dropshipper_user_id=body.dropshipper_user_id, value=body.value.strip(), tax_id=body.tax_id.strip()
        )
    except RuntimeError:
        # credenciales no configuradas — mensaje generico
        raise HTTPException(409, _DISABLED_MSG)


# ─── Webhook (publico) ───────────────────────────────────────────────────────

# Path que forma parte de la firma del webhook entrante. Constante (no
# request.url.path) para desacoplar el HMAC de cualquier reescritura de path del
# proxy/ALB. Tiene que matchear lo registrado en el panel de Cresium:
# CRESIUM_WEBHOOK_PUBLIC_URL + WEBHOOK_SIGNED_PATH.
WEBHOOK_SIGNED_PATH = "/api/cresium/webhook"


@webhook_router.post("/webhook")
async def cresium_webhook(request: Request) -> dict:
    raw = (await request.body()).decode("utf-8")
    try:
        webhooks.verify_signature(
            raw_body=raw,
            signature_header=request.headers.get("x-signature"),
            timestamp_header=request.headers.get("x-timestamp"),
            method=request.method,
            path=WEBHOOK_SIGNED_PATH,
        )
    except webhooks.WebhookError as e:
        raise HTTPException(e.status, str(e))

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        raise HTTPException(400, "Payload JSON invalido")

    parsed = webhooks.parse_payload(payload)
    if not parsed:
        return {"received": True, "kind": "ignored", "reason": "payload sin id"}

    # Firma ya verificada arriba. Un error transitorio (DB) NO debe devolver 500
    # porque Cresium reintentaria agresivamente; las garantias de idempotencia
    # (dedup de evento + CAS) hacen seguro cualquier reintento. Respondemos 200.
    try:
        outcome = engine.dispatch_incoming_event(
            cresium_transaction_id=parsed["cresium_transaction_id"],
            external_reference=parsed["external_reference"],
            status=parsed["status"],
            type_=parsed["type"],
            total_amount=parsed["total_amount"],
            net_amount=parsed["net_amount"],
            fees=parsed["fees"],
            raw_payload=payload,
            source="webhook",
        )
        return {"received": True, "outcome": outcome}
    except Exception as e:  # noqa: BLE001
        log.error("[webhook] error procesando evento: %s", e)
        return {"received": True, "error": str(e)}


_DISABLED_MSG = (
    "Cresium esta deshabilitado (FEATURE_CRESIUM_REFUNDS_ENABLED=false). "
    "Para ejecutar transferencias reales: cargar los 5 secrets CRESIUM_* y "
    "poner el flag en true."
)
