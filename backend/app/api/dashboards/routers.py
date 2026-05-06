"""Endpoints de los dashboards de las fases 2-7."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.services import envios as envios_svc
from app.services import finanzas as finanzas_svc
from app.services import logistica as logistica_svc
from app.services import marketing as marketing_svc
from app.services import pagos as pagos_svc
from app.services import saas as saas_svc

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=64, ttl=60)


@router.get("/saas/unidrop")
def get_saas_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
    segment: Annotated[Literal["all", "b2b", "b2c"], Query()] = "all",
) -> dict:
    key = f"saas-uni:{period}:{segment}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return saas_svc.saas_unidrop(period, segment)
    return _b()


@router.get("/logistica/unistore")
def get_logistica_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
    area: Annotated[str, Query()] = "all",
) -> dict:
    key = f"log-uni:{period}:{area}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return logistica_svc.logistica_unistore(period, area)
    return _b()


@router.get("/finanzas/unistore")
def get_finanzas_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
) -> dict:
    key = f"fin-uni:{period}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return finanzas_svc.finanzas_unistore(period)
    return _b()


@router.get("/marketing/unistore")
def get_marketing_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
) -> dict:
    key = f"mkt-uni:{period}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unistore(period)
    return _b()


@router.get("/marketing/unidrop")
def get_marketing_unidrop(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
) -> dict:
    key = f"mkt-drp:{period}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return marketing_svc.marketing_unidrop(period)
    return _b()


@router.get("/pagos/unidrop")
def get_pagos(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
    flow: Annotated[Literal["all", "orders", "subscriptions"], Query()] = "all",
) -> dict:
    key = f"pagos:{period}:{flow}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return pagos_svc.pagos_unidrop(period, flow)
    return _b()


@router.get("/envios/unidrop")
def get_envios(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
    courier: Annotated[Literal["all", "oca", "lightdata"], Query()] = "all",
) -> dict:
    key = f"env:{period}:{courier}"
    @cached(_cache, key=lambda: key)
    def _b() -> dict:
        return envios_svc.envios_unidrop(period, courier)
    return _b()
