"""Endpoint del dashboard Ventas Unistore."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user, require_area
from app.schemas.common import SalesOverview
from app.services.sales import sales_unistore

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=32, ttl=60)


@router.get("/sales/unistore", response_model=SalesOverview)
def get_sales_unistore(
    user: Annotated[dict, Depends(current_user)],
    period: Annotated[Literal["today", "yesterday", "7d", "30d", "90d", "12m", "custom"], Query()] = "30d",
    channel: Annotated[Literal["all", "tn", "ml"], Query()] = "all",
    from_iso: Annotated[str | None, Query(alias="from")] = None,
    to_iso: Annotated[str | None, Query(alias="to")] = None,
) -> SalesOverview:
    require_area(user, ["ventas"])
    key = f"sales-uni:{period}:{channel}:{from_iso}:{to_iso}"

    @cached(_cache, key=lambda: key)
    def _build() -> dict:
        return sales_unistore(period, channel, from_iso, to_iso)

    return SalesOverview(**_build())
