"""Endpoint del dashboard Ventas Unistore."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.schemas.common import SalesOverview
from app.services.sales import sales_unistore

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=32, ttl=60)


@router.get("/sales/unistore", response_model=SalesOverview)
def get_sales_unistore(
    _: Annotated[str, Depends(current_user)],
    period: Annotated[Literal["7d", "30d", "90d", "12m"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
) -> SalesOverview:
    key = f"sales-uni:{period}:{channel}"

    @cached(_cache, key=lambda: key)
    def _build() -> dict:
        return sales_unistore(period, channel)

    return SalesOverview(**_build())
