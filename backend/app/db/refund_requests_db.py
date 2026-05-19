"""
Solicitudes de devolucion de dinero por cancelacion de suscripcion MELI.

Flow: dropshipper llena form publico → registro queda en status='pending' →
Finanzas marca transferido → Finanzas cancela integracion MELI via unidrop_api →
status='integration_cancelled'.

Tabla local en Supabase (mismo pool que dropshipper_notes, reminders, etc).
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.refund_requests")

_LOCK = threading.RLock()
_INITIALIZED = False

STATUSES = ("pending", "transferred", "integration_cancelled", "rejected")


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS subscription_refund_requests (
                    id                               BIGSERIAL PRIMARY KEY,
                    dropshipper_user_id              BIGINT NOT NULL,
                    dropshipper_dni                  TEXT NOT NULL,
                    dropshipper_email                TEXT NOT NULL,
                    dropshipper_name                 TEXT NOT NULL,
                    dropshipper_fantasy_name         TEXT,
                    subscription_id                  BIGINT,
                    subscription_plan_name           TEXT,
                    bank_holder_name                 TEXT NOT NULL,
                    bank_holder_cuit                 TEXT NOT NULL,
                    bank_name                        TEXT NOT NULL,
                    bank_cbu                         TEXT NOT NULL,
                    bank_alias                       TEXT,
                    refund_amount_arg                NUMERIC(12,2),
                    paid_subscription_total_arg      NUMERIC(12,2),
                    paid_subscription_count          INT,
                    abandonment_reason               TEXT NOT NULL DEFAULT 'no_especificada',
                    reason                           TEXT,
                    status                           TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','transferred','integration_cancelled','rejected')),
                    transferred_at                   TIMESTAMPTZ,
                    transferred_by_user_id           BIGINT,
                    transferred_by_email             TEXT,
                    transferred_note                 TEXT,
                    integration_cancelled_at         TIMESTAMPTZ,
                    integration_cancelled_by_user_id BIGINT,
                    integration_cancelled_by_email   TEXT,
                    integration_cancel_response      TEXT,
                    rejected_at                      TIMESTAMPTZ,
                    rejected_by_user_id              BIGINT,
                    rejected_by_email                TEXT,
                    rejection_reason                 TEXT,
                    submitter_ip                     TEXT,
                    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            # Migracion idempotente: ADD COLUMN IF NOT EXISTS para tablas
            # ya creadas con la version anterior (sin abandonment_reason).
            cur.execute("""
                ALTER TABLE subscription_refund_requests
                ADD COLUMN IF NOT EXISTS paid_subscription_total_arg NUMERIC(12,2),
                ADD COLUMN IF NOT EXISTS paid_subscription_count     INT,
                ADD COLUMN IF NOT EXISTS abandonment_reason          TEXT NOT NULL DEFAULT 'no_especificada'
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_refundreq_status "
                "ON subscription_refund_requests (status, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_refundreq_dni "
                "ON subscription_refund_requests (dropshipper_dni)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_refundreq_pending_per_user "
                "ON subscription_refund_requests (dropshipper_user_id) "
                "WHERE status = 'pending'"
            )
        _INITIALIZED = True


def create_request(
    *,
    dropshipper_user_id: int,
    dropshipper_dni: str,
    dropshipper_email: str,
    dropshipper_name: str,
    dropshipper_fantasy_name: str | None,
    subscription_id: int | None,
    subscription_plan_name: str | None,
    bank_holder_name: str,
    bank_holder_cuit: str,
    bank_name: str,
    bank_cbu: str,
    bank_alias: str | None,
    refund_amount_arg: float | None,
    paid_subscription_total_arg: float | None,
    paid_subscription_count: int | None,
    abandonment_reason: str,
    reason: str | None,
    submitter_ip: str | None,
) -> dict:
    init()
    import psycopg2
    try:
        with get_conn() as c, c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO subscription_refund_requests
                    (dropshipper_user_id, dropshipper_dni, dropshipper_email,
                     dropshipper_name, dropshipper_fantasy_name,
                     subscription_id, subscription_plan_name,
                     bank_holder_name, bank_holder_cuit, bank_name, bank_cbu, bank_alias,
                     refund_amount_arg,
                     paid_subscription_total_arg, paid_subscription_count,
                     abandonment_reason, reason, submitter_ip)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    dropshipper_user_id, dropshipper_dni, dropshipper_email,
                    dropshipper_name, dropshipper_fantasy_name,
                    subscription_id, subscription_plan_name,
                    bank_holder_name, bank_holder_cuit, bank_name, bank_cbu, bank_alias,
                    refund_amount_arg,
                    paid_subscription_total_arg, paid_subscription_count,
                    abandonment_reason, reason, submitter_ip,
                ),
            )
            return _to_dict(cur.fetchone())
    except psycopg2.errors.UniqueViolation:
        raise ValueError("Ya existe una solicitud pendiente para este dropshipper")


def list_requests(
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> list[dict]:
    init()
    sql = "SELECT * FROM subscription_refund_requests WHERE 1=1"
    params: list = []
    if status:
        if status not in STATUSES:
            raise ValueError(f"status invalido: {status}")
        sql += " AND status = %s"
        params.append(status)
    if search:
        s = f"%{search.lower()}%"
        sql += (
            " AND (LOWER(dropshipper_email) LIKE %s "
            "OR LOWER(dropshipper_name) LIKE %s "
            "OR dropshipper_dni LIKE %s)"
        )
        params.extend([s, s, f"%{search}%"])
    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return [_to_dict(r) for r in cur.fetchall()]


def get_request(request_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM subscription_refund_requests WHERE id = %s",
            (request_id,),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def mark_transferred(
    request_id: int,
    *,
    user_id: int,
    user_email: str,
    note: str | None,
    refund_amount_arg: float | None,
) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE subscription_refund_requests
            SET status = 'transferred',
                transferred_at = NOW(),
                transferred_by_user_id = %s,
                transferred_by_email = %s,
                transferred_note = %s,
                refund_amount_arg = COALESCE(%s, refund_amount_arg),
                updated_at = NOW()
            WHERE id = %s AND status = 'pending'
            RETURNING *
            """,
            (user_id, user_email, note, refund_amount_arg, request_id),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def mark_integration_cancelled(
    request_id: int,
    *,
    user_id: int,
    user_email: str,
    api_response: str,
) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE subscription_refund_requests
            SET status = 'integration_cancelled',
                integration_cancelled_at = NOW(),
                integration_cancelled_by_user_id = %s,
                integration_cancelled_by_email = %s,
                integration_cancel_response = %s,
                updated_at = NOW()
            WHERE id = %s AND status = 'transferred'
            RETURNING *
            """,
            (user_id, user_email, api_response, request_id),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def mark_rejected(
    request_id: int,
    *,
    user_id: int,
    user_email: str,
    reason: str,
) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE subscription_refund_requests
            SET status = 'rejected',
                rejected_at = NOW(),
                rejected_by_user_id = %s,
                rejected_by_email = %s,
                rejection_reason = %s,
                updated_at = NOW()
            WHERE id = %s AND status = 'pending'
            RETURNING *
            """,
            (user_id, user_email, reason, request_id),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def _to_dict(row: dict | None) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in (
        "created_at", "updated_at",
        "transferred_at", "integration_cancelled_at", "rejected_at",
    ):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    for k in ("refund_amount_arg", "paid_subscription_total_arg"):
        if k in d and d[k] is not None:
            d[k] = float(d[k])
    return d
