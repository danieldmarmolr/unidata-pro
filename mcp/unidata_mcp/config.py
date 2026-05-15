"""Config loader. Lee env vars con fallback a .env del directorio actual."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Carga .env del cwd y del directorio del paquete si existe
for candidate in (Path.cwd() / ".env", Path(__file__).parent.parent / ".env"):
    if candidate.exists():
        load_dotenv(candidate, override=False)


@dataclass(frozen=True)
class Config:
    api_url: str
    token: str | None
    timeout_s: float = 30.0

    @classmethod
    def load(cls) -> "Config":
        api_url = (os.environ.get("UNIDATA_API_URL") or "https://api.unidatacenter.com.ar").rstrip("/")
        token = os.environ.get("UNIDATA_TOKEN") or None
        timeout_s = float(os.environ.get("UNIDATA_TIMEOUT_S") or 30.0)
        return cls(api_url=api_url, token=token, timeout_s=timeout_s)
