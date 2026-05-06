"""
Audit log persistente en SQLite local.
Registra cada query SQL que se corre via /api/queries y los accesos a dashboards
relevantes (cuando se decida instrumentar mas adelante).
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "audit.db"
_LOCK = threading.Lock()
_INITIALIZED = False


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS query_runs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts          TEXT NOT NULL,
                    user        TEXT NOT NULL,
                    unit        TEXT NOT NULL,
                    sql         TEXT NOT NULL,
                    rows        INTEGER,
                    truncated   INTEGER NOT NULL DEFAULT 0,
                    duration_ms INTEGER,
                    error       TEXT
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_query_runs_ts ON query_runs(ts DESC)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_query_runs_user ON query_runs(user)")
            c.commit()
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
        with _LOCK, _conn() as c:
            c.execute(
                """
                INSERT INTO query_runs (ts, user, unit, sql, rows, truncated, duration_ms, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dt.datetime.now(dt.timezone.utc).isoformat(),
                    user,
                    unit,
                    sql[:5000],
                    rows,
                    1 if truncated else 0,
                    duration_ms,
                    error,
                ),
            )
            c.commit()
    except Exception:
        pass  # nunca romper la respuesta por audit


def list_recent(limit: int = 50) -> list[dict]:
    _init()
    with _LOCK, _conn() as c:
        c.row_factory = sqlite3.Row
        rows = c.execute(
            "SELECT * FROM query_runs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
