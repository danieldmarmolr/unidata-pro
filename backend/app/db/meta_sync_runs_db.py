"""
Tracking de sync runs (background jobs) de Meta Ads.

Patron: POST /sync crea un row 'pending', spawn de thread daemon, retorna
run_id inmediatamente. El frontend pollea GET /sync-runs/{id} cada N segundos
para ver progreso. El thread actualiza status -> 'running' -> 'done'/'error'.

Idempotencia: si ya hay un run activo del mismo kind, se reutiliza ese id en
vez de spawn de uno nuevo (evita disparos duplicados por doble-click).
"""
from __future__ import annotations

import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.meta_sync_runs")

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
                CREATE TABLE IF NOT EXISTS meta_sync_runs (
                    id               BIGSERIAL PRIMARY KEY,
                    kind             TEXT NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'pending',
                    historical_days  INT,
                    started_by_id    INT,
                    started_by_email TEXT,
                    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    finished_at      TIMESTAMPTZ,
                    summary          JSONB,
                    error            TEXT
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_kind_status "
                "ON meta_sync_runs (kind, status, started_at DESC)"
            )
        _INITIALIZED = True


def create_run(
    kind: str,
    historical_days: int,
    started_by_id: int | None,
    started_by_email: str | None,
) -> int:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_sync_runs (kind, status, historical_days, started_by_id, started_by_email)
            VALUES (%s, 'pending', %s, %s, %s)
            RETURNING id
        """, (kind, historical_days, started_by_id, started_by_email))
        row = cur.fetchone()
        return int(row["id"])


def mark_running(run_id: int) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE meta_sync_runs SET status = 'running' WHERE id = %s AND status = 'pending'",
            (run_id,),
        )


def mark_done(run_id: int, summary: dict) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            UPDATE meta_sync_runs
            SET status = 'done', finished_at = NOW(), summary = %s
            WHERE id = %s
        """, (json.dumps(summary, default=str), run_id))


def mark_error(run_id: int, error: str) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            UPDATE meta_sync_runs
            SET status = 'error', finished_at = NOW(), error = %s
            WHERE id = %s
        """, (error[:2000], run_id))


def get_run(run_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM meta_sync_runs WHERE id = %s", (run_id,))
        row = cur.fetchone()
        return _serialize(dict(row)) if row else None


def list_runs(kind: str | None = None, limit: int = 10) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        if kind:
            cur.execute(
                "SELECT * FROM meta_sync_runs WHERE kind = %s ORDER BY started_at DESC LIMIT %s",
                (kind, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM meta_sync_runs ORDER BY started_at DESC LIMIT %s",
                (limit,),
            )
        return [_serialize(dict(r)) for r in cur.fetchall()]


def find_active(kind: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT * FROM meta_sync_runs
            WHERE kind = %s AND status IN ('pending', 'running')
            ORDER BY started_at DESC
            LIMIT 1
        """, (kind,))
        row = cur.fetchone()
        return _serialize(dict(row)) if row else None


def _serialize(d: dict) -> dict:
    for k in ("started_at", "finished_at"):
        v = d.get(k)
        if v is not None and not isinstance(v, str):
            d[k] = v.isoformat() if hasattr(v, "isoformat") else str(v)
    return d
