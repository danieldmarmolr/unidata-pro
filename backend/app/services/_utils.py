"""Helpers compartidos para los servicios de dashboards con auto-retry."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, DBAPIError

from app.db import engines as db_engines

log = logging.getLogger("unidata.dashboards")


_CONNECTION_ERROR_HINTS = (
    "ssh session", "ssh error", "server closed", "connection abort",
    "connection refused", "could not receive data", "could not connect",
    "no connection could be made", "broken pipe",
)


def _is_connection_err(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(h in msg for h in _CONNECTION_ERROR_HINTS)


def _engine_for(engine: Engine) -> str:
    """Best-effort: deducir la unidad del engine para forzar reset."""
    for unit in ("unistore", "unidrop"):
        if db_engines._ENGINES.get(unit) is engine:  # noqa: SLF001
            return unit
    return ""


def _exec(engine: Engine, sql: str, params: dict | None) -> list[Any]:
    with engine.connect() as c:
        return c.execute(text(sql), params or {}).all()


def q(engine: Engine, sql: str, params: dict | None = None) -> list[Any] | None:
    """Ejecuta y devuelve filas. Si falla por conexion caida, reintenta una vez."""
    try:
        return _exec(engine, sql, params)
    except (OperationalError, DBAPIError) as e:
        if not _is_connection_err(e):
            log.warning("Query failed (no-retry): %s :: %s", e, sql.strip().splitlines()[0][:80])
            return None
        unit = _engine_for(engine)
        log.warning("Connection lost (%s), forzando reset y reintentando", unit or "?")
        if unit:
            db_engines.force_reset(unit)
            try:
                new_eng = db_engines.get_engine(unit)
            except Exception as e2:
                log.error("Reconexion fallo para %s: %s", unit, e2)
                return None
            try:
                return _exec(new_eng, sql, params)
            except Exception as e3:
                log.error("Retry tambien fallo: %s", e3)
                return None
        return None
    except Exception as e:
        log.warning("Query failed: %s :: %s", e, sql.strip().splitlines()[0][:80])
        return None


def scalar(engine: Engine, sql: str, params: dict | None = None) -> Any:
    rows = q(engine, sql, params)
    if rows and rows[0]:
        return rows[0][0]
    return None
