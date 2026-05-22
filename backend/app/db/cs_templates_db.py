"""Templates de mensajes persistentes para difusion CS.

Cada template puede taggearse a un source_type (rfm_segment / cohort / manual /
rfm_flow) y unit (unistore / unidrop). Cuando una accion convierte targets,
sumamos al template las stats agregadas, asi el equipo ve cual funciona mejor.
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.cs_templates")

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
                CREATE TABLE IF NOT EXISTS cs_templates (
                    id              BIGSERIAL PRIMARY KEY,
                    name            TEXT NOT NULL,
                    body            TEXT NOT NULL,
                    source_type     TEXT,
                    unit            TEXT CHECK (unit IS NULL OR unit IN ('unistore','unidrop')),
                    created_by      INT NOT NULL,
                    times_used      INT NOT NULL DEFAULT 0,
                    last_used_at    TIMESTAMPTZ,
                    -- KPIs agregados (se calculan on-demand via SQL hoy, no se guardan)
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    archived_at     TIMESTAMPTZ
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_cs_templates_source ON cs_templates
                  (source_type, unit) WHERE archived_at IS NULL
            """)
            # Vincular template usado en una accion (para tracking de performance)
            cur.execute("""
                ALTER TABLE cs_actions
                  ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES cs_templates(id) ON DELETE SET NULL
            """)
        _INITIALIZED = True


def create(*, name: str, body: str, source_type: str | None, unit: str | None, created_by: int) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cs_templates (name, body, source_type, unit, created_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, name, body, source_type, unit, created_by, times_used,
                      last_used_at, created_at, updated_at, archived_at
            """,
            (name, body, source_type or None, unit or None, int(created_by)),
        )
        return _to_dict(cur.fetchone())


def update(template_id: int, *, name: str | None, body: str | None) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_templates
            SET name = COALESCE(%s, name),
                body = COALESCE(%s, body),
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, name, body, source_type, unit, created_by, times_used,
                      last_used_at, created_at, updated_at, archived_at
            """,
            (name, body, int(template_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def archive(template_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cs_templates SET archived_at = NOW() WHERE id = %s AND archived_at IS NULL",
            (int(template_id),),
        )
        return (cur.rowcount or 0) > 0


def list_templates(source_type: str | None = None, unit: str | None = None, include_archived: bool = False) -> list[dict]:
    """Lista templates con stats agregadas: cuantas acciones lo usaron,
    cuantos targets contactados/convertidos y la conversion_rate."""
    init()
    where = []
    params: list = []
    if not include_archived:
        where.append("t.archived_at IS NULL")
    if source_type:
        where.append("t.source_type = %s")
        params.append(source_type)
    if unit in ("unistore", "unidrop"):
        where.append("t.unit = %s")
        params.append(unit)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT t.id, t.name, t.body, t.source_type, t.unit, t.created_by,
                   t.times_used, t.last_used_at, t.created_at, t.updated_at, t.archived_at,
                   COALESCE(s.actions_count, 0)::int AS actions_count,
                   COALESCE(s.targets_count, 0)::int AS targets_count,
                   COALESCE(s.contacted, 0)::int AS contacted,
                   COALESCE(s.responded, 0)::int AS responded,
                   COALESCE(s.converted, 0)::int AS converted,
                   COALESCE(s.converted_amount, 0)::float AS converted_amount,
                   CASE WHEN s.targets_count > 0
                        THEN ROUND((s.converted::numeric / s.targets_count) * 100, 1)
                        ELSE 0 END                AS conversion_rate
            FROM cs_templates t
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT a.id)::int                                                       AS actions_count,
                       COUNT(tg.id)::int                                                                AS targets_count,
                       COUNT(*) FILTER (WHERE tg.contact_status IN ('contacted','responded','converted'))::int AS contacted,
                       COUNT(*) FILTER (WHERE tg.contact_status IN ('responded','converted'))::int     AS responded,
                       COUNT(*) FILTER (WHERE tg.contact_status = 'converted')::int                    AS converted,
                       COALESCE(SUM(tg.converted_amount), 0)::float                                    AS converted_amount
                FROM cs_actions a
                LEFT JOIN cs_action_targets tg ON tg.action_id = a.id
                WHERE a.template_id = t.id
            ) s ON TRUE
            {where_sql}
            ORDER BY conversion_rate DESC NULLS LAST, t.times_used DESC, t.created_at DESC
            """,
            params,
        )
        return [_to_dict(r) for r in cur.fetchall()]


def get(template_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, body, source_type, unit, created_by, times_used,
                   last_used_at, created_at, updated_at, archived_at
            FROM cs_templates WHERE id = %s
            """,
            (int(template_id),),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def mark_used(template_id: int) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE cs_templates
            SET times_used = times_used + 1, last_used_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (int(template_id),),
        )


def attach_to_action(action_id: int, template_id: int | None) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE cs_actions SET template_id = %s, updated_at = NOW() WHERE id = %s",
            (int(template_id) if template_id else None, int(action_id)),
        )


def _to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "archived_at", "last_used_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d
