"""
Cola de acciones para CS (Customer Success).

A diferencia de it_alerts (alertas tecnicas de IT), cs_actions son tareas
operacionales generadas desde cards/modales del dashboard (ej: "Generar accion
para CS" sobre un segmento RFM o una transicion de flujo).

Cada accion tiene:
- source_type: 'rfm_segment' | 'rfm_flow' | 'manual'
- source_key: ej "champions", "nuevo_este_mes->leales"
- unit: 'unistore' | 'unidrop'
- target_ids: lista de IDs (dropshippers o customers) a accionar
- suggested_action: la copy que vio el usuario en el modal
- status: 'pending' | 'doing' | 'done' | 'cancelled'
- assigned_to: user_id que tomo la accion
- notes: texto libre con seguimiento
"""
from __future__ import annotations

import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.cs_actions")

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
                CREATE TABLE IF NOT EXISTS cs_actions (
                    id               BIGSERIAL PRIMARY KEY,
                    source_type      TEXT NOT NULL,
                    source_key       TEXT NOT NULL,
                    unit             TEXT NOT NULL CHECK (unit IN ('unistore','unidrop')),
                    title            TEXT NOT NULL,
                    suggested_action TEXT NOT NULL,
                    target_ids       BIGINT[] NOT NULL DEFAULT '{}',
                    target_count     INT NOT NULL DEFAULT 0,
                    metadata         JSONB,
                    status           TEXT NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','doing','done','cancelled')),
                    assigned_to      INT,
                    created_by       INT NOT NULL,
                    notes            TEXT,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at     TIMESTAMPTZ
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_status ON cs_actions (status, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_assigned ON cs_actions (assigned_to, status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_source ON cs_actions (source_type, source_key)")
        _INITIALIZED = True


def create_action(
    *,
    source_type: str,
    source_key: str,
    unit: str,
    title: str,
    suggested_action: str,
    target_ids: list[int],
    created_by: int,
    metadata: dict | None = None,
) -> dict:
    init()
    if unit not in ("unistore", "unidrop"):
        raise ValueError(f"unit invalida: {unit}")
    if source_type not in ("rfm_segment", "rfm_flow", "manual"):
        raise ValueError(f"source_type invalido: {source_type}")
    ids = [int(x) for x in (target_ids or [])]
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cs_actions (source_type, source_key, unit, title,
                                    suggested_action, target_ids, target_count,
                                    metadata, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, created_at, updated_at, completed_at
            """,
            (source_type, source_key, unit, title, suggested_action, ids,
             len(ids), json.dumps(metadata or {}), int(created_by)),
        )
        return _to_dict(cur.fetchone())


def list_actions(
    *,
    status: str | None = None,
    unit: str | None = None,
    assigned_to: int | None = None,
    limit: int = 200,
) -> list[dict]:
    init()
    where: list[str] = []
    params: list = []
    if status:
        where.append("status = %s")
        params.append(status)
    if unit in ("unistore", "unidrop"):
        where.append("unit = %s")
        params.append(unit)
    if assigned_to is not None:
        where.append("assigned_to = %s")
        params.append(int(assigned_to))
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, source_type, source_key, unit, title, suggested_action,
                   target_ids, target_count, metadata, status, assigned_to,
                   created_by, notes, created_at, updated_at, completed_at
            FROM cs_actions
            {where_sql}
            ORDER BY
                CASE status WHEN 'pending' THEN 0 WHEN 'doing' THEN 1
                            WHEN 'done' THEN 2 ELSE 3 END,
                created_at DESC
            LIMIT %s
            """,
            params,
        )
        return [_to_dict(r) for r in cur.fetchall()]


def count_pending(unit: str | None = None) -> int:
    init()
    where = ["status IN ('pending','doing')"]
    params: list = []
    if unit in ("unistore", "unidrop"):
        where.append("unit = %s")
        params.append(unit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"SELECT COUNT(*)::int AS n FROM cs_actions WHERE {' AND '.join(where)}", params)
        row = cur.fetchone()
        if row is None:
            return 0
        try:
            return int(row[0] or 0)
        except (KeyError, TypeError):
            return int(row.get("n") or 0)


def take_action(action_id: int, user_id: int) -> dict | None:
    """CS toma la accion: status pending->doing, assigned_to=user_id."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET status = 'doing', assigned_to = %s, updated_at = NOW()
            WHERE id = %s AND status = 'pending'
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, created_at, updated_at, completed_at
            """,
            (int(user_id), int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def complete_action(action_id: int, user_id: int, note: str | None = None) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET status = 'done',
                assigned_to = COALESCE(assigned_to, %s),
                notes = COALESCE(NULLIF(%s, ''), notes),
                updated_at = NOW(),
                completed_at = NOW()
            WHERE id = %s AND status IN ('pending','doing')
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, created_at, updated_at, completed_at
            """,
            (int(user_id), note or "", int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def cancel_action(action_id: int, user_id: int, note: str | None = None) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET status = 'cancelled',
                assigned_to = COALESCE(assigned_to, %s),
                notes = COALESCE(NULLIF(%s, ''), notes),
                updated_at = NOW(),
                completed_at = NOW()
            WHERE id = %s AND status IN ('pending','doing')
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, created_at, updated_at, completed_at
            """,
            (int(user_id), note or "", int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def update_note(action_id: int, note: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET notes = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, created_at, updated_at, completed_at
            """,
            (note or "", int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def _to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "completed_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    if d.get("target_ids") is None:
        d["target_ids"] = []
    return d
