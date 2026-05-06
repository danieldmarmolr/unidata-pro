"""Endpoint del dashboard gerencial (cross-unidad)."""
from __future__ import annotations

from typing import Annotated

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends

from app.auth.security import current_user
from app.schemas.common import ExecutiveOverview
from app.services.dashboards import executive_overview

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

_cache: TTLCache = TTLCache(maxsize=4, ttl=60)


@router.get("/executive", response_model=ExecutiveOverview)
def get_executive(
    _: Annotated[str, Depends(current_user)],
) -> ExecutiveOverview:
    @cached(_cache, key=lambda: "executive")
    def _build() -> dict:
        return executive_overview()
    return ExecutiveOverview(**_build())
