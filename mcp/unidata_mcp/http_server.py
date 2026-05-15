"""HTTP/SSE transport del MCP server (uso remoto via URL).

Cada request lleva su propio JWT en el header `Authorization: Bearer ...`.
El middleware AuthMiddleware lo extrae y lo deposita en el contextvar
`_request_token` (definido en server.py), de modo que cada tool corre con
el contexto de auth correcto sin necesidad de pasar el token explicito por
firma.

Deploy en Railway:
- Service nuevo (separado de backend / frontend)
- Build: Dockerfile en mcp/Dockerfile
- Env: UNIDATA_API_URL=https://api.unidatacenter.com.ar
- URL publica: unidata-mcp.unidatacenter.com.ar (custom domain)
- Healthcheck: /health

Claude Desktop config remoto:
    {
      "mcpServers": {
        "unidata": {
          "url": "https://unidata-mcp.unidatacenter.com.ar/sse",
          "headers": {"Authorization": "Bearer eyJ..."}
        }
      }
    }
"""
from __future__ import annotations

import logging
import os

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from .config import Config
from .server import _request_token, mcp as _shared_mcp

log = logging.getLogger("unidata_mcp.http")


class AuthMiddleware(BaseHTTPMiddleware):
    """Extrae Authorization: Bearer <jwt> y lo deja en _request_token.

    No bloquea requests sin auth — deja pasar y los tools devuelven 401 legible
    si la API rechaza. Asi /health y otros endpoints publicos siguen funcionando.
    """

    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("authorization", "")
        token: str | None = None
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip() or None
        tk = _request_token.set(token)
        try:
            return await call_next(request)
        finally:
            _request_token.reset(tk)


async def health(_: Request) -> JSONResponse:
    cfg = Config.load()
    return JSONResponse({
        "status": "ok",
        "service": "unidata-mcp",
        "transport": "sse",
        "api_url": cfg.api_url,
    })


async def whoami_probe(request: Request) -> JSONResponse:
    """Endpoint de debug — confirma que el token llega al server."""
    auth = request.headers.get("authorization", "")
    has_token = auth.lower().startswith("bearer ") and len(auth) > 10
    suffix = auth[-8:] if has_token else ""
    return JSONResponse({
        "received_bearer_token": has_token,
        "token_suffix": suffix,
    })


def build_app() -> Starlette:
    sse_app = _shared_mcp.sse_app()
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        ),
        Middleware(AuthMiddleware),
    ]
    return Starlette(
        debug=False,
        middleware=middleware,
        routes=[
            Route("/health", endpoint=health),
            Route("/whoami-probe", endpoint=whoami_probe),
            Mount("/", app=sse_app),
        ],
    )


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    port = int(os.environ.get("PORT") or 8765)
    log.info("starting unidata-mcp HTTP/SSE on :%d", port)
    uvicorn.run(build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
