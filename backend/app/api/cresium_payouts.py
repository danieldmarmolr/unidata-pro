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


# ─── Enviar a Cresium (seleccion + envio masivo, estilo Unidev) ─────────────

class SendBody(BaseModel):
    items: list[BatchItem] = Field(..., min_length=1, max_length=200)


@router.post("/send")
def send(body: SendBody, user: Annotated[dict, Depends(current_user)]) -> dict:
    """Envia masivamente las devoluciones seleccionadas a Cresium: por cada una
    arma la order, verifica la cuenta (banco + anti-fraude) y la submitea
    (preview + signature-request). Devuelve resumen agregado con la categoria de
    error por item (cliente vs cresium). NO mueve plata por si solo: el firmante
    de Cresium aprueba cada transferencia con token."""
    require_area(user, _AREAS)
    if not config.ready():
        raise HTTPException(409, _DISABLED_MSG)
    resultados: list[dict] = []
    enviados = 0
    for it in body.items:
        try:
            order = _build_ml_order(it, None, user) if it.source_type == "ml_return" else _build_subscription_order(it, None, user)
            res = engine.verify_and_submit(order["id"])
        except CresiumDisabledError:
            raise HTTPException(409, _DISABLED_MSG)
        except ValueError as e:
            res = {"ok": False, "code": "BUILD_ERROR", "estado": "error_cliente", "error": str(e)}
        if res.get("ok"):
            enviados += 1
        resultados.append({**res, "item": it.model_dump(exclude_none=True)})
    return {"ok": True, "total": len(body.items), "enviados": enviados, "resultados": resultados}


def _ml_pending_rows(search: str | None, exclude: set) -> list[dict]:
    data = ml_returns_finance.list_ml_returns(tab="TRANSFERENCIA_PENDIENTE", search=search, limit=500)
    out: list[dict] = []
    for it in data.get("items", []):
        oid = it.get("ml_order_id")
        if oid is None or (int(oid), 1) in exclude:
            continue
        drop = it.get("dropshipper") or {}
        bank = it.get("bank") or {}
        out.append({
            "key": f"ml:{oid}:1",
            "source_type": "ml_return", "ml_order_id": int(oid), "return_idx": 1,
            "titular": drop.get("name") or "", "dni": drop.get("dni") or "",
            "banco": bank.get("bank_name"),
            "cuenta": bank.get("cbu") or bank.get("cvu") or bank.get("alias"),
            "needs_bank": bool(bank.get("needs_bank", True)),
            "monto": float(it.get("amount_to_refund") or 0),
            "estado": "pendiente", "tab": "pendiente", "created_at": it.get("created_at"),
        })
    return out


def _sub_pending_rows(search: str | None, exclude: set) -> list[dict]:
    items = refund_requests_db.list_requests(status="pending", search=search, limit=500)
    out: list[dict] = []
    for r in items:
        rid = r.get("id")
        if rid is None or int(rid) in exclude:
            continue
        cuenta = r.get("bank_cbu") or r.get("bank_alias")
        out.append({
            "key": f"sub:{rid}",
            "source_type": "subscription", "subscription_refund_request_id": int(rid),
            "titular": r.get("bank_holder_name") or r.get("dropshipper_name") or "", "dni": r.get("dropshipper_dni") or "",
            "banco": r.get("bank_name"), "cuenta": cuenta,
            "needs_bank": not bool(cuenta),
            "monto": float(r.get("refund_amount_arg") or 0),
            "estado": "pendiente", "tab": "pendiente", "created_at": r.get("created_at"),
        })
    return out


def _order_rows(source_type: str, tab: str, search: str | None) -> list[dict]:
    out: list[dict] = []
    for o in db.list_orders_for_tab(source_type, tab, search=search, limit=500):
        out.append({
            "key": f"order:{o['id']}",
            "source_type": source_type, "order_id": o["id"],
            "ml_order_id": o.get("ml_order_id"), "return_idx": o.get("return_idx"),
            "subscription_refund_request_id": o.get("subscription_refund_request_id"),
            "titular": o.get("recipient_holder_name") or o.get("dropshipper_name") or "",
            "dni": o.get("dropshipper_dni") or "",
            "banco": None,
            "cuenta": o.get("recipient_cbu") or o.get("recipient_cvu") or o.get("recipient_alias"),
            "monto": float(o.get("amount") or 0),
            "estado": o["status"], "error_category": o.get("error_category"),
            "tab": tab, "created_at": o.get("created_at"),
            "failure_reason": o.get("failure_reason"),
            "cresium_transaction_id": o.get("cresium_transaction_id"),
            "receipt_url": o.get("receipt_url"),
        })
    return out


@router.get("/transferencias")
def transferencias(
    user: Annotated[dict, Depends(current_user)],
    source: Annotated[Literal["ml", "subscription"], Query()],
    tab: Annotated[str, Query()] = "pendiente",
    search: Annotated[str | None, Query()] = None,
) -> dict:
    require_area(user, _AREAS)
    source_type = "ml_return" if source == "ml" else "subscription"
    exclude = db.active_order_keys(source_type)
    pending = _ml_pending_rows(search, exclude) if source == "ml" else _sub_pending_rows(search, exclude)
    totals = {
        "pendiente": {"count": len(pending), "monto": round(sum(r["monto"] for r in pending), 2)},
        **db.totals_by_tab(source_type),
    }
    counts = {k: v["count"] for k, v in totals.items()}
    rows = pending if tab == "pendiente" else _order_rows(source_type, tab, search)
    return {"rows": rows, "counts": counts, "totals": totals}


@router.post("/orders/{order_id}/reintentar")
def reintentar(order_id: int, user: Annotated[dict, Depends(current_user)]) -> dict:
    require_area(user, _AREAS)
    try:
        return engine.reintentar(order_id)
    except CresiumDisabledError as e:
        raise HTTPException(409, str(e))
    except RuntimeError:
        raise HTTPException(409, _DISABLED_MSG)
    except ValueError as e:
        raise HTTPException(404, str(e))


class ReintentarBody(BaseModel):
    order_ids: list[int] = Field(..., min_length=1, max_length=200)


@router.post("/reintentar")
def reintentar_bulk(body: ReintentarBody, user: Annotated[dict, Depends(current_user)]) -> dict:
    """Reintento masivo de orders en error (Errores cliente / Errores Cresium)."""
    require_area(user, _AREAS)
    if not config.ready():
        raise HTTPException(409, _DISABLED_MSG)
    resultados: list[dict] = []
    reintentadas = 0
    for oid in body.order_ids:
        try:
            res = engine.reintentar(oid)
        except CresiumDisabledError:
            raise HTTPException(409, _DISABLED_MSG)
        except ValueError as e:
            res = {"ok": False, "code": "NOT_FOUND", "error": str(e), "order_id": oid}
        if res.get("ok"):
            reintentadas += 1
        resultados.append(res)
    return {"ok": True, "total": len(body.order_ids), "reintentadas": reintentadas, "resultados": resultados}


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
