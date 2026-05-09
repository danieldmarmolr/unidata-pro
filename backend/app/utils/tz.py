"""
Helpers de timezone para UNIDATA.

Toda la operativa del grupo Unistore es en horario Argentina (UTC-3).
Las queries Postgres deben usar `SET TIME ZONE 'America/Argentina/Buenos_Aires'`
en cada conexion (configurado en `app/db/engines.py` y `app/db/local_persistence.py`).

Para Python, usar:
- `today_ar()` en lugar de `dt.date.today()`
- `now_ar()` en lugar de `dt.datetime.now()`

Asi nunca se mezclan zonas horarias y nunca aparece el bug "09/05 a las 22:06 AR"
porque el server estaba en UTC.
"""
from __future__ import annotations

import datetime as dt

try:
    from zoneinfo import ZoneInfo
    AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
except ImportError:
    # Fallback: timezone fijo UTC-3 (no maneja DST pero AR no usa DST)
    AR_TZ = dt.timezone(dt.timedelta(hours=-3))


def now_ar() -> dt.datetime:
    """Datetime actual en zona horaria Argentina."""
    return dt.datetime.now(AR_TZ)


def today_ar() -> dt.date:
    """Fecha actual en Argentina (no del server). Lo que ven los usuarios.

    A las 22:06 hora Argentina, esto devuelve 8 de mayo (no 9 que seria UTC).
    """
    return now_ar().date()
