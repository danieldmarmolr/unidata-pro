"""UNIDATA backend - FastAPI entrypoint."""
from __future__ import annotations

import logging

from cachetools import TTLCache
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api import admin as admin_api
from app.api import auth as auth_api
from app.api import catalog as catalog_api
from app.api import costs as costs_api
from app.api import drilldowns as drilldowns_api
from app.api import profile as profile_api
from app.api import queries as queries_api
from app.api import reports as reports_api
from app.api import sources as sources_api
from app.db import areas_db, users_db
from app.api.dashboards import executive as executive_api
from app.api.dashboards import sales as sales_api
from app.api.dashboards import routers as dashboards_routers
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

settings = get_settings()

app = FastAPI(
    title="UNIDATA API",
    description="Plataforma de datos del grupo Unistore",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
)

# Rate limiter - protege endpoints sensibles (login, register) de brute-force.
# Identifica por IP saliente.
limiter = Limiter(key_func=get_remote_address, default_limits=[])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# HTTP-level cache para endpoints de dashboards/drilldowns. Cubre los 32
# endpoints que no tienen @cached(_cache) decorator a nivel servicio.
# TTL 180s = el mismo TTL que usa el cache interno de routers.py.
# Se saltea search/, users/me, notifications, y cualquier metodo no-GET.
_http_cache: TTLCache = TTLCache(maxsize=512, ttl=180)


@app.middleware("http")
async def cache_dashboards_middleware(request: Request, call_next):
    if request.method != "GET":
        return await call_next(request)
    path = request.url.path
    cacheable = (
        (path.startswith("/api/dashboards/") or path.startswith("/api/drilldowns/"))
        and "/search/" not in path
    )
    if not cacheable:
        return await call_next(request)
    # Cache key incluye user para evitar leak entre usuarios con permisos distintos
    auth_hdr = request.headers.get("authorization", "")
    cache_key = f"{path}?{request.url.query}|{auth_hdr[-32:]}"
    cached = _http_cache.get(cache_key)
    if cached is not None:
        return Response(
            content=cached["body"],
            media_type=cached["media_type"],
            status_code=200,
            headers={"X-Cache": "HIT"},
        )
    response = await call_next(request)
    if response.status_code == 200:
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        _http_cache[cache_key] = {"body": body, "media_type": response.media_type}
        return Response(
            content=body,
            media_type=response.media_type,
            status_code=200,
            headers={"X-Cache": "MISS"},
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    # Railway asigna URLs *.up.railway.app por deploy. Permitimos cualquier
    # subdominio Railway + previews de Vercel + localhost para que un cambio
    # de URL no rompa el front. ALLOWED_ORIGINS sigue siendo la lista
    # whitelisted explicita; este regex es el fallback.
    allow_origin_regex=r"^https?://(localhost(:\d+)?|.*\.up\.railway\.app|.*\.vercel\.app|(.+\.)?unidatacenter\.com\.ar)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    users_db.init()
    areas_db.init()
    from app.db import carga_digip_db as _carga_db
    _carga_db.init()
    from app.db import jira_flow_db as _jira_flow_db
    try:
        _jira_flow_db.init()
    except Exception as e:
        logging.warning("jira_flow_db init: %s", e)

app.include_router(auth_api.router)
app.include_router(admin_api.router)
app.include_router(profile_api.router)
app.include_router(sources_api.router)
app.include_router(queries_api.router)
app.include_router(drilldowns_api.router)
app.include_router(catalog_api.router)
app.include_router(executive_api.router)
app.include_router(sales_api.router)
app.include_router(dashboards_routers.router)
app.include_router(reports_api.router)
app.include_router(costs_api.router)

from app.api import skus as skus_api
app.include_router(skus_api.router)

from app.api import exports as exports_api
app.include_router(exports_api.router)

from app.api import notifications as notifications_api
app.include_router(notifications_api.router)

from app.api import cs_actions as cs_actions_api
app.include_router(cs_actions_api.router)

from app.api import dropshipper_notes as dropshipper_notes_api
app.include_router(dropshipper_notes_api.router)

from app.api import reminders as reminders_api
app.include_router(reminders_api.router)

from app.api import meta_ads as meta_ads_api
app.include_router(meta_ads_api.router)

from app.api import logistica as logistica_api
app.include_router(logistica_api.router)

from app.api import jira_flow as jira_flow_api
app.include_router(jira_flow_api.router)

from app.api import refund_requests as refund_requests_api
app.include_router(refund_requests_api.router)

from app.api import public_refund_requests as public_refund_requests_api
app.include_router(public_refund_requests_api.router)

from app.api import flujo_fondos as flujo_fondos_api
app.include_router(flujo_fondos_api.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {"name": "UNIDATA API", "docs": "/api/docs"}
