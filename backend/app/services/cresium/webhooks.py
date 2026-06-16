"""Verificacion de webhooks entrantes de Cresium. Port de
cresium-webhooks.service.ts.

Esquema (validado en smoke test contra el panel de Cresium):
  HMAC-SHA256(`{timestamp}|{METHOD}|{fullURL}|{body}`, CRESIUM_WEBHOOK_SECRET)
donde fullURL es la URL COMPLETA registrada en el panel (protocolo + host +
path), NO solo el path. Por eso necesitamos CRESIUM_WEBHOOK_PUBLIC_URL.

El payload de Cresium es plano (Transaction al nivel raiz, no envuelto en {data}).
"""
from __future__ import annotations

import logging

from app.services.cresium import config
from app.services.cresium.signature import (
    build_signature,
    is_timestamp_within_window,
    safe_compare_signatures,
)

log = logging.getLogger("unidata.cresium.webhooks")


class WebhookError(Exception):
    """Falla de verificacion. status: 403 (firma) o 503 (deshabilitado/config)."""

    def __init__(self, message: str, status: int = 403):
        self.status = status
        super().__init__(message)


def verify_signature(*, raw_body: str, signature_header: str | None, timestamp_header: str | None, method: str, path: str) -> None:
    if not config.enabled():
        raise WebhookError("Cresium webhooks deshabilitados (FEATURE_CRESIUM_REFUNDS_ENABLED=false)", status=503)

    if not signature_header or not timestamp_header:
        raise WebhookError("Faltan headers x-signature o x-timestamp", status=403)

    if not is_timestamp_within_window(timestamp_header):
        raise WebhookError("x-timestamp fuera de la ventana de tolerancia (5 min)", status=403)

    public_url = config.webhook_public_url()
    if not public_url:
        raise WebhookError("CRESIUM_WEBHOOK_PUBLIC_URL no configurado — necesario para verificar firma", status=503)

    full_url = f"{public_url.rstrip('/')}{path}"
    expected = build_signature(
        timestamp=timestamp_header,
        method=method,
        path=full_url,
        body=raw_body,
        api_secret=config.webhook_secret(),
    )

    if not safe_compare_signatures(signature_header, expected):
        log.warning(
            "[webhook] firma invalida — recibida='%s...' esperada='%s...' (fullUrl=%s, ts=%s, bodyLen=%d)",
            signature_header[:16], expected[:16], full_url, timestamp_header, len(raw_body),
        )
        raise WebhookError("Firma de webhook invalida", status=403)


def parse_payload(payload: dict) -> dict | None:
    """Extrae los campos relevantes del Transaction plano de Cresium.
    Devuelve None si no hay id."""
    if not payload or payload.get("id") in (None, ""):
        return None
    return {
        "cresium_transaction_id": str(payload["id"]),
        "status": str(payload.get("status") or "").upper(),
        "external_reference": str(payload["externalId"]) if payload.get("externalId") else None,
        "type": payload.get("type"),
        "total_amount": payload.get("totalAmount"),
        "net_amount": payload.get("netAmount"),
        "fees": payload.get("amounts"),
    }
