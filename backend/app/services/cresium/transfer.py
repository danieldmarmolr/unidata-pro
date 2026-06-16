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
    tag: str | None = None,
    sending_date: str | None = None,
) -> TransferResult:
    """make-a-transfer: POST /v3/transaction/preview. Los opcionales se incluyen
    SOLO si no son None (afecta los bytes del body firmado, igual que el spread
    condicional de JS)."""
    body: dict[str, Any] = {"toId": to_id, "amount": amount, "currencyCode": currency_code}
    if description is not None:
        body["description"] = description
    if tag is not None:
        body["tag"] = tag
    if sending_date is not None:
        body["sendingDate"] = sending_date

    resp = http_client.request(method="POST", path="/v3/transaction/preview", body=body)
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/preview", resp.status, resp.data)

    tx_id = resp.data.get("id") or resp.data.get("transactionId")
    if not tx_id:
        raise CresiumOutboundError("transaction/preview", resp.status, resp.data, "Respuesta sin id de transaccion")

    return TransferResult(transaction_id=str(tx_id), status=str(resp.data.get("status") or "PREVIEW"), raw=resp.data)


def create_signature_request(*, transaction_id: str, type_: str = "TRANSACTION_REQUEST") -> SignatureRequestResult:
    """POST /v3/signature-request/{type}. type valido: TRANSACTION_REQUEST |
    BULK_REQUEST | PAYROLL_REQUEST. body: {id: transaction_id}."""
    encoded_type = quote(type_, safe="")
    resp = http_client.request(
        method="POST", path=f"/v3/signature-request/{encoded_type}", body={"id": transaction_id}
    )
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("signature-request", resp.status, resp.data)

    sr_id = resp.data.get("id") or resp.data.get("signatureRequestId")
    if not sr_id:
        raise CresiumOutboundError("signature-request", resp.status, resp.data, "Respuesta sin id de signature request")

    return SignatureRequestResult(
        signature_request_id=str(sr_id), status=str(resp.data.get("status") or "PENDING_APPROVAL"), raw=resp.data
    )


def confirm_transaction(transaction_id: str) -> dict:
    """Alternativa a signature-request: PUT /v3/transaction/confirm/{id} sin body."""
    encoded = quote(transaction_id, safe="")
    resp = http_client.request(method="PUT", path=f"/v3/transaction/confirm/{encoded}")
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/confirm", resp.status, resp.data)
    return {"status": str(resp.data.get("status") or "CONFIRMED"), "raw": resp.data}


def get_transaction(transaction_id: str) -> dict:
    """Polling de status: GET /v3/transaction/{id}."""
    encoded = quote(transaction_id, safe="")
    resp = http_client.request(method="GET", path=f"/v3/transaction/{encoded}")
    if resp.status >= 400 or not resp.data:
        raise CresiumOutboundError("transaction/get", resp.status, resp.data)
    return resp.data
