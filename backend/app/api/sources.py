"""Explorador de fuentes (M0): schemas, tablas, columnas, preview."""
from __future__ import annotations

from typing import Annotated

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text

from app.auth.security import current_user
from app.db.engines import get_engine
from app.schemas.common import ColumnInfo, TableInfo

router = APIRouter(prefix="/api/sources", tags=["sources"])

_schema_cache: TTLCache = TTLCache(maxsize=8, ttl=300)
_tables_cache: TTLCache = TTLCache(maxsize=64, ttl=300)


def _check_unit(unit: str) -> str:
    unit = unit.lower()
    if unit not in ("unistore", "unidrop"):
        raise HTTPException(404, f"Unidad desconocida: {unit}")
    return unit


@router.get("/{unit}/schemas", response_model=list[str])
def list_schemas(
    unit: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
) -> list[str]:
    unit = _check_unit(unit)

    @cached(_schema_cache, key=lambda: unit)
    def _q() -> list[str]:
        eng = get_engine(unit)
        with eng.connect() as c:
            rows = c.execute(text("""
                SELECT schema_name FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog','information_schema')
                  AND schema_name NOT LIKE 'pg_%'
                  AND schema_name NOT IN ('aws_dms_internal','rdsadmin')
                ORDER BY schema_name
            """))
            return [r[0] for r in rows]
    return _q()


@router.get("/{unit}/schemas/{schema}/tables", response_model=list[TableInfo])
def list_tables(
    unit: Annotated[str, Path()],
    schema: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
) -> list[TableInfo]:
    unit = _check_unit(unit)
    cache_key = f"{unit}:{schema}"

    @cached(_tables_cache, key=lambda: cache_key)
    def _q() -> list[TableInfo]:
        eng = get_engine(unit)
        with eng.connect() as c:
            rows = c.execute(text("""
                SELECT n.nspname AS schema, c.relname AS table_name,
                       c.reltuples::bigint AS approx_rows,
                       pg_total_relation_size(c.oid) AS size_bytes,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = :s AND c.relkind IN ('r','p','v','m')
                ORDER BY pg_total_relation_size(c.oid) DESC
            """), {"s": schema}).all()
        return [
            TableInfo(
                schema=r.schema, table_name=r.table_name,
                approx_rows=r.approx_rows or 0,
                size_bytes=r.size_bytes or 0, size_pretty=r.size_pretty or "",
            ) for r in rows
        ]
    return _q()


@router.get("/{unit}/schemas/{schema}/tables/{table}/columns", response_model=list[ColumnInfo])
def describe_table(
    unit: Annotated[str, Path()],
    schema: Annotated[str, Path()],
    table: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
) -> list[ColumnInfo]:
    unit = _check_unit(unit)
    eng = get_engine(unit)
    with eng.connect() as c:
        rows = c.execute(text("""
            SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                   CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE '' END AS pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON kcu.constraint_name = tc.constraint_name
                 AND kcu.table_schema    = tc.table_schema
                 AND kcu.table_name      = tc.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = :s AND tc.table_name = :t
            ) pk ON pk.column_name = c.column_name
            WHERE c.table_schema = :s AND c.table_name = :t
            ORDER BY c.ordinal_position
        """), {"s": schema, "t": table}).all()
    return [
        ColumnInfo(
            column_name=r.column_name, data_type=r.data_type,
            is_nullable=r.is_nullable, column_default=r.column_default, pk=r.pk,
        ) for r in rows
    ]


@router.get("/{unit}/schemas/{schema}/tables/{table}/preview")
def preview_table(
    unit: Annotated[str, Path()],
    schema: Annotated[str, Path()],
    table: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
    n: int = 100,
) -> dict:
    unit = _check_unit(unit)
    n = max(1, min(int(n), 1000))
    eng = get_engine(unit)
    with eng.connect() as c:
        result = c.execute(text(f'SELECT * FROM "{schema}"."{table}" LIMIT :n'), {"n": n})
        cols = list(result.keys())
        rows = [list(r) for r in result.all()]
    return {"columns": cols, "rows": rows, "row_count": len(rows)}
