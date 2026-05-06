"""SQL libre (solo lectura)."""
from __future__ import annotations

import datetime as dt
import decimal
import time
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text

from app.auth.security import current_user
from app.db.engines import get_engine
from app.schemas.common import QueryRequest, QueryResult
from app.services import audit
from app.services.sql_safety import is_safe_select

router = APIRouter(prefix="/api/queries", tags=["queries"])


def _jsonable(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8", "replace")
        except Exception:
            return f"<bytes len={len(v)}>"
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    return str(v)


@router.post("/{unit}/run", response_model=QueryResult)
def run_query(
    unit: Annotated[str, Path()],
    body: QueryRequest,
    user: Annotated[dict, Depends(current_user)],
) -> QueryResult:
    if user.get("role") not in ("admin", "user"):
        raise HTTPException(403, "Sin permisos para SQL libre")
    unit = unit.lower()
    if unit not in ("unistore", "unidrop"):
        raise HTTPException(404, "Unidad desconocida")
    ok, err = is_safe_select(body.sql)
    user_label = user.get("email") or str(user.get("id"))
    if not ok:
        audit.log_query(user_label, unit, body.sql, None, False, 0, error=err)
        raise HTTPException(400, err)
    max_rows = max(1, min(int(body.max_rows or 5000), 50000))
    eng = get_engine(unit)
    started = time.perf_counter()
    try:
        with eng.connect() as c:
            res = c.execute(text(body.sql))
            cols = list(res.keys())
            rows = [[_jsonable(v) for v in r] for r in res.all()]
    except Exception as e:
        duration_ms = int((time.perf_counter() - started) * 1000)
        audit.log_query(user_label, unit, body.sql, None, False, duration_ms, error=str(e)[:500])
        raise HTTPException(400, f"Error en la consulta: {e}") from e
    duration_ms = int((time.perf_counter() - started) * 1000)
    truncated = len(rows) > max_rows
    if truncated:
        rows = rows[:max_rows]
    audit.log_query(user_label, unit, body.sql, len(rows), truncated, duration_ms)
    return QueryResult(columns=cols, rows=rows, truncated=truncated, row_count=len(rows))


@router.get("/audit/recent")
def audit_recent(
    user: Annotated[dict, Depends(current_user)],
    limit: int = 50,
) -> list[dict]:
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admin puede ver audit log completo")
    return audit.list_recent(max(1, min(int(limit), 500)))
