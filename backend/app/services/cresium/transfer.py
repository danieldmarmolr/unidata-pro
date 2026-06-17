"""Calls salientes a Cresium para ejecutar una transferencia. Port de
cresium-transfer.service.ts.

Secuencia real (NO es preview->confirm como sugiere el doc viejo):
  1) make-a-transfer  = POST /v3/transaction/preview  -> crea la transaccion
  2) signature-request = POST /v3/signature-request/{type} -> queda esperando
     que un signer la apruebe con token desde el dashboard de Cresium.

Alternativa NO usada en el flow de refunds:
  PUT /v3/transaction/confirm/{id} (sin body) — confirma directo, para montos
  por debajo del umbral o cuentas sin signers.

Gotchas:
  - el campo de moneda se llama `currencyCode`, NO `currency`.
  - `amount` es STRING en pesos (mayor unidad), nunca centavos.
  - `toId` es el id interno de la bank-address en Cresium (cresium_to_id), NO
    el CBU/CVU/alias.
  - el id de preview == id de transaccion (mismo valor).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from app.services.cresium import http_client
from app.services.cresium.http_client import CresiumOutboundError

log = logging.getLogger("unidata.cresium.transfer")


def _unwrap(data: Any) -> dict:
    """La API v3 de Cresium envuelve casi todo en {data:{...}}. En preview/get
    el objeto util es data.transaction; en otros es data directo; el webhook
    entrante es flat. Devuelve el objeto de transaccion mas profundo disponible."""
    if not isinstance(data, dict):
        return {}
    inner = data.get("data")
    if isinstance(inner, dict):
        tx = inner.get("transaction")
        if isinstance(tx, dict):
            return tx
        return inner
    return data


def _extract_tx_id(data: Any) -> str | None:
    """Parseo tolerante del id de transaccion: id | transactionId |
    data.transaction.id | data.id (calcado de Unidev-API)."""
    if not isinstance(data, dict):
        return None
    for key in ("id", "transactionId"):
        if data.get(key) is not None:
            return str(data[key])
    inner = data.get("data")
    if isinstance(inner, dict):
        tx = inner.get("transaction")
        if isinstance(tx, dict) and tx.get("id") is not None:
            return str(tx["id"])
        if inner.get("id") is not None:
            return str(inner["id"])
    return None


@dataclass
class TransferResult:
    transaction_id: str
    status: str
    raw: Any


@dataclass
class SignatureRequestResult:
    signature_request_id: str
    status: str
    raw: Any


def create_transfer(
    *,
    to_id: int,
    amount: str,
    currency_code: str,
    description: str | None = None,
    external_id: str | None = None,
    tag: str | None = None,
    sending_date: str | None = None,
) -> TransferResult:
    """make-a-transfer: POST /v3/transaction/preview. Los opcionales se incluyen
    SOLO si no son None. external_id se refleja en el webhook entrante
    (payload.externalId) y nos da un segundo eje de matching."""
    body: dict[str, Any] = {"toId": to_id, "amount": amount, "currencyCode": currency_code}
    if description is not None:
        body["description"] = description
    if external_id is not None:
        body["externalId"] = external_id
    if tag is not None:
        body["tag"] = tag
    if sending_date is not None:
        body["sendingDate"] = sending_date

    resp = http_client.request(method="POST", path="/v3/transaction/preview", body=body)
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/preview", resp.status, resp.data)

    # Cresium v3 envuelve la transaccion en data.transaction (NO id en top-level).
    tx_id = _extract_tx_id(resp.data)
    if not tx_id:
        raise CresiumOutboundError("transaction/preview", resp.status, resp.data, "Respuesta sin id de transaccion")

    tx = _unwrap(resp.data)
    return TransferResult(transaction_id=tx_id, status=str(tx.get("status") or "PREVIEW"), raw=resp.data)


def create_signature_request(*, transaction_id: str, type_: str = "TRANSACTION_REQUEST") -> SignatureRequestResult:
    """POST /v3/signature-request/{type}. type valido: TRANSACTION_REQUEST |
    BULK_REQUEST | PAYROLL_REQUEST. body: {id: transaction_id}."""
    encoded_type = quote(type_, safe="")
    # El id va NUMERICO: Cresium responde 401 si se manda como string.
    tid = int(transaction_id) if str(transaction_id).isdigit() else transaction_id
    resp = http_client.request(
        method="POST", path=f"/v3/signature-request/{encoded_type}", body={"id": tid}
    )
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("signature-request", resp.status, resp.data)

    sr = _unwrap(resp.data)
    sr_id = str(resp.data.get("id") or sr.get("id") or transaction_id)
    return SignatureRequestResult(
        signature_request_id=sr_id, status=str(sr.get("status") or "PENDING_APPROVAL"), raw=resp.data
    )


def confirm_transaction(transaction_id: str) -> dict:
    """Alternativa a signature-request: PUT /v3/transaction/confirm/{id} sin body."""
    encoded = quote(transaction_id, safe="")
    resp = http_client.request(method="PUT", path=f"/v3/transaction/confirm/{encoded}")
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/confirm", resp.status, resp.data)
    tx = _unwrap(resp.data)
    return {"status": str(tx.get("status") or "CONFIRMED"), "raw": resp.data}


def get_transaction(transaction_id: str) -> dict:
    """Polling de status: GET /v3/transaction/{id}. Devuelve el objeto de
    transaccion desempaquetado (status/type/totalAmount/netAmount/amounts)."""
    encoded = quote(transaction_id, safe="")
    resp = http_client.request(method="GET", path=f"/v3/transaction/{encoded}")
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/get", resp.status, resp.data)
    return _unwrap(resp.data)
