"""Estado del Auto Docs cycle de Jira Flow.

Una sola fila global con last_run_iso + processed_keys. Idempotente: si
no existe el row con id=1, se crea vacío.
"""
from __future__ import annotations

import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.jira_flow")

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
                CREATE TABLE IF NOT EXISTS jira_flow_doc_state (
                    id              INT PRIMARY KEY,
                    last_run_iso    TEXT,
                    processed_keys  JSONB NOT NULL DEFAULT '[]'::jsonb,
                    last_results    JSONB NOT NULL DEFAULT '[]'::jsonb,
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "INSERT INTO jira_flow_doc_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
            )
        _INITIALIZED = True


def get_state() -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT last_run_iso, processed_keys, last_results FROM jira_flow_doc_state WHERE id=1")
        row = cur.fetchone()
    if not row:
        return {"last_run_iso": None, "processed_keys": [], "last_results": []}
    last_run, keys, results = row
    return {
        "last_run_iso": last_run,
        "processed_keys": keys if isinstance(keys, list) else (json.loads(keys) if keys else []),
        "last_results": results if isinstance(results, list) else (json.loads(results) if results else []),
    }


def save_state(*, last_run_iso: str | None, processed_keys: list[str], last_results: list[dict]) -> None:
    init()
    keys_capped = (processed_keys or [])[-500:]
    results_capped = (last_results or [])[-50:]
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE jira_flow_doc_state
               SET last_run_iso=%s,
                   processed_keys=%s::jsonb,
                   last_results=%s::jsonb,
                   updated_at=NOW()
             WHERE id=1
            """,
            (last_run_iso, json.dumps(keys_capped), json.dumps(results_capped)),
        )


def reset_state() -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE jira_flow_doc_state SET last_run_iso=NULL, processed_keys='[]'::jsonb, last_results='[]'::jsonb, updated_at=NOW() WHERE id=1"
        )
