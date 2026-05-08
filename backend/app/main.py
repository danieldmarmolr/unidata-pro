"""UNIDATA backend - FastAPI entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin as admin_api
from app.api import auth as auth_api
from app.api import catalog as catalog_api
from app.api import costs as costs_api
from app.api import drilldowns as drilldowns_api
from app.api import queries as queries_api
from app.api import reports as reports_api
from app.api import sources as sources_api
from app.db import users_db
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    users_db.init()

app.include_router(auth_api.router)
app.include_router(admin_api.router)
app.include_router(sources_api.router)
app.include_router(queries_api.router)
app.include_router(drilldowns_api.router)
app.include_router(catalog_api.router)
app.include_router(executive_api.router)
app.include_router(sales_api.router)
app.include_router(dashboards_routers.router)
app.include_router(reports_api.router)
app.include_router(costs_api.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/_meta/outbound-ip")
def outbound_ip() -> dict:
    """Endpoint temporal de diagnostico - devuelve la IP saliente del container.
    Sirve para configurar allowlists en bastions de AWS. Borrar despues de usar."""
    import urllib.request
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=5) as r:
            ip = r.read().decode().strip()
        return {"outbound_ip": ip}
    except Exception as e:
        return {"error": str(e)}


@app.get("/")
def root() -> dict:
    return {"name": "UNIDATA API", "docs": "/api/docs"}
