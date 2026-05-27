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
        where.append("a.status = %s")
        params.append(status)
    if unit in ("unistore", "unidrop"):
        where.append("a.unit = %s")
        params.append(unit)
    if assigned_to is not None:
        where.append("a.assigned_to = %s")
        params.append(int(assigned_to))
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT a.id, a.source_type, a.source_key, a.unit, a.title, a.suggested_action,
                   a.target_ids, a.target_count, a.metadata, a.status, a.assigned_to,
                   a.created_by, a.notes, a.priority, a.deadline_at,
                   a.created_at, a.updated_at, a.completed_at,
                   ua.name AS assigned_name, ua.avatar_url AS assigned_avatar_url,
                   uc.name AS created_by_name, uc.avatar_url AS created_by_avatar_url
            FROM cs_actions a
            LEFT JOIN users ua ON ua.id = a.assigned_to
            LEFT JOIN users uc ON uc.id = a.created_by
            {where_sql}
            ORDER BY
                CASE a.status WHEN 'pending' THEN 0 WHEN 'doing' THEN 1
                              WHEN 'done' THEN 2 ELSE 3 END,
                CASE a.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                a.deadline_at NULLS LAST,
                a.created_at DESC
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


def list_open_targets_for_reconcile(unit: str, days: int = 60) -> list[dict]:
    """Devuelve action_id + target_id + contact_at + unit de targets contacted
    o responded en los ultimos N dias, que aun no estan convertidos.
    Sirve para que el reconcile haga el cross-join contra orders pagadas."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT a.id AS action_id, tg.target_id, tg.contact_at, a.unit
            FROM cs_action_targets tg
            JOIN cs_actions a ON a.id = tg.action_id
            WHERE a.unit = %s
              AND tg.contact_status IN ('contacted', 'responded')
              AND tg.contact_at IS NOT NULL
              AND tg.contact_at >= NOW() - (%s::int || ' days')::interval
            """,
            (unit, int(days)),
        )
        out = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get("contact_at") is not None and not isinstance(d["contact_at"], str):
                d["contact_at"] = d["contact_at"].isoformat()
            out.append(d)
        return out


def mark_converted_bulk(rows: list[dict]) -> int:
    """rows: list of {action_id, target_id, amount}. Inserta o actualiza
    cs_action_targets con status=converted + converted_at=NOW() + amount.
    Devuelve cuantas filas se afectaron."""
    if not rows:
        return 0
    init()
    affected = 0
    with get_conn() as c, c.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO cs_action_targets (action_id, target_id, contact_status,
                                                contact_at, response_at, converted_at,
                                                converted_amount, updated_at)
                VALUES (%s, %s, 'converted', COALESCE(NOW(), NOW()), NOW(), NOW(), %s, NOW())
                ON CONFLICT (action_id, target_id) DO UPDATE
                SET contact_status = 'converted',
                    converted_at = COALESCE(cs_action_targets.converted_at, NOW()),
                    response_at  = COALESCE(cs_action_targets.response_at, NOW()),
                    converted_amount = COALESCE(cs_action_targets.converted_amount, 0) + EXCLUDED.converted_amount,
                    updated_at = NOW()
                """,
                (int(r["action_id"]), int(r["target_id"]), float(r["amount"])),
            )
            affected += cur.rowcount or 0
    return affected


def performance_summary(days: int = 60) -> dict:
    """Funnel + ROI por source_type. Sirve para /cs/performance dashboard."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            WITH base AS (
              SELECT a.id, a.source_type, a.unit, a.status, a.priority, a.created_at,
                     a.template_id,
                     (SELECT COUNT(*) FROM cs_action_targets t WHERE t.action_id = a.id)::int AS total,
                     (SELECT COUNT(*) FROM cs_action_targets t WHERE t.action_id = a.id AND t.contact_status IN ('contacted','responded','converted'))::int AS contacted,
                     (SELECT COUNT(*) FROM cs_action_targets t WHERE t.action_id = a.id AND t.contact_status IN ('responded','converted'))::int AS responded,
                     (SELECT COUNT(*) FROM cs_action_targets t WHERE t.action_id = a.id AND t.contact_status = 'converted')::int AS converted,
                     (SELECT COALESCE(SUM(t.converted_amount),0)::float FROM cs_action_targets t WHERE t.action_id = a.id AND t.contact_status = 'converted') AS revenue
              FROM cs_actions a
              WHERE a.created_at >= NOW() - (%s::int || ' days')::interval
            )
            SELECT 'overall' AS dim, NULL AS value, COUNT(*)::int AS actions,
                   COALESCE(SUM(total),0)::int AS total, COALESCE(SUM(contacted),0)::int AS contacted,
                   COALESCE(SUM(responded),0)::int AS responded, COALESCE(SUM(converted),0)::int AS converted,
                   COALESCE(SUM(revenue),0)::float AS revenue
            FROM base
            UNION ALL
            SELECT 'source_type' AS dim, source_type AS value, COUNT(*)::int,
                   COALESCE(SUM(total),0)::int, COALESCE(SUM(contacted),0)::int,
                   COALESCE(SUM(responded),0)::int, COALESCE(SUM(converted),0)::int,
                   COALESCE(SUM(revenue),0)::float
            FROM base GROUP BY source_type
            UNION ALL
            SELECT 'unit' AS dim, unit AS value, COUNT(*)::int,
                   COALESCE(SUM(total),0)::int, COALESCE(SUM(contacted),0)::int,
                   COALESCE(SUM(responded),0)::int, COALESCE(SUM(converted),0)::int,
                   COALESCE(SUM(revenue),0)::float
            FROM base GROUP BY unit
            UNION ALL
            SELECT 'status' AS dim, status AS value, COUNT(*)::int,
                   COALESCE(SUM(total),0)::int, COALESCE(SUM(contacted),0)::int,
                   COALESCE(SUM(responded),0)::int, COALESCE(SUM(converted),0)::int,
                   COALESCE(SUM(revenue),0)::float
            FROM base GROUP BY status
            """,
            (int(days),),
        )
        rows = cur.fetchall()

    out: dict = {"overall": {}, "by_source_type": [], "by_unit": [], "by_status": [], "days": days}
    for r in rows:
        d = dict(r)
        dim = d.pop("dim")
        rec = {
            "actions": d["actions"], "total": d["total"], "contacted": d["contacted"],
            "responded": d["responded"], "converted": d["converted"], "revenue": d["revenue"],
            "contact_rate": round((d["contacted"] / d["total"]) * 100, 1) if d["total"] else 0.0,
            "response_rate": round((d["responded"] / d["total"]) * 100, 1) if d["total"] else 0.0,
            "conversion_rate": round((d["converted"] / d["total"]) * 100, 1) if d["total"] else 0.0,
        }
        if dim == "overall":
            out["overall"] = rec
        else:
            entry = {"value": d.get("value") or "—", **rec}
            out[f"by_{dim}"].append(entry)
    out["by_source_type"].sort(key=lambda x: -x["revenue"])
    out["by_unit"].sort(key=lambda x: -x["revenue"])
    out["by_status"].sort(key=lambda x: -x["actions"])
    return out


def touchpoints_for_target(target_id: int, unit: str) -> list[dict]:
    """Devuelve TODAS las cs_actions que touchearon a un customer/dropshipper,
    con outcome de cada touchpoint. Sirve para el timeline 360.

    Ordenado por created_at DESC (mas reciente arriba)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT a.id              AS action_id,
                   a.title           AS title,
                   a.source_type     AS source_type,
                   a.source_key      AS source_key,
                   a.unit            AS unit,
                   a.priority        AS priority,
                   a.status          AS status,
                   a.created_at      AS action_created_at,
                   t.contact_status  AS contact_status,
                   t.contact_at      AS contact_at,
                   t.response_at     AS response_at,
                   t.converted_at    AS converted_at,
                   t.converted_amount AS converted_amount,
                   t.notes           AS reply_notes
            FROM cs_action_targets t
            JOIN cs_actions a ON a.id = t.action_id
            WHERE t.target_id = %s AND a.unit = %s
            ORDER BY a.created_at DESC
            """,
            (int(target_id), unit),
        )
        rows = cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("action_created_at", "contact_at", "response_at", "converted_at"):
                if d.get(k) is not None and not isinstance(d[k], str):
                    d[k] = d[k].isoformat()
            if d.get("converted_amount") is not None:
                d["converted_amount"] = float(d["converted_amount"])
            out.append(d)
        return out


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
