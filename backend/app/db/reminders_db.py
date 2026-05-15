"""
Recordatorios personales del user UNIDATA.

Cada user crea reminders apuntando a un target (dropshipper, orden, customer,
cs_action, alert, o general). Solo el dueño los ve. Util para 'revisar al
dropshipper X en 7 dias' o 'verificar si el pago llego el viernes'.

Los reminders disparados (due_at <= NOW() AND completed_at IS NULL) se exponen
via /api/reminders?status=overdue y son la base para que un agente Claude
mande recap al Slack o haga follow-up automatico.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.reminders")

_LOCK = threading.RLock()
_INITIALIZED = False

TARGET_TYPES = ("dropshipper", "order", "customer", "cs_action", "alert", "general")


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reminders (
                    id             BIGSERIAL PRIMARY KEY,
                    user_id        BIGINT NOT NULL,
                    target_type    TEXT NOT NULL DEFAULT 'general',
                    target_id      TEXT,
                    target_unit    TEXT,
                    due_at         TIMESTAMPTZ NOT NULL,
                    note           TEXT NOT NULL,
                    completed_at   TIMESTAMPTZ,
                    completed_note TEXT,
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_reminders_user_due "
                "ON reminders (user_id, due_at) WHERE completed_at IS NULL"
            )
        _INITIALIZED = True


def create_reminder(
    *,
    user_id: int,
    target_type: str,
    target_id: str | None,
    target_unit: str | None,
    due_at: dt.datetime,
    note: str,
) -> dict:
    init()
    if target_type not in TARGET_TYPES:
        raise ValueError(f"target_type invalido: {target_type}. Validos: {TARGET_TYPES}")
    if not note or not note.strip():
        raise ValueError("note vacio")
    if target_unit and target_unit not in ("unistore", "unidrop"):
        raise ValueError(f"target_unit invalido: {target_unit}")
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO reminders
                (user_id, target_type, target_id, target_unit, due_at, note)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (user_id, target_type, target_id, target_unit, due_at, note.strip()),
        )
        return _to_dict(cur.fetchone())


def list_for_user(
    *,
    user_id: int,
    status: str = "pending",
    limit: int = 100,
) -> list[dict]:
    init()
    where = ["user_id = %s"]
    params: list = [user_id]
    if status == "pending":
        where.append("completed_at IS NULL")
    elif status == "overdue":
        where.append("completed_at IS NULL AND due_at <= NOW()")
    elif status == "done":
        where.append("completed_at IS NOT NULL")
    elif status == "upcoming":
        where.append("completed_at IS NULL AND due_at > NOW()")
    sql = "SELECT * FROM reminders WHERE " + " AND ".join(where) + " ORDER BY due_at ASC LIMIT %s"
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return [_to_dict(r) for r in cur.fetchall()]


def complete_reminder(reminder_id: int, user_id: int, note: str = "") -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE reminders
            SET completed_at = NOW(), completed_note = %s
            WHERE id = %s AND user_id = %s AND completed_at IS NULL
            RETURNING *
            """,
            (note.strip() or None, reminder_id, user_id),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def delete_reminder(reminder_id: int, user_id: int) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM reminders WHERE id = %s AND user_id = %s",
            (reminder_id, user_id),
        )
        return cur.rowcount > 0


def _to_dict(row: dict | None) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("due_at", "completed_at", "created_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d
