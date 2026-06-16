"""Tracking de acciones de Finanzas sobre devoluciones de Mercado Libre.

La devolucion en si vive en mercado_libre_dev."MercadoLibreReturn" (estado del
claim de ML: notificada, en camino, recibida — viene de ML). Aca persistimos lo
que el equipo de Finanzas hace una vez que la mercaderia llega al deposito:
transferir la plata al dropshipper, rechazar la devolucion, etc.

Linkeamos por (ml_order_id, return_idx) porque una orden ML puede tener mas de
una devolucion. ml_order_id = MercadoLibreReturn.orderId (bigint), return_idx =
secuencia 1..N para distinguir multiples returns del mismo order (usamos
created_at del return para ordenar).
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.ml_return_actions")

_LOCK = threading.RLock()
_INITIALIZED = False

STATUSES = ("pending", "transferred", "rejected")


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ml_return_actions (
                    id                       BIGSERIAL PRIMARY KEY,
                    ml_order_id              BIGINT NOT NULL,
                    return_idx               INT NOT NULL DEFAULT 1,
                    dropshipper_user_id      BIGINT,
                    dropshipper_dni          TEXT,
                    status                   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','transferred','rejected')),
                    transferred_at           TIMESTAMPTZ,
                    transferred_by_user_id   BIGINT,
                    transferred_by_email     TEXT,
                    transferred_note         TEXT,
                    transferred_amount_arg   NUMERIC(12,2),
                    rejected_at              TIMESTAMPTZ,
                    rejected_by_user_id      BIGINT,
                    rejected_by_email        TEXT,
                    rejection_reason         TEXT,
                    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (ml_order_id, return_idx)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_mlretact_status "
                "ON ml_return_actions (status, updated_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_mlretact_dropshipper "
                "ON ml_return_actions (dropshipper_user_id)"
            )
        _INITIALIZED = True


def list_actions(ml_order_ids: list[int] | None = None) -> dict[tuple[int, int], dict]:
    """Devuelve dict {(ml_order_id, return_idx): action_row} para los orders pedidos.
    Si ml_order_ids es None, devuelve TODAS. Pensado para enrichment masivo del listing."""
    init()
    sql = "SELECT * FROM ml_return_actions"
    params: list = []
    if ml_order_ids is not None:
        if not ml_order_ids:
            return {}
        sql += " WHERE ml_order_id = ANY(%s)"
        params.append(ml_order_ids)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    out: dict[tuple[int, int], dict] = {}
    for r in rows:
        d = _to_dict(r)
        out[(int(d["ml_order_id"]), int(d["return_idx"]))] = d
    return out


def get_action(ml_order_id: int, return_idx: int = 1) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT * FROM ml_return_actions WHERE ml_order_id = %s AND return_idx = %s",
            (ml_order_id, return_idx),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def _upsert_pending(
    cur,
    ml_order_id: int,
    return_idx: int,
    dropshipper_user_id: int | None,
    dropshipper_dni: str | None,
) -> None:
    """Asegura que exista una row en status='pending' para el target dado.
    No-op si ya existe. Lo llaman las acciones (mark_transferred, mark_rejected)
    cuando todavia no hay row creada por el equipo (la devolucion entro a UNIDATA
    sin que Finanzas la haya tocado)."""
    cur.execute(
        """
        INSERT INTO ml_return_actions (ml_order_id, return_idx, dropshipper_user_id, dropshipper_dni)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (ml_order_id, return_idx) DO NOTHING
        """,
        (ml_order_id, return_idx, dropshipper_user_id, dropshipper_dni),
    )


def mark_transferred(
    ml_order_id: int,
    *,
    return_idx: int = 1,
    user_id: int,
    user_email: str,
    note: str | None,
    amount_arg: float | None,
    dropshipper_user_id: int | None = None,
    dropshipper_dni: str | None = None,
) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        _upsert_pending(cur, ml_order_id, return_idx, dropshipper_user_id, dropshipper_dni)
        cur.execute(
            """
            UPDATE ml_return_actions
            SET status = 'transferred',
                transferred_at = NOW(),
                transferred_by_user_id = %s,
                transferred_by_email = %s,
                transferred_note = %s,
                transferred_amount_arg = %s,
                updated_at = NOW()
            WHERE ml_order_id = %s AND return_idx = %s AND status = 'pending'
            RETURNING *
            """,
            (user_id, user_email, note, amount_arg, ml_order_id, return_idx),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def mark_rejected(
    ml_order_id: int,
    *,
    return_idx: int = 1,
    user_id: int,
    user_email: str,
    reason: str,
    dropshipper_user_id: int | None = None,
    dropshipper_dni: str | None = None,
) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        _upsert_pending(cur, ml_order_id, return_idx, dropshipper_user_id, dropshipper_dni)
        cur.execute(
            """
            UPDATE ml_return_actions
            SET status = 'rejected',
                rejected_at = NOW(),
                rejected_by_user_id = %s,
                rejected_by_email = %s,
                rejection_reason = %s,
                updated_at = NOW()
            WHERE ml_order_id = %s AND return_idx = %s AND status = 'pending'
            RETURNING *
            """,
            (user_id, user_email, reason, ml_order_id, return_idx),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def mark_transferred_system(
    ml_order_id: int,
    *,
    return_idx: int = 1,
    user_id: int,
    user_email: str,
    note: str | None,
    amount_arg: float | None,
    dropshipper_user_id: int | None = None,
    dropshipper_dni: str | None = None,
) -> dict | None:
    """Variante para el motor Cresium: marca transferred desde CUALQUIER estado
    que no sea ya 'transferred' (pending o rejected). Idempotente: no-op si la
    fila ya esta en transferred. Devuelve la fila si flipeo, None si no."""
    init()
    with get_conn() as c, c.cursor() as cur:
        _upsert_pending(cur, ml_order_id, return_idx, dropshipper_user_id, dropshipper_dni)
        cur.execute(
            """
            UPDATE ml_return_actions
            SET status = 'transferred',
                transferred_at = NOW(),
                transferred_by_user_id = %s,
                transferred_by_email = %s,
                transferred_note = %s,
                transferred_amount_arg = %s,
                updated_at = NOW()
            WHERE ml_order_id = %s AND return_idx = %s AND status <> 'transferred'
            RETURNING *
            """,
            (user_id, user_email, note, amount_arg, ml_order_id, return_idx),
        )
        row = cur.fetchone()
    return _to_dict(row) if row else None


def revert_to_pending(
    ml_order_id: int,
    *,
    return_idx: int = 1,
    user_id: int,
    user_email: str,
) -> dict | None:
    """Vuelve una devolucion 'transferred' a 'pending'. Borra audit de transferencia."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE ml_return_actions
            SET status = 'pending',
                transferred_at = NULL,
                transferred_by_user_id = NULL,
                transferred_by_email = NULL,
                transferred_note = NULL,
                transferred_amount_arg = NULL,
                updated_at = NOW()
            WHERE ml_order_id = %s AND return_idx = %s AND status = 'transferred'
            RETURNING *
            """,
            (ml_order_id, return_idx),
        )
        row = cur.fetchone()
    if row:
        log.info("ml_return_action revertida ml_order=%s idx=%s por %s (%s)",
                 ml_order_id, return_idx, user_email, user_id)
    return _to_dict(row) if row else None


def delete_action(ml_order_id: int, return_idx: int = 1) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM ml_return_actions WHERE ml_order_id = %s AND return_idx = %s",
            (ml_order_id, return_idx),
        )
        return cur.rowcount > 0


def _to_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "transferred_at", "rejected_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    for k in ("transferred_amount_arg",):
        if k in d and d[k] is not None:
            d[k] = float(d[k])
    return d
