"""
Sistema de notificaciones in-app (it_alerts).

Tabla local en Supabase (NO en las DBs de unidades). Alertas que el harness
de UNIDATA genera automaticamente cuando detecta:
- Integracion sin actividad > X dias (status='error' en integration_health)
- Token MELI expirado masivo
- Pedidos atascados > threshold
- Backup falla
- (otras a futuro)

Cada alert se marca como revisada por un user con timestamp + user_id.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.notifications")

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
                CREATE TABLE IF NOT EXISTS it_alerts (
                    id          BIGSERIAL PRIMARY KEY,
                    type        TEXT NOT NULL,
                    severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
                    source      TEXT NOT NULL,
                    title       TEXT NOT NULL,
                    message     TEXT NOT NULL,
                    metadata    JSONB,
                    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
                    resolved_by INT,
                    resolved_at TIMESTAMPTZ,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    dedupe_key  TEXT
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_it_alerts_resolved ON it_alerts (resolved, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_it_alerts_dedupe ON it_alerts (dedupe_key) WHERE resolved = FALSE")
        _INITIALIZED = True


def create_alert(
    *,
    type: str,
    severity: str,
    source: str,
    title: str,
    message: str,
    metadata: dict | None = None,
    dedupe_key: str | None = None,
) -> dict | None:
    """Crea una alerta. Si dedupe_key es no-null y ya existe una alerta NO resuelta
    con el mismo dedupe_key, NO crea una nueva (evita spam de la misma alerta).
    """
    init()
    if severity not in ("info", "warning", "critical"):
        raise ValueError(f"severity invalida: {severity}")
    import json
    with get_conn() as c, c.cursor() as cur:
        if dedupe_key:
            cur.execute(
                "SELECT id FROM it_alerts WHERE dedupe_key = %s AND resolved = FALSE LIMIT 1",
                (dedupe_key,),
            )
            existing = cur.fetchone()
            if existing:
                return None  # dup, skip
        cur.execute(
            """
            INSERT INTO it_alerts (type, severity, source, title, message, metadata, dedupe_key)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
            RETURNING id, type, severity, source, title, message, metadata, resolved, created_at, dedupe_key
            """,
            (type, severity, source, title, message, json.dumps(metadata or {}), dedupe_key),
        )
        row = cur.fetchone()
        return _to_dict(row)


def list_alerts(
    *,
    only_pending: bool = False,
    limit: int = 100,
    severity: str | None = None,
) -> list[dict]:
    init()
    where: list[str] = []
    params: list = []
    if only_pending:
        where.append("resolved = FALSE")
    if severity in ("info", "warning", "critical"):
        where.append("severity = %s")
        params.append(severity)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(int(limit))
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, type, severity, source, title, message, metadata,
                   resolved, resolved_by, resolved_at, created_at, dedupe_key
            FROM it_alerts
            {where_sql}
            ORDER BY resolved ASC, created_at DESC
            LIMIT %s
            """,
            params,
        )
        return [_to_dict(r) for r in cur.fetchall()]


def count_pending(severity: str | None = None) -> int:
    init()
    where = ["resolved = FALSE"]
    params: list = []
    if severity in ("info", "warning", "critical"):
        where.append("severity = %s")
        params.append(severity)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"SELECT COUNT(*)::int FROM it_alerts WHERE {' AND '.join(where)}", params)
        return int(cur.fetchone()[0] or 0)


def mark_resolved(alert_id: int, user_id: int) -> dict | None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE it_alerts
            SET resolved = TRUE, resolved_by = %s, resolved_at = NOW()
            WHERE id = %s AND resolved = FALSE
            RETURNING id, type, severity, source, title, message, metadata,
                      resolved, resolved_by, resolved_at, created_at, dedupe_key
            """,
            (int(user_id), int(alert_id)),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def mark_unresolved(alert_id: int) -> dict | None:
    """Re-abre una alerta (caso: false-positive marcado por error)."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE it_alerts
            SET resolved = FALSE, resolved_by = NULL, resolved_at = NULL
            WHERE id = %s
            RETURNING id, type, severity, source, title, message, metadata,
                      resolved, resolved_by, resolved_at, created_at, dedupe_key
            """,
            (int(alert_id),),
        )
        row = cur.fetchone()
        return _to_dict(row) if row else None


def _to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("resolved_at", "created_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    d["resolved"] = bool(d.get("resolved"))
    return d
