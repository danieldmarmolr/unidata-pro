"""
Targets operativos por KPI de Logistica (3ra baseline del dashboard).

Tabla local en Supabase. Solo admin/gerencia/area=it_data pueden editar;
todos pueden leer. Si no hay target seteado para un KPI, el frontend
no muestra la linea (gracioso degradado).

KPIs comunes que se setean:
  - lead_time_days (lead time avg objetivo en dias)
  - stuck_orders_max (cuantos pedidos atascados son aceptables)
  - prep_throughput_daily (preparaciones por dia objetivo)
  - cancellation_rate_max (% de eliminados aceptable)
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.logistics_targets")

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
                CREATE TABLE IF NOT EXISTS logistics_targets (
                    id               BIGSERIAL PRIMARY KEY,
                    unit             TEXT NOT NULL CHECK (unit IN ('unistore','unidrop')),
                    kpi_key          TEXT NOT NULL,
                    target_value     NUMERIC NOT NULL,
                    direction        TEXT NOT NULL DEFAULT 'lower_is_better'
                                       CHECK (direction IN ('lower_is_better','higher_is_better')),
                    note             TEXT,
                    updated_by_id    BIGINT,
                    updated_by_email TEXT,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (unit, kpi_key)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_logistics_targets_unit "
                "ON logistics_targets (unit, kpi_key)"
            )
        _INITIALIZED = True


def list_for_unit(unit: str) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT unit, kpi_key, target_value::float, direction, note,
                   updated_by_email, updated_at
            FROM logistics_targets WHERE unit = %s ORDER BY kpi_key
            """,
            (unit,),
        )
        return [_to_dict(r) for r in cur.fetchall()]


def get_map(unit: str) -> dict[str, dict]:
    """Devuelve {kpi_key: target_dict} para que el service de logistica enriquezca cards."""
    return {t["kpi_key"]: t for t in list_for_unit(unit)}


def upsert(
    *,
    unit: str,
    kpi_key: str,
    target_value: float,
    direction: str = "lower_is_better",
    note: str | None = None,
    updated_by_id: int,
    updated_by_email: str,
) -> dict:
    init()
    if unit not in ("unistore", "unidrop"):
        raise ValueError(f"unit invalida: {unit}")
    if direction not in ("lower_is_better", "higher_is_better"):
        raise ValueError(f"direction invalida: {direction}")
    if not kpi_key or not kpi_key.strip():
        raise ValueError("kpi_key vacio")

    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO logistics_targets
                (unit, kpi_key, target_value, direction, note,
                 updated_by_id, updated_by_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (unit, kpi_key)
            DO UPDATE SET
                target_value     = EXCLUDED.target_value,
                direction        = EXCLUDED.direction,
                note             = EXCLUDED.note,
                updated_by_id    = EXCLUDED.updated_by_id,
                updated_by_email = EXCLUDED.updated_by_email,
                updated_at       = NOW()
            RETURNING unit, kpi_key, target_value::float, direction, note,
                      updated_by_email, updated_at
            """,
            (unit, kpi_key.strip(), float(target_value), direction,
             (note or "").strip() or None, updated_by_id, updated_by_email),
        )
        return _to_dict(cur.fetchone())


def delete_target(unit: str, kpi_key: str) -> bool:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "DELETE FROM logistics_targets WHERE unit = %s AND kpi_key = %s",
            (unit, kpi_key),
        )
        return cur.rowcount > 0


def _to_dict(row: dict | None) -> dict:
    if not row:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat()
    return d
