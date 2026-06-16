"""Cliente HTTP firmado a Cresium. Port de cresium-http.service.ts.

Garantia critica de seguridad (money-moving):
  - El body se serializa UNA sola vez con serialize_body() y ESE string exacto
    es el que se firma Y el que se manda por la red (httpx content=...). Si se
    reserializara despues de firmar, los bytes cambiarian y Cresium devolveria
    401. Por eso NO usamos httpx json=...
  - timeout 15s, SIN reintentos. Reintentar un POST de transferencia podria
    duplicar el pago. La idempotencia se maneja en capas superiores.
  - No levanta excepcion por status >= 400; devuelve la respuesta cruda y el
    caller decide. Solo levanta en error de transporte (sin respuesta).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.services.cresium import config
from app.services.cresium.signature import build_signature, iso_timestamp_now

log = logging.getLogger("unidata.cresium.http")

TIMEOUT_SECONDS = 15.0

# Set "unreserved" de encodeURIComponent: ademas de [A-Za-z0-9] no escapa
# - _ . ! ~ * ' ( ). urllib.quote ya mantiene A-Za-z0-9_.-~ siempre; agregamos
# el resto via safe para igualar JS byte-a-byte.
_URI_COMPONENT_SAFE = "-_.!~*'()"


def serialize_body(body: Any) -> str:
    """JSON compacto identico a JSON.stringify de JS: sin espacios, UTF-8 crudo,
    preservando el orden de insercion de las claves."""
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _build_path_with_query(path: str, query: dict[str, Any] | None) -> str:
    """Replica buildPathWithQuery: encodeURIComponent en clave y valor, drop de
    None/'', join con '&', prefijo '?' o '&'. El query string forma parte del
    string-to-sign, asi que tiene que ser byte-exacto."""
    if not query:
        return path
    entries = [(k, v) for k, v in query.items() if v is not None and v != ""]
    if not entries:
        return path
    qs = "&".join(
        quote(str(k), safe=_URI_COMPONENT_SAFE) + "=" + quote(str(v), safe=_URI_COMPONENT_SAFE)
        for k, v in entries
    )
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}{qs}"


@dataclass
class CresiumResponse:
    status: int
    data: Any
    text: str


class CresiumOutboundError(Exception):
    """Falla en un endpoint saliente de Cresium (status >= 400 o respuesta
    invalida). El caller la persiste en failure_reason."""

    def __init__(self, endpoint: str, http_status: int, response_body: Any, message: str | None = None):
        self.endpoint = endpoint
        self.http_status = http_status
        self.response_body = response_body
        super().__init__(
            message or f"Cresium {endpoint} respondio status {http_status}: {_safe(response_body)}"
        )


class CresiumTransportError(Exception):
    """Error de transporte (timeout / sin respuesta). Estado indeterminado: el
    caller NO debe asumir que la transferencia fallo ni que tuvo exito."""


def request(
    *,
    method: str,
    path: str,
    body: Any = None,
    query: dict[str, Any] | None = None,
    company_id: str | None = None,
) -> CresiumResponse:
    full_path = _build_path_with_query(path, query)
    body_string = serialize_body(body) if body is not None else ""
    timestamp = iso_timestamp_now()
    secret = config.api_secret()
    resolved_company = company_id or config.company_id()

    signature = build_signature(
        timestamp=timestamp, method=method, path=full_path, body=body_string, api_secret=secret
    )

    headers = {
        "x-api-key": config.api_key(),
        "x-company-id": resolved_company,
        "x-timestamp": timestamp,
        "x-signature": signature,
        "Content-Type": "application/json",
    }

    url = f"{config.base_url()}{full_path}"
    content = None if method == "GET" else body_string.encode("utf-8")

    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            r = client.request(method, url, headers=headers, content=content)
    except httpx.HTTPError as e:
        log.error("Cresium %s %s fallo (transporte): %s", method, full_path, e)
        raise CresiumTransportError(f"Cresium request failed: {e}") from e

    try:
        data = r.json()
    except (json.JSONDecodeError, ValueError):
        data = None

    if r.status_code >= 400:
        log.warning("Cresium %s %s -> %d: %s", method, full_path, r.status_code, _safe(data or r.text))
        if r.status_code == 401:
            log.warning(
                "[DIAG-401] string-to-sign='%s|%s|%s|%s' | sig='%s' | bodyLen=%d",
                timestamp, method, full_path, body_string, signature, len(body_string),
            )

    return CresiumResponse(status=r.status_code, data=data, text=r.text)


def _safe(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)
