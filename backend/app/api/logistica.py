"""
Logística — Carga unificada a DigiPWMS.

POST /api/logistica/carga/run        — dispara run async, devuelve run_id
GET  /api/logistica/carga/runs       — historial de runs
GET  /api/logistica/carga/runs/{id}  — estado + logs de un run específico
"""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth.security import current_user, require_area
from app.db import carga_digip_db
from app.services.logistica import carga_digip as svc

router = APIRouter(prefix="/api/logistica", tags=["logistica"])

# ── Estado del run en curso (un run a la vez) ─────────────────────────────
_run_lock = threading.Lock()
_active_run_id: str | None = None


# ── Modelos ───────────────────────────────────────────────────────────────

class RunParams(BaseModel):
    fuentes: list[Literal["TN", "TN_UNI", "MELI_DB", "MELI_API"]]
    dry_run: bool = True
    pedido_tipo: Literal["TODOS", "LOTE", "INDIV"] = "TODOS"
    tipo_envio: Literal["TODOS", "FLEX", "PR"] = "TODOS"
    fecha_meli: str | None = None
    fecha_desde: str | None = None
    tn_uni_despacho: list[Literal["RETIRA", "OTROS"]] | None = None


# ── Worker thread ─────────────────────────────────────────────────────────

def _worker(run_id: str, params: dict) -> None:
    global _active_run_id
    log_list: list[str] = []
    start = time.time()
    try:
        resultados = svc.execute_run(params, log_list)
        status = "done"
        # Si algún flujo devolvió None → hay errores
        has_none = any(v is None for v in resultados.values())
        if has_none:
            status = "error"
        stats = {
            "creados":    sum((r.get("creados", 0)    for r in resultados.values() if r), 0),
            "ya_existian": sum((r.get("ya_existian", 0) for r in resultados.values() if r), 0),
            "omitidos":   sum((r.get("omitidos", 0)   for r in resultados.values() if r), 0),
            "errores":    sum((r.get("errores", 0)    for r in resultados.values() if r), 0),
        }
        # Resumen final en logs
        log_list.append("")
        log_list.append("=" * 50)
        log_list.append(f"RESUMEN ({('DRY-RUN' if params.get('dry_run') else 'PRODUCCIÓN')})")
        log_list.append("=" * 50)
        for fuente, res in resultados.items():
            if res is None:
                log_list.append(f"  {fuente:<12} ERROR — ver logs arriba")
            else:
                log_list.append(
                    f"  {fuente:<12} creados={res['creados']}  "
                    f"ya_existian={res['ya_existian']}  "
                    f"omitidos={res['omitidos']}  errores={res['errores']}"
                )
    except Exception as exc:
        status = "error"
        stats  = {"creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}
        log_list.append(f"ERROR INESPERADO: {exc}")
        log_list.append(traceback.format_exc())

    duracion = time.time() - start
    logs     = "\n".join(log_list)
    carga_digip_db.update_run(run_id, status, stats, logs, duracion)

    with _run_lock:
        _active_run_id = None


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/carga/run")
def trigger_run(
    body: RunParams,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Dispara un run de carga. Solo un run a la vez."""
    require_area(user, ["logistica"])

    global _active_run_id
    with _run_lock:
        if _active_run_id is not None:
            raise HTTPException(409, f"Ya hay un run activo: {_active_run_id}. Esperá a que termine.")
        run_id = str(uuid.uuid4())
        _active_run_id = run_id

    params = body.model_dump()
    carga_digip_db.create_run(run_id, params, user.get("id"), user.get("email"))

    t = threading.Thread(target=_worker, args=(run_id, params), daemon=True)
    t.start()

    return {"run_id": run_id, "status": "running"}


@router.get("/carga/runs")
def list_runs(
    user: Annotated[dict, Depends(current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    require_area(user, ["logistica"])
    runs = carga_digip_db.list_runs(limit=limit)

    with _run_lock:
        active = _active_run_id

    # Serializar datetimes
    for r in runs:
        for k in ("started_at", "finished_at"):
            if r.get(k) is not None:
                r[k] = r[k].isoformat()

    return {"items": runs, "active_run_id": active}


@router.get("/carga/runs/{run_id}")
def get_run(
    run_id: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["logistica"])
    run = carga_digip_db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run no encontrado")

    for k in ("started_at", "finished_at"):
        if run.get(k) is not None:
            run[k] = run[k].isoformat()

    with _run_lock:
        run["is_active"] = (_active_run_id == run_id)

    return run
