"""
Historico de analisis LLM sobre el churn de suscripciones.

Cada vez que Gerencia ejecuta "Re-analizar con IA", el resultado del structured
output de Gemini se guarda aca. Permite ver evolucion del analisis entre
generaciones y comparar deltas.
"""
from __future__ import annotations

import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.churn_insights")

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
                CREATE TABLE IF NOT EXISTS subscription_churn_insights (
                    id                BIGSERIAL PRIMARY KEY,
                    period            TEXT NOT NULL,
                    granularity       TEXT NOT NULL,
                    payload           JSONB NOT NULL,
                    model             TEXT,
                    input_signals     JSONB,
                    generated_by_id   BIGINT,
                    generated_by_email TEXT,
                    duration_ms       INT,
                    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_churn_insights_period "
                "ON subscription_churn_insights (period, granularity, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_churn_insights_created "
                "ON subscription_churn_insights (created_at DESC)"
            )
        _INITIALIZED = True


def save_insight(
    *,
    period: str,
    granularity: str,
    payload: dict,
    model: str | None,
    input_signals: dict | None,
    generated_by_id: int | None,
    generated_by_email: str | None,
    duration_ms: int | None,
) -> dict:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO subscription_churn_insights
                (period, granularity, payload, model, input_signals,
                 generated_by_id, generated_by_email, duration_ms)
            VALUES (%s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s)
            RETURNING id, created_at
            """,
            (
                period, granularity,
                json.dumps(payload),
                model,
                json.dumps(input_signals) if input_signals else None,
                generated_by_id, generated_by_email, duration_ms,
            ),
        )
        row = cur.fetchone()
        return {"id": int(row["id"]), "created_at": row["created_at"]}


def get_latest(period: str, granularity: str) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, period, granularity, payload, model,
                   generated_by_email, duration_ms, created_at
            FROM subscription_churn_insights
            WHERE period = %s AND granularity = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (period, granularity),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": int(row["id"]),
            "period": row["period"],
            "granularity": row["granularity"],
            "payload": row["payload"],
            "model": row["model"],
            "generated_by_email": row["generated_by_email"],
            "duration_ms": int(row["duration_ms"]) if row["duration_ms"] is not None else None,
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }


def list_history(period: str, granularity: str, limit: int = 10) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT id, generated_by_email, duration_ms, created_at,
                   (payload->>'summary') AS summary
            FROM subscription_churn_insights
            WHERE period = %s AND granularity = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (period, granularity, limit),
        )
        return [
            {
                "id": int(r["id"]),
                "generated_by_email": r["generated_by_email"],
                "duration_ms": int(r["duration_ms"]) if r["duration_ms"] is not None else None,
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "summary": r["summary"],
            }
            for r in cur.fetchall()
        ]
