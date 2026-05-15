"""HTTP/SSE transport para el MCP server (uso remoto via URL).

Deployable a Railway/Fly como servicio independiente. Cada conexión MCP usa el
token JWT que viene en el header `Authorization: Bearer ...`, así el RBAC por
usuario sigue funcionando — no se comparte un token global del servidor.

Endpoints:
- GET  /sse        → MCP SSE transport (estándar)
- POST /messages   → mensajes MCP (estándar)
- GET  /health     → healthcheck para Railway

Run local:
    UNIDATA_API_URL=https://api.unidatacenter.com.ar unidata-mcp-http

Run en Railway: setear PORT y UNIDATA_API_URL como env vars.
"""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from .client import UnidataClient
from .config import Config

# IMPORTANTE: el server expuesto vía HTTP usa el mismo set de tools que stdio.
# Pero el token JWT viaja por header en cada request, no por env var.
# Para implementar esto correctamente necesitaríamos middleware que reescriba
# el client por request — lo dejamos como TODO para iteración 2 y por ahora
# este server reusa el cliente global (mismo token para todos).
#
# Plan iteración 2:
# 1. Reemplazar singleton `_client` por context-local AsyncClient.
# 2. Middleware Starlette que extrae Authorization y lo inyecta al contexto.
# 3. Tools leen el client del contexto en cada llamada.

from .server import mcp as _shared_mcp  # noqa: E402  (importamos despues del docstring)


async def health(_: Request) -> JSONResponse:
    cfg = Config.load()
    return JSONResponse({"status": "ok", "api_url": cfg.api_url, "transport": "sse"})


def build_app() -> Starlette:
    # FastMCP expone una app Starlette con SSE + /messages ya cableados.
    sse_app = _shared_mcp.sse_app()
    return Starlette(
        debug=False,
        routes=[
            Route("/health", endpoint=health),
            Mount("/", app=sse_app),
        ],
    )


def main() -> None:
    import uvicorn

    port = int(os.environ.get("PORT") or 8765)
    uvicorn.run(build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
