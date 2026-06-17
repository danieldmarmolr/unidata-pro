"""Token opaco (HMAC, stateless) para el link publico de correccion de datos
bancarios de una devolucion de suscripcion. No requiere columna en DB: el token
es base64url("{request_id}.{hmac}") y se valida recomputando el HMAC."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os


def _secret() -> bytes:
    return (os.environ.get("JWT_SECRET") or "unidata-cresium-correction-fallback").encode("utf-8")


def make_token(request_id: int) -> str:
    sig = hmac.new(_secret(), str(request_id).encode(), hashlib.sha256).hexdigest()[:24]
    raw = f"{request_id}.{sig}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def parse_token(token: str) -> int | None:
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + pad).decode("utf-8")
        rid_str, sig = raw.split(".", 1)
        rid = int(rid_str)
    except (ValueError, TypeError):
        return None
    expected = hmac.new(_secret(), str(rid).encode(), hashlib.sha256).hexdigest()[:24]
    return rid if hmac.compare_digest(sig, expected) else None
