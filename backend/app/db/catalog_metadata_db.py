"""
Metadata curada de tablas del Data Catalog.

UNIDATA como source of truth de descripciones operativas de tablas — el equipo
anota "para que sirve esta tabla", "para que NO sirve", "ojo con esta columna",
"esta es la fuente cuando hay que..." y queda accesible desde el Explorador
+ MCP.

Tabla local en Supabase. Solo admin / gerencia / role con area="it_data"
pueden editar. Cualquier user UNIDATA puede leer.

Linkage: (unit, schema_name, table_name) es el natural key.
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.catalog_metadata")

_LOCK = threading.RLock()
_INITIALIZED = False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS catalog_metadata (
                    id               BIGSERIAL PRIMARY KEY,
                    unit             TEXT NOT NULL CHECK (unit IN ('unistore','unidrop','unidev')),
                    schema_name      TEXT NOT NULL,
                    table_name       TEXT NOT NULL,
                    description      TEXT,
                    tags             TEXT[] NOT NULL DEFAULT '{}',
                    updated_by_id    BIGINT,
                    updated_by_email TEXT,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (unit, schema_name, table_name)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_catalog_metadata_unit "
                "ON catalog_metadata (unit, schema_name, table_name)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_catalog_metadata_tags "
                "ON catalog_metadata USING GIN (tags)"
            )
        _INITIALIZED = True


def list_for_unit(unit: str) -> list[dict]:
    """Devuelve toda la metadata de una unit. Frontend la cachea client-side."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT unit, schema_name, table_name, description, tags,
                   updated_by_email, updated_at
            FROM catalog_metadata
            WHERE unit = %s
            ORDER BY schema_name, table_name
            """,
            (unit,),
        )
        return [_to_dict(r) for r in cur.fetchall()]


def get_for_table(unit: str, schema_name: str, table_name: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT unit, schema_name, table_name, description, tags,
                   updated_by_email, updated_at
            FROM catalog_metadata
            WHERE unit = %s AND schema_name = %s AND table_name = %s
            """,
            (unit, schema_name, table_name),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def upsert(
    *,
    unit: str,
    schema_name: str,
    table_name: str,
    description: str | None,
    tags: list[str] | None,
    updated_by_id: int,
    updated_by_email: str,
) -> dict:
    """Upsert (unit, schema, table). Description/tags se reemplazan si vienen no-None."""
    init()
    if unit not in ("unistore", "unidrop", "unidev"):
        raise ValueError(f"unit invalida: {unit}")
    if not schema_name or not table_name:
        raise ValueError("schema_name y table_name son obligatorios")

    norm_tags = []
    if tags is not None:
        seen: set[str] = set()
        for t in tags:
            if not isinstance(t, str):
                continue
            n = t.strip().lower()
            if not n or n in seen:
                continue
            if len(n) > 40:
                n = n[:40]
            seen.add(n)
            norm_tags.append(n)

    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO catalog_metadata
                (unit, schema_name, table_name, description, tags,
                 updated_by_id, updated_by_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (unit, schema_name, table_name)
            DO UPDATE SET
                description      = COALESCE(EXCLUDED.description, catalog_metadata.description),
                tags             = EXCLUDED.tags,
                updated_by_id    = EXCLUDED.updated_by_id,
                updated_by_email = EXCLUDED.updated_by_email,
                updated_at       = NOW()
            RETURNING unit, schema_name, table_name, description, tags,
                      updated_by_email, updated_at
            """,
            (
                unit,
                schema_name,
                table_name,
                (description.strip() if description and description.strip() else None) if description is not None else None,
                norm_tags if tags is not None else [],
                updated_by_id,
                updated_by_email,
            ),
        )
        return _to_dict(cur.fetchone())


def delete_metadata(unit: str, schema_name: str, table_name: str) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM catalog_metadata WHERE unit = %s AND schema_name = %s AND table_name = %s",
            (unit, schema_name, table_name),
        )
        return cur.rowcount > 0


def usage_stats(unit: str) -> dict[str, dict]:
    """
    Stats de uso por tabla, derivadas de query_runs (SQL libre).
    Match heuristico: busca el nombre de tabla en el sql usando regex word-boundary.

    Devuelve: { "schema.table": {"queries": N, "last_used_at": iso, "last_user": email} }

    NOTA: solo trackea queries del SQL libre. Las queries de dashboards
    no estan registradas en query_runs (estarian en logs del backend).
    """
    init()
    with get_conn() as c, c.cursor() as cur:
        # query_runs schema: ts, user (email), unit, sql, rows, duration_ms
        # Agregamos por substring del sql - no es perfecto pero es barato y
        # suficiente para "esta tabla se usa mucho/poco"
        cur.execute(
            """
            SELECT cm.schema_name,
                   cm.table_name,
                   COUNT(qr.id) AS queries,
                   MAX(qr.ts)   AS last_used_at,
                   (ARRAY_AGG(qr."user" ORDER BY qr.ts DESC))[1] AS last_user
            FROM catalog_metadata cm
            LEFT JOIN query_runs qr
                ON qr.unit = cm.unit
               AND qr.sql ~* ('\\m' || cm.schema_name || '\\.' || cm.table_name || '\\M')
            WHERE cm.unit = %s
            GROUP BY cm.schema_name, cm.table_name
            """,
            (unit,),
        )
        out: dict[str, dict] = {}
        for r in cur.fetchall():
            key = f"{r['schema_name']}.{r['table_name']}"
            out[key] = {
                "queries": int(r["queries"] or 0),
                "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
                "last_user": r["last_user"],
            }
        return out


def all_tags(unit: str) -> list[dict]:
    """Lista los tags unicos con su frequency, para autocompletar en el form."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT tag, COUNT(*)::int AS n
            FROM (
                SELECT UNNEST(tags) AS tag FROM catalog_metadata WHERE unit = %s
            ) x
            GROUP BY tag ORDER BY n DESC, tag ASC
            """,
            (unit,),
        )
        return [{"tag": r["tag"], "count": int(r["n"])} for r in cur.fetchall()]


def _to_dict(row: dict | None) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    if "tags" in d and d["tags"] is None:
        d["tags"] = []
    return d
