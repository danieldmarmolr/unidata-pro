"""Explorador de fuentes (M0): schemas, tablas, columnas, preview, samples, search."""
from __future__ import annotations

from collections import Counter
from typing import Annotated

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth.security import current_user
from app.db.engines import get_engine
from app.schemas.common import ColumnInfo, TableInfo

router = APIRouter(prefix="/api/sources", tags=["sources"])

_schema_cache: TTLCache = TTLCache(maxsize=8, ttl=300)
_tables_cache: TTLCache = TTLCache(maxsize=64, ttl=300)
_samples_cache: TTLCache = TTLCache(maxsize=256, ttl=600)

_UNSEARCHABLE_TYPES = {
    "bytea", "USER-DEFINED", "ARRAY", "json", "jsonb",
    "tsvector", "tsquery", "xml", "point", "polygon",
}


def _check_unit(unit: str) -> str:
    unit = unit.lower()
    if unit not in ("unistore", "unidrop", "unidev"):
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


@router.get("/{unit}/schemas/{schema}/tables/{table}/samples")
def column_samples(
    unit: Annotated[str, Path()],
    schema: Annotated[str, Path()],
    table: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
    sample_rows: int = 500,
    top: int = 3,
) -> dict:
    """Top-N valores mas frecuentes por columna, sobre una muestra de filas."""
    unit = _check_unit(unit)
    sample_rows = max(50, min(int(sample_rows), 2000))
    top = max(1, min(int(top), 5))
    cache_key = f"{unit}:{schema}:{table}:{sample_rows}:{top}"

    @cached(_samples_cache, key=lambda: cache_key)
    def _q() -> dict:
        eng = get_engine(unit)
        with eng.connect() as c:
            result = c.execute(
                text(f'SELECT * FROM "{schema}"."{table}" LIMIT :n'),
                {"n": sample_rows},
            )
            cols = list(result.keys())
            rows = result.all()
        samples: dict[str, list[dict]] = {}
        for idx, col in enumerate(cols):
            counter: Counter = Counter()
            for r in rows:
                v = r[idx]
                if v is None:
                    continue
                s = str(v)
                if not s.strip():
                    continue
                counter[s[:120]] += 1
            samples[col] = [
                {"value": val, "count": cnt} for val, cnt in counter.most_common(top)
            ]
        return {"samples": samples, "sampled_rows": len(rows)}

    return _q()


@router.get("/{unit}/schemas/{schema}/search")
def search_value(
    unit: Annotated[str, Path()],
    schema: Annotated[str, Path()],
    _: Annotated[str, Depends(current_user)],
    q: Annotated[str, Query(min_length=2, max_length=200)],
    max_tables: int = 60,
    per_query_timeout_ms: int = 4000,
) -> dict:
    """Busca un valor en todas las tablas del schema. Devuelve qué tabla.columna lo contienen.

    Por cada tabla, ejecuta una sola query con LATERAL VALUES que castea cada columna a text
    y hace ILIKE. Cada query corre con statement_timeout para descartar tablas lentas.
    """
    unit = _check_unit(unit)
    q = q.strip()
    if not q:
        raise HTTPException(400, "Query vacia")
    max_tables = max(1, min(int(max_tables), 200))

    eng = get_engine(unit)
    with eng.connect() as c:
        tables = c.execute(text("""
            SELECT c.relname AS table_name
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :s
              AND c.relkind IN ('r','p','m')
              AND c.reltuples >= 0
            ORDER BY pg_total_relation_size(c.oid) ASC
            LIMIT :lim
        """), {"s": schema, "lim": max_tables}).all()

        cols_by_table = c.execute(text("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = :s
              AND table_name = ANY(:tables)
            ORDER BY table_name, ordinal_position
        """), {
            "s": schema,
            "tables": [t.table_name for t in tables],
        }).all()

    cols_map: dict[str, list[str]] = {}
    for row in cols_by_table:
        if row.data_type in _UNSEARCHABLE_TYPES:
            continue
        cols_map.setdefault(row.table_name, []).append(row.column_name)

    like_pat = f"%{q}%"
    results: list[dict] = []
    scanned = 0
    skipped: list[str] = []

    for t_row in tables:
        tname = t_row.table_name
        cols = cols_map.get(tname, [])
        if not cols:
            continue
        scanned += 1
        values_sql = ", ".join(
            f"('{col.replace(chr(39), chr(39) * 2)}', \"{col}\"::text)" for col in cols
        )
        sql = f"""
            SELECT col_name, COUNT(*) AS match_count
            FROM "{schema}"."{tname}",
                 LATERAL (VALUES {values_sql}) AS v(col_name, val)
            WHERE val ILIKE :pat
            GROUP BY col_name
            ORDER BY match_count DESC
        """
        try:
            with eng.begin() as tx:
                tx.execute(text(f"SET LOCAL statement_timeout = {int(per_query_timeout_ms)}"))
                rows = tx.execute(text(sql), {"pat": like_pat}).all()
            if rows:
                results.append({
                    "table": tname,
                    "matches": [
                        {"column": r.col_name, "count": int(r.match_count)}
                        for r in rows
                    ],
                })
        except SQLAlchemyError:
            skipped.append(tname)
            continue

    results.sort(
        key=lambda x: sum(m["count"] for m in x["matches"]),
        reverse=True,
    )

    return {
        "query": q,
        "scanned": scanned,
        "skipped": skipped,
        "results": results,
    }
