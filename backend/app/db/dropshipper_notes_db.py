"""
Notas adjuntas a un dropshipper (o cualquier user de unistore/unidrop).

UNIDATA como source of truth: en vez de tener las notas en Slack/Notion,
viven aca. Visible en la vista 360 + queryable via MCP.

Tabla local en Supabase. Cualquier user UNIDATA puede crear/leer notas;
solo el autor (o un admin) puede editar. El archive es soft-delete.
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.dropshipper_notes")

_LOCK = threading.RLock()
_INITIALIZED = False

CATEGORIES = ("general", "cs", "billing", "support", "retention", "flag", "ops")


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS dropshipper_notes (
                    id               BIGSERIAL PRIMARY KEY,
                    dropshipper_id   BIGINT NOT NULL,
                    dropshipper_unit TEXT NOT NULL CHECK (dropshipper_unit IN ('unistore','unidrop')),
                    author_id        BIGINT NOT NULL,
                    author_email     TEXT NOT NULL,
                    note             TEXT NOT NULL,
                    category         TEXT NOT NULL DEFAULT 'general',
                    archived         BOOLEAN NOT NULL DEFAULT FALSE,
                    archived_by      BIGINT,
                    archived_at      TIMESTAMPTZ,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_dropnotes_target "
                "ON dropshipper_notes (dropshipper_unit, dropshipper_id, created_at DESC) "
                "WHERE archived = FALSE"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_dropnotes_author "
                "ON dropshipper_notes (author_id, created_at DESC)"
            )
        _INITIALIZED = True


def create_note(
    *,
    dropshipper_id: int,
    dropshipper_unit: str,
    author_id: int,
    author_email: str,
    note: str,
    category: str = "general",
) -> dict:
    init()
    if dropshipper_unit not in ("unistore", "unidrop"):
        raise ValueError(f"unit invalida: {dropshipper_unit}")
    if category not in CATEGORIES:
        raise ValueError(f"category invalida: {category}. Validas: {CATEGORIES}")
    if not note or not note.strip():
        raise ValueError("note vacio")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO dropshipper_notes
                (dropshipper_id, dropshipper_unit, author_id, author_email, note, category)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (dropshipper_id, dropshipper_unit, author_id, author_email, note.strip(), category),
        )
        return _to_dict(cur.fetchone())


def list_for_dropshipper(
    *,
    dropshipper_id: int,
    dropshipper_unit: str,
    include_archived: bool = False,
    limit: int = 50,
) -> list[dict]:
    init()
    sql = """
        SELECT * FROM dropshipper_notes
        WHERE dropshipper_id = %s AND dropshipper_unit = %s
    """
    params: list = [dropshipper_id, dropshipper_unit]
    if not include_archived:
        sql += " AND archived = FALSE"
    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return [_to_dict(r) for r in cur.fetchall()]


def get_note(note_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM dropshipper_notes WHERE id = %s", (note_id,))
        row = cur.fetchone()
    return _to_dict(row) if row else None


def update_note(
    note_id: int,
    *,
    note: str | None = None,
    category: str | None = None,
) -> dict | None:
    init()
    sets: list[str] = []
    params: list = []
    if note is not None:
        if not note.strip():
            raise ValueError("note vacio")
        sets.append("note = %s"); params.append(note.strip())
    if category is not None:
        if category not in CATEGORIES:
            raise ValueError(f"category invalida: {category}")
        sets.append("category = %s"); params.append(category)
    if not sets:
        return None
    sets.append("updated_at = NOW()")
    params.append(note_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"UPDATE dropshipper_notes SET {', '.join(sets)} WHERE id = %s AND archived = FALSE RETURNING *",
            params,
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def archive_note(note_id: int, archived_by: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE dropshipper_notes
            SET archived = TRUE, archived_by = %s, archived_at = NOW(), updated_at = NOW()
            WHERE id = %s AND archived = FALSE
            RETURNING *
            """,
            (archived_by, note_id),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def _to_dict(row: dict | None) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "archived_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d
