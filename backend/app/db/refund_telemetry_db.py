"""
Telemetria de errores del formulario publico de devolucion de suscripcion
(`/dev-suscripcion`).

El frontend lo llama fire-and-forget cuando un fetch falla con TypeError de red
(Failed to fetch), HTTP 5xx, o validacion server-side rechaza el submit. Sirve
para diagnosticar fallas que el usuario no puede describir (browser, extensions,
ISP, etc).
"""
from __future__ import annotations

import json
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.refund_telemetry")

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
                CREATE TABLE IF NOT EXISTS subscription_refund_telemetry (
                    id              BIGSERIAL PRIMARY KEY,
                    correlation_id  TEXT NOT NULL,
                    kind            TEXT NOT NULL,
                    message         TEXT,
                    endpoint        TEXT,
                    http_status     INT,
                    api_base        TEXT,
                    user_agent      TEXT,
                    page_origin     TEXT,
                    referrer        TEXT,
                    dni             TEXT,
                    email           TEXT,
                    submitter_ip    TEXT,
                    extra           JSONB,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_refundtel_created "
                "ON subscription_refund_telemetry (created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_refundtel_corr "
                "ON subscription_refund_telemetry (correlation_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_refundtel_kind "
                "ON subscription_refund_telemetry (kind, created_at DESC)"
            )
        _INITIALIZED = True


def record(
    *,
    correlation_id: str,
    kind: str,
    message: str | None,
    endpoint: str | None,
    http_status: int | None,
    api_base: str | None,
    user_agent: str | None,
    page_origin: str | None,
    referrer: str | None,
    dni: str | None,
    email: str | None,
    submitter_ip: str | None,
    extra: dict | None,
) -> int:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO subscription_refund_telemetry
                (correlation_id, kind, message, endpoint, http_status,
                 api_base, user_agent, page_origin, referrer,
                 dni, email, submitter_ip, extra)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                correlation_id, kind, message, endpoint, http_status,
                api_base, user_agent, page_origin, referrer,
                dni, email, submitter_ip,
                json.dumps(extra) if extra else None,
            ),
        )
        return int(cur.fetchone()["id"])
