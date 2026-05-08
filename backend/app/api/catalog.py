"""Endpoints del Data Catalog (ER diagram + busqueda de columnas)."""
from __future__ import annotations

from typing import Annotated, Literal

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, Query

from app.auth.security import current_user
from app.services import catalog as svc

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

_cache: TTLCache = TTLCache(maxsize=16, ttl=300)


Unit = Literal["unistore", "unidrop", "unidev"]


@router.get("/global/graph")
def get_global_graph(
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    @cached(_cache, key=lambda: "global_graph")
    def _b() -> dict:
        return svc.global_graph()
    return _b()


@router.get("/global/schemas")
def get_global_schemas(
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    @cached(_cache, key=lambda: "global_schemas")
    def _b() -> dict:
        return svc.schemas_overview()
    return _b()


@router.get("/global/cross-db")
def get_cross_db_subgraph(
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    @cached(_cache, key=lambda: "global_cross_db")
    def _b() -> dict:
        return svc.cross_db_subgraph()
    return _b()


@router.get("/{unit}/graph")
def get_graph(
    unit: Annotated[Unit, ...],
    _: Annotated[dict, Depends(current_user)],
    with_columns: bool = Query(default=True),
) -> dict:
    @cached(_cache, key=lambda: f"graph:{unit}:{with_columns}")
    def _b() -> dict:
        return svc.graph_with_columns(unit) if with_columns else svc.graph(unit)
    return _b()


@router.get("/{unit}/tables")
def get_tables(
    unit: Annotated[Unit, ...],
    _: Annotated[dict, Depends(current_user)],
) -> list[dict]:
    @cached(_cache, key=lambda: f"tables:{unit}")
    def _b():
        return svc.list_tables(unit)
    return _b()


@router.get("/{unit}/columns")
def get_columns(
    unit: Annotated[Unit, ...],
    _: Annotated[dict, Depends(current_user)],
    schema: str | None = Query(default=None),
    table: str | None = Query(default=None),
) -> list[dict]:
    return svc.list_columns(unit, schema, table)


@router.get("/{unit}/search")
def search(
    unit: Annotated[Unit, ...],
    q: Annotated[str, Query(min_length=1)],
    _: Annotated[dict, Depends(current_user)],
    limit: int = 100,
) -> list[dict]:
    return svc.search_columns(unit, q, max(1, min(int(limit), 500)))


@router.get("/{unit}/foreign-keys")
def get_foreign_keys(
    unit: Annotated[Unit, ...],
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    explicit = svc.list_foreign_keys(unit)
    implicit = svc.implicit_relations(unit)
    return {"explicit": explicit, "implicit": implicit}
