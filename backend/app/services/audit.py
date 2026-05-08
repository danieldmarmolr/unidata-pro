"""
Audit log persistente en PostgreSQL (Supabase).
Registra cada query SQL que se corre via /api/queries y los accesos a dashboards
relevantes (cuando se decida instrumentar mas adelante).
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

logger = logging.getLogger(__name__)
_LOCK = threading.Lock()
_INITIALIZED = False


def _init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS query_runs (
                    id          BIGSERIAL PRIMARY KEY,
                    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    "user"      TEXT NOT NULL,
                    unit        TEXT NOT NULL,
                    sql         TEXT NOT NULL,
                    rows        INTEGER,
                    truncated   BOOLEAN NOT NULL DEFAULT FALSE,
                    duration_ms INTEGER,
                    error       TEXT
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_query_runs_ts ON query_runs (ts DESC)")
            cur.execute('CREATE INDEX IF NOT EXISTS idx_query_runs_user ON query_runs ("user")')
        _INITIALIZED = True


def log_query(
    user: str,
    unit: str,
    sql: str,
    rows: int | None,
    truncated: bool,
    duration_ms: int,
    error: str | None = None,
) -> None:
    _init()
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO query_runs ("user", unit, sql, rows, truncated, duration_ms, error)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user,
                    unit,
                    sql[:5000],
                    rows,
                    bool(truncated),
                    duration_ms,
                    error,
                ),
            )
    except Exception as e:
        logger.warning("audit log failed (non-blocking): %s", e)
        # nunca romper la respuesta por audit


def list_recent(limit: int = 50) -> list[dict]:
    _init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM query_runs ORDER BY id DESC LIMIT %s",
            (limit,),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if "ts" in d and d["ts"] is not None and not isinstance(d["ts"], str):
            d["ts"] = d["ts"].isoformat()
        out.append(d)
    return out
