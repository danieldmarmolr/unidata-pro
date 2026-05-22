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
                    priority         TEXT NOT NULL DEFAULT 'normal'
                                     CHECK (priority IN ('low','normal','high')),
                    deadline_at      TIMESTAMPTZ,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at     TIMESTAMPTZ
                )
            """)
            cur.execute("ALTER TABLE cs_actions ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'")
            cur.execute("ALTER TABLE cs_actions ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_status ON cs_actions (status, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_assigned ON cs_actions (assigned_to, status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_source ON cs_actions (source_type, source_key)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_actions_priority ON cs_actions (priority, deadline_at)")
            # Fase 3: status per-target para tracking granular de difusion
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cs_action_targets (
                    id             BIGSERIAL PRIMARY KEY,
                    action_id      BIGINT NOT NULL REFERENCES cs_actions(id) ON DELETE CASCADE,
                    target_id      BIGINT NOT NULL,
                    contact_status TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (contact_status IN ('pending','contacted','responded','converted','no_response','opt_out')),
                    contact_at     TIMESTAMPTZ,
                    response_at    TIMESTAMPTZ,
                    converted_at   TIMESTAMPTZ,
                    converted_amount NUMERIC(14,2),
                    notes          TEXT,
                    updated_by     INT,
                    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (action_id, target_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cs_action_targets_action ON cs_action_targets (action_id, contact_status)")
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
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
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
                   created_by, notes, priority, deadline_at,
                   created_at, updated_at, completed_at
            FROM cs_actions
            {where_sql}
            ORDER BY
                CASE status WHEN 'pending' THEN 0 WHEN 'doing' THEN 1
                            WHEN 'done' THEN 2 ELSE 3 END,
                CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                deadline_at NULLS LAST,
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
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
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
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
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
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (int(user_id), note or "", int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def reopen_action(action_id: int) -> dict | None:
    """Reabre una accion done/cancelled: vuelve a 'doing' si tenia assigned_to,
    sino a 'pending'. Limpia completed_at."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET status = CASE WHEN assigned_to IS NOT NULL THEN 'doing' ELSE 'pending' END,
                completed_at = NULL,
                updated_at = NOW()
            WHERE id = %s AND status IN ('done','cancelled')
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (int(action_id),),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def set_priority(action_id: int, priority: str) -> dict | None:
    if priority not in ("low", "normal", "high"):
        raise ValueError(f"priority invalida: {priority}")
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions SET priority = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (priority, int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def set_deadline(action_id: int, deadline_at: str | None) -> dict | None:
    """deadline_at: ISO string o None para limpiar."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions SET deadline_at = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (deadline_at, int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def assign_action(action_id: int, user_id: int | None) -> dict | None:
    """Asigna o re-asigna la accion. Si la accion esta pending y se asigna, queda en doing."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_actions
            SET assigned_to = %s,
                status = CASE WHEN status = 'pending' AND %s IS NOT NULL THEN 'doing' ELSE status END,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, source_type, source_key, unit, title, suggested_action,
                      target_ids, target_count, metadata, status, assigned_to,
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (int(user_id) if user_id is not None else None,
             int(user_id) if user_id is not None else None,
             int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def get_action(action_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, source_type, source_key, unit, title, suggested_action,
                   target_ids, target_count, metadata, status, assigned_to,
                   created_by, notes, priority, deadline_at,
                   created_at, updated_at, completed_at
            FROM cs_actions WHERE id = %s
            """,
            (int(action_id),),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


# ===========================================================================
# cs_action_targets (Fase 3): tracking granular de contactos en una difusion.
# ===========================================================================

def seed_targets_if_needed(action_id: int) -> int:
    """Crea entries en cs_action_targets para cada target_id de la accion,
    si todavia no existen. Idempotente. Devuelve cuantos se crearon."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cs_action_targets (action_id, target_id)
            SELECT a.id, unnest(a.target_ids)
            FROM cs_actions a
            WHERE a.id = %s
            ON CONFLICT (action_id, target_id) DO NOTHING
            """,
            (int(action_id),),
        )
        return cur.rowcount or 0


def list_targets(action_id: int) -> list[dict]:
    init()
    seed_targets_if_needed(action_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, target_id, contact_status, contact_at, response_at,
                   converted_at, converted_amount, notes, updated_by, updated_at
            FROM cs_action_targets
            WHERE action_id = %s
            ORDER BY id ASC
            """,
            (int(action_id),),
        )
        rows = cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("contact_at", "response_at", "converted_at", "updated_at"):
                if d.get(k) is not None and not isinstance(d[k], str):
                    d[k] = d[k].isoformat()
            if d.get("converted_amount") is not None:
                d["converted_amount"] = float(d["converted_amount"])
            out.append(d)
        return out


def set_target_status(
    action_id: int,
    target_id: int,
    contact_status: str,
    user_id: int,
    note: str | None = None,
    converted_amount: float | None = None,
) -> dict | None:
    valid = ("pending", "contacted", "responded", "converted", "no_response", "opt_out")
    if contact_status not in valid:
        raise ValueError(f"contact_status invalido: {contact_status}")
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cs_action_targets (action_id, target_id, contact_status,
                                            contact_at, response_at, converted_at,
                                            converted_amount, notes, updated_by, updated_at)
            VALUES (
              %s, %s, %s,
              CASE WHEN %s IN ('contacted','responded','converted') THEN NOW() END,
              CASE WHEN %s IN ('responded','converted') THEN NOW() END,
              CASE WHEN %s = 'converted' THEN NOW() END,
              %s, %s, %s, NOW()
            )
            ON CONFLICT (action_id, target_id) DO UPDATE
            SET contact_status = EXCLUDED.contact_status,
                contact_at = COALESCE(cs_action_targets.contact_at,
                  CASE WHEN EXCLUDED.contact_status IN ('contacted','responded','converted') THEN NOW() END),
                response_at = COALESCE(cs_action_targets.response_at,
                  CASE WHEN EXCLUDED.contact_status IN ('responded','converted') THEN NOW() END),
                converted_at = COALESCE(cs_action_targets.converted_at,
                  CASE WHEN EXCLUDED.contact_status = 'converted' THEN NOW() END),
                converted_amount = COALESCE(EXCLUDED.converted_amount, cs_action_targets.converted_amount),
                notes = COALESCE(NULLIF(EXCLUDED.notes,''), cs_action_targets.notes),
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            RETURNING id, target_id, contact_status, contact_at, response_at,
                      converted_at, converted_amount, notes, updated_by, updated_at
            """,
            (int(action_id), int(target_id), contact_status,
             contact_status, contact_status, contact_status,
             converted_amount, note or None, int(user_id)),
        )
        row = cur.fetchone()
        if row is None:
            return None
        d = dict(row)
        for k in ("contact_at", "response_at", "converted_at", "updated_at"):
            if d.get(k) is not None and not isinstance(d[k], str):
                d[k] = d[k].isoformat()
        if d.get("converted_amount") is not None:
            d["converted_amount"] = float(d["converted_amount"])
        return d


def action_stats(action_id: int) -> dict:
    init()
    seed_targets_if_needed(action_id)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*)::int                                                            AS total,
              COUNT(*) FILTER (WHERE contact_status = 'pending')::int                  AS pending,
              COUNT(*) FILTER (WHERE contact_status = 'contacted')::int                AS contacted,
              COUNT(*) FILTER (WHERE contact_status = 'responded')::int                AS responded,
              COUNT(*) FILTER (WHERE contact_status = 'converted')::int                AS converted,
              COUNT(*) FILTER (WHERE contact_status = 'no_response')::int              AS no_response,
              COUNT(*) FILTER (WHERE contact_status = 'opt_out')::int                  AS opt_out,
              COALESCE(SUM(converted_amount) FILTER (WHERE contact_status = 'converted'),0)::float AS converted_amount
            FROM cs_action_targets WHERE action_id = %s
            """,
            (int(action_id),),
        )
        row = cur.fetchone()
        if row is None:
            return {"total": 0, "pending": 0, "contacted": 0, "responded": 0, "converted": 0, "no_response": 0, "opt_out": 0, "converted_amount": 0.0}
        d = dict(row)
        d["contact_rate"] = round(((d["contacted"] + d["responded"] + d["converted"]) / d["total"]) * 100, 1) if d["total"] else 0.0
        d["conversion_rate"] = round((d["converted"] / d["total"]) * 100, 1) if d["total"] else 0.0
        return d


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
                      created_by, notes, priority, deadline_at,
                      created_at, updated_at, completed_at
            """,
            (note or "", int(action_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def _to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "completed_at", "deadline_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    if d.get("target_ids") is None:
        d["target_ids"] = []
    d.setdefault("priority", "normal")
    return d
