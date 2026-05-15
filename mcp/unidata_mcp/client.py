"""HTTP client async para la API UNIDATA. Maneja JWT + errores legibles."""
from __future__ import annotations

from typing import Any

import httpx

from .config import Config


class UnidataError(Exception):
    """Error de API con mensaje legible para devolver al LLM."""


class UnidataClient:
    def __init__(self, cfg: Config):
        self._cfg = cfg
        self._client: httpx.AsyncClient | None = None

    async def _ensure(self) -> httpx.AsyncClient:
        if self._client is None:
            headers: dict[str, str] = {"User-Agent": "unidata-mcp/0.1"}
            if self._cfg.token:
                headers["Authorization"] = f"Bearer {self._cfg.token}"
            self._client = httpx.AsyncClient(
                base_url=self._cfg.api_url,
                headers=headers,
                timeout=self._cfg.timeout_s,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        client = await self._ensure()
        try:
            r = await client.get(path, params=params or {})
        except httpx.HTTPError as e:
            raise UnidataError(f"No se pudo conectar a {self._cfg.api_url}{path}: {e}") from e
        return _parse(r, path)

    async def post(self, path: str, json: dict[str, Any] | None = None) -> Any:
        client = await self._ensure()
        try:
            r = await client.post(path, json=json or {})
        except httpx.HTTPError as e:
            raise UnidataError(f"No se pudo conectar a {self._cfg.api_url}{path}: {e}") from e
        return _parse(r, path)


def _parse(r: httpx.Response, path: str) -> Any:
    if r.status_code == 401:
        raise UnidataError(
            "Token JWT inválido o expirado. Actualizá UNIDATA_TOKEN: "
            "abrí app.unidatacenter.com.ar, F12 → Application → Local Storage → "
            "copiá el valor de 'unidata.token' y reemplazalo en la config del MCP."
        )
    if r.status_code == 403:
        raise UnidataError(
            f"Tu usuario no tiene permisos para {path}. Pedile a un admin que te asigne el rol/área correctos."
        )
    if r.status_code == 404:
        raise UnidataError(f"No existe el recurso {path}.")
    if r.status_code >= 500:
        raise UnidataError(f"Error del servidor UNIDATA ({r.status_code}) en {path}: {r.text[:200]}")
    if r.status_code >= 400:
        raise UnidataError(f"Request inválido en {path} ({r.status_code}): {r.text[:300]}")
    try:
        return r.json()
    except ValueError:
        return {"raw": r.text}
