"""Firma HMAC de requests a Cresium + verificacion de webhooks entrantes.

Port byte-exacto de cresium-signature.service.ts (Unidrop-Back).

Reglas criticas (validadas contra el MCP oficial cresium-mcp-server):
  - timestamp: ISO 8601 UTC con sufijo Z y milisegundos (e.g.
    '2026-05-05T11:10:40.123Z'). En JS = new Date().toISOString(). Un valor
    numerico (epoch ms) hace que Cresium rechace con 401 "Timestamp is more
    than 60 seconds old".
  - method: uppercase.
  - path: path + query string.
  - body: JSON compacto (sin espacios) o '' para requests sin body.
  - string-to-sign: f"{timestamp}|{method}|{path}|{body}".
  - output: HMAC-SHA256 en Base64 (NO hex).

Paridad con JSON.stringify de JS (ver http_client.serialize_body):
  separators=(',', ':') (sin espacios) y ensure_ascii=False (UTF-8 crudo,
  igual que JS), preservando el orden de insercion de las claves.
"""
from __future__ import annotations

import base64
import hmac
from datetime import datetime, timezone
from hashlib import sha256


def iso_timestamp_now() -> str:
    """ISO 8601 UTC con milisegundos y sufijo Z, identico a JS toISOString().

    datetime.isoformat() de Python da microsegundos y '+00:00' — lo
    recortamos a 3 digitos de ms y reemplazamos el offset por 'Z'.
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def build_signature(*, timestamp: str, method: str, path: str, body: str, api_secret: str) -> str:
    """HMAC-SHA256(`{ts}|{METHOD}|{path}|{body}`, api_secret) en Base64."""
    string_to_sign = f"{timestamp}|{method}|{path}|{body}"
    digest = hmac.new(api_secret.encode("utf-8"), string_to_sign.encode("utf-8"), sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def safe_compare_signatures(received: str, expected: str) -> bool:
    """Comparacion constant-time (timing-safe). False si difieren en longitud."""
    a = received.encode("utf-8")
    b = expected.encode("utf-8")
    if len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def is_timestamp_within_window(iso_timestamp: str, window_seconds: int = 5 * 60) -> bool:
    """True si el ISO timestamp esta dentro de la ventana de tolerancia (5 min
    default). False si no parsea como fecha valida. Replay protection para
    webhooks entrantes."""
    try:
        ts = iso_timestamp.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(ts)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return False
    delta = abs((datetime.now(timezone.utc) - parsed).total_seconds())
    return delta <= window_seconds
