"""Helpers compartidos para los servicios de dashboards con auto-retry."""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, DBAPIError

from app.db import engines as db_engines


PERIOD_DAYS_DEFAULT = {"today": 1, "yesterday": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def resolve_window(
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """
    Devuelve {days, from_ts, to_ts, label} a partir del filtro.
    - period='today' → desde inicio del día actual hasta ahora
    - period='yesterday' → desde inicio del día previo hasta inicio del actual
    - period='custom' + from_iso/to_iso → esas fechas
    - cualquier otro → últimos N días rolling desde NOW()
    Garantiza from_ts < to_ts.
    """
    now = dt.datetime.now(dt.timezone.utc)
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return {"days": 1, "from_ts": start, "to_ts": now, "label": "today"}
    if period == "yesterday":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - dt.timedelta(days=1)
        return {"days": 1, "from_ts": yesterday_start, "to_ts": today_start, "label": "yesterday"}
    if period == "custom" and from_iso and to_iso:
        try:
            f = dt.datetime.fromisoformat(from_iso).replace(tzinfo=dt.timezone.utc)
            t = dt.datetime.fromisoformat(to_iso).replace(tzinfo=dt.timezone.utc) + dt.timedelta(days=1)
            if t <= f:
                t = f + dt.timedelta(days=1)
            days = max(1, (t - f).days)
            return {"days": days, "from_ts": f, "to_ts": t, "label": f"{from_iso} → {to_iso}"}
        except Exception:
            pass
    days = PERIOD_DAYS_DEFAULT.get(period, 30)
    f = now - dt.timedelta(days=days)
    return {"days": days, "from_ts": f, "to_ts": now, "label": period}

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


def _is_schema_err(exc: BaseException) -> bool:
    """Detecta errores de schema (tabla/columna inexistente). Estas queries
    suelen estar protegidas por try/except a proposito porque el schema
    varia entre ambientes (Unistore tiene meli_orders pero Unidrop no, etc).
    Las degradamos a DEBUG para no ensuciar logs con warnings esperados."""
    s = str(exc).lower()
    return (
        "undefinedtable" in s
        or "undefinedcolumn" in s
        or "does not exist" in s
        or "ambiguouscolumn" in s
        or "ambiguous" in s and "column" in s
    )


def q(engine: Engine, sql: str, params: dict | None = None) -> list[Any] | None:
    """Ejecuta y devuelve filas. Si falla por conexion caida, reintenta una vez."""
    try:
        return _exec(engine, sql, params)
    except (OperationalError, DBAPIError) as e:
        if not _is_connection_err(e):
            if _is_schema_err(e):
                # Schema mismatch esperado en queries defensivas
                log.debug("Query schema-skip: %s :: %s", e, sql.strip().splitlines()[0][:80])
            else:
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
        if _is_schema_err(e):
            log.debug("Query schema-skip: %s :: %s", e, sql.strip().splitlines()[0][:80])
        else:
            log.warning("Query failed: %s :: %s", e, sql.strip().splitlines()[0][:80])
        return None




def scalar(engine: Engine, sql: str, params: dict | None = None) -> Any:
    rows = q(engine, sql, params)
    if rows and rows[0]:
        return rows[0][0]
    return None


# Cache de columnas existentes por (schema, table) -> set[col_name]
_COLUMN_CACHE: dict[tuple[str, str], set[str]] = {}


def list_columns(engine: Engine, schema: str, table: str) -> set[str]:
    """Devuelve las columnas existentes en un table (cacheado in-memory).
    Util para construir SELECTs defensivos cuando el schema puede variar."""
    key = (schema, table)
    if key in _COLUMN_CACHE:
        return _COLUMN_CACHE[key]
    rows = q(engine, """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = :s AND table_name = :t
    """, {"s": schema, "t": table}) or []
    cols = {r[0] for r in rows}
    _COLUMN_CACHE[key] = cols
    return cols


def table_exists(engine: Engine, schema: str, table: str) -> bool:
    """Chequea si una tabla existe en el schema dado.
    Cache via list_columns - 0 columnas = tabla inexistente."""
    cols = list_columns(engine, schema, table)
    return len(cols) > 0


def col_or_null(engine: Engine, schema: str, table: str, alias: str, candidates: list[str]) -> str:
    """Devuelve el primer candidato existente en `<alias>."col"` listo para SELECT.
    Si ninguna existe, devuelve `NULL::text`. Las columnas se quotean con doble comilla."""
    cols = list_columns(engine, schema, table)
    for c in candidates:
        if c in cols:
            return f'{alias}."{c}"'
    return "NULL::text"
