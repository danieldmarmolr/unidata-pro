"""UNIDATA backend - FastAPI entrypoint."""
from __future__ import annotations

import hashlib
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
from app.api.dashboards import gerencia as gerencia_api
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
    # Cache key incluye user para evitar leak entre usuarios con permisos distintos.
    # Usamos SHA256 del header completo en vez de los ultimos 32 chars (que es la
    # firma del JWT) para evitar colisiones de fingerprint entre tokens.
    auth_hdr = request.headers.get("authorization", "")
    auth_fp = hashlib.sha256(auth_hdr.encode("utf-8")).hexdigest()[:16] if auth_hdr else "anon"
    cache_key = f"{path}?{request.url.query}|{auth_fp}"
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
    # Restringido al dominio productivo + previews Railway PROPIOS del proyecto
    # + localhost dev. Se quito el wildcard `.*\.vercel\.app` (cualquiera puede
    # registrarse un proyecto Vercel y atacar via CORS con credentials=true) y
    # se quito el wildcard `.*\.up\.railway\.app` (mismo problema con cuentas
    # Railway ajenas). Solo aceptamos subdominios *propios* del proyecto.
    allow_origin_regex=(
        r"^https?://("
        r"localhost(:\d+)?"
        r"|127\.0\.0\.1(:\d+)?"
        r"|(.+\.)?unidatacenter\.com\.ar"
        r"|(frontend|backend|mcp)(-production)?-[a-z0-9]+\.up\.railway\.app"
        r")$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Security headers - aplicado a todas las respuestas. No incluye CSP porque la
# app tiene inline-scripts de Next.js y eso requiere un CSP con nonce dinamico.
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
    return response


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
    from app.db import mcp_tokens_db as _mcp_tokens_db
    try:
        _mcp_tokens_db.init()
    except Exception as e:
        logging.warning("mcp_tokens_db init: %s", e)
    from app.db import people_db as _people_db
    try:
        _people_db.init()
    except Exception as e:
        logging.warning("people_db init: %s", e)
    from app.db import people_hr_db as _people_hr_db
    try:
        _people_hr_db.init()
    except Exception as e:
        logging.warning("people_hr_db init: %s", e)
    from app.db import aprende_db as _aprende_db
    try:
        _aprende_db.init()
    except Exception as e:
        logging.warning("aprende_db init: %s", e)
    from app.db import personal_db as _personal_db
    try:
        _personal_db.init()
    except Exception as e:
        logging.warning("personal_db init: %s", e)
    from app.db import refund_telemetry_db as _refund_telemetry_db
    try:
        _refund_telemetry_db.init()
    except Exception as e:
        logging.warning("refund_telemetry_db init: %s", e)
    from app.db import churn_insights_db as _churn_insights_db
    try:
        _churn_insights_db.init()
    except Exception as e:
        logging.warning("churn_insights_db init: %s", e)
    # Background scheduler (auto-cumples diario)
    try:
        from app.jobs.scheduler import start_scheduler
        start_scheduler()
    except Exception as e:
        logging.warning("scheduler init: %s", e)
    # NOTE: costs_db.init() se mantiene lazy (se inicializa en el primer request).
    # El deadlock que daba en local con --reload esta arreglado en costs_db.py
    # via information_schema check antes de ALTER TABLE. Meterlo en startup
    # bloqueaba el boot de Railway > 60s healthcheck timeout = 502 en prod.

app.include_router(auth_api.router)
app.include_router(admin_api.router)
app.include_router(profile_api.router)
app.include_router(sources_api.router)
app.include_router(queries_api.router)
app.include_router(drilldowns_api.router)
app.include_router(catalog_api.router)
app.include_router(executive_api.router)
app.include_router(gerencia_api.router)
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

from app.api import cs_templates as cs_templates_api
app.include_router(cs_templates_api.router)

from app.api import cs_cron as cs_cron_api
app.include_router(cs_cron_api.router)

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

from app.api import ml_return_actions as ml_return_actions_api
app.include_router(ml_return_actions_api.router)

from app.api import flujo_fondos as flujo_fondos_api
app.include_router(flujo_fondos_api.router)

from app.api import catalog_metadata as catalog_metadata_api
app.include_router(catalog_metadata_api.router)

from app.api import logistics_targets as logistics_targets_api
app.include_router(logistics_targets_api.router)

from app.api import people as people_api
app.include_router(people_api.router)

from app.api import people_hr as people_hr_api
app.include_router(people_hr_api.router)

from app.api import aprende as aprende_api
app.include_router(aprende_api.router)

from app.api import personal as personal_api
app.include_router(personal_api.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {"name": "UNIDATA API", "docs": "/api/docs"}
