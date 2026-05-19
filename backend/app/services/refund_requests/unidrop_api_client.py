"""
Cliente HTTP a la API de Unidrop (api.unidrop.com.ar) — operaciones que UNIDATA
necesita disparar contra el sistema de Unidrop.

Por ahora cubre solo:
  DELETE /mercado-libre/subscriptions/unassign/{email}

Auth asumida: Bearer JWT (estandar NestJS). Si Unidrop usa un esquema distinto,
ajustar `_auth_headers()`.

Env vars:
  UNIDROP_API_URL   default https://api.unidrop.com.ar
  UNIDROP_API_TOKEN obligatorio — JWT admin generado desde Unidrop
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("unidata.refund_requests.unidrop_api")

UNIDROP_API_URL = (os.environ.get("UNIDROP_API_URL") or "https://api.unidrop.com.ar").rstrip("/")
REQUEST_TIMEOUT = 30.0


def _get_token() -> str:
    tok = (os.environ.get("UNIDROP_API_TOKEN") or "").strip()
    if not tok:
        raise RuntimeError(
            "UNIDROP_API_TOKEN no esta seteada en el environment. "
            "Generar el JWT admin desde Unidrop y cargarlo en Railway."
        )
    return tok


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_get_token()}",
        "Accept": "application/json",
    }


def unassign_meli_subscription(email: str) -> dict:
    """
    Llama DELETE /mercado-libre/subscriptions/unassign/{email} para desasignar
    la suscripcion MELI de un dropshipper.

    Returns:
      {"status_code": int, "body": str}  con la respuesta de Unidrop, para audit.

    Raises:
      RuntimeError si Unidrop responde con codigo >= 400 o si UNIDROP_API_TOKEN
      no esta seteada. El error incluye los primeros 300 chars del body para
      debugging.
    """
    email = (email or "").strip()
    if not email:
        raise ValueError("email vacio")

    url = f"{UNIDROP_API_URL}/mercado-libre/subscriptions/unassign/{email}"
    log.info("unidrop_api DELETE %s", url)

    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        r = client.delete(url, headers=_auth_headers())

    if r.status_code >= 400:
        raise RuntimeError(
            f"Unidrop API {r.status_code} en unassign({email}): {r.text[:300]}"
        )

    log.info("unidrop_api unassign(%s) -> %d", email, r.status_code)
    return {"status_code": r.status_code, "body": r.text[:1000]}
