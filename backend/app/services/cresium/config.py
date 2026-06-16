"""Config de Cresium desde environment. Port de cresium-config.service.ts.

Feature flags:
  FEATURE_CRESIUM_REFUNDS_ENABLED  master kill-switch (default false). Con el
                                   flag apagado no sale ningun call a Cresium.
  FEATURE_CRESIUM_POLLING_ENABLED  gate independiente del polling de status.

Credenciales (obligatorias solo si el master flag esta en true):
  CRESIUM_API_BASE_URL    default https://api.cresium.app
  CRESIUM_API_KEY         header x-api-key
  CRESIUM_API_SECRET      clave HMAC para x-signature
  CRESIUM_COMPANY_ID      header x-company-id
  CRESIUM_WEBHOOK_SECRET  verificacion de firma de webhooks entrantes
  CRESIUM_WEBHOOK_PUBLIC_URL  URL publica registrada en el panel de Cresium
                              (parte del string-to-sign del webhook entrante)
"""
from __future__ import annotations

import os

DEFAULT_BASE_URL = "https://api.cresium.app"


def _truthy(val: str | None) -> bool:
    return (val or "").strip().lower() in ("1", "true", "yes", "on")


# Secrets necesarios para los calls SALIENTES (transferencias). El webhook usa
# ademas CRESIUM_WEBHOOK_SECRET/PUBLIC_URL, validados en su propio path.
_OUTBOUND_SECRETS = ("CRESIUM_API_KEY", "CRESIUM_API_SECRET", "CRESIUM_COMPANY_ID")


def enabled() -> bool:
    return _truthy(os.environ.get("FEATURE_CRESIUM_REFUNDS_ENABLED"))


def missing_outbound_secrets() -> list[str]:
    return [v for v in _OUTBOUND_SECRETS if not (os.environ.get(v) or "").strip()]


def ready() -> bool:
    """True si el flag esta prendido Y estan las credenciales para transferir.
    Gate de los calls salientes — evita el estado 'flag=true pero falta un
    secret' que haria explotar un getter con RuntimeError mid-flight."""
    return enabled() and not missing_outbound_secrets()


def polling_enabled() -> bool:
    return _truthy(os.environ.get("FEATURE_CRESIUM_POLLING_ENABLED"))


def base_url() -> str:
    return (os.environ.get("CRESIUM_API_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _required(name: str) -> str:
    val = (os.environ.get(name) or "").strip()
    if not val:
        raise RuntimeError(f"{name} no esta configurado")
    return val


def api_key() -> str:
    return _required("CRESIUM_API_KEY")


def api_secret() -> str:
    return _required("CRESIUM_API_SECRET")


def company_id() -> str:
    return _required("CRESIUM_COMPANY_ID")


def webhook_secret() -> str:
    return _required("CRESIUM_WEBHOOK_SECRET")


def webhook_public_url() -> str | None:
    return (os.environ.get("CRESIUM_WEBHOOK_PUBLIC_URL") or "").strip() or None
