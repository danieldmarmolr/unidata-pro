"""Validacion de SQL libre (solo lectura)."""
from __future__ import annotations

import re

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|"
    r"comment|copy|call|do|vacuum|analyze|reindex|cluster|listen|notify|"
    r"lock|set|reset)\b",
    re.IGNORECASE,
)
_ALLOWED_START = re.compile(r"^\s*(select|with|explain|show)\b", re.IGNORECASE)


def is_safe_select(sql: str) -> tuple[bool, str]:
    s = sql.strip().rstrip(";")
    if not s:
        return False, "La consulta esta vacia."
    if not _ALLOWED_START.match(s):
        return False, "Solo se permiten consultas que empiecen con SELECT, WITH, EXPLAIN o SHOW."
    if _FORBIDDEN.search(s):
        return False, "Se detectaron palabras prohibidas. Esta app es solo lectura."
    if ";" in s:
        return False, "Solo una sentencia por ejecucion (sin ';')."
    return True, ""
