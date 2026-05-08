"""Costos de importacion: import CSV/Excel (admin), listado lotes/SKUs, BNA rate."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.auth.security import current_user, require_admin
from app.db import costs_db
from app.services import costs as svc
from app.services import cost_excel_importer

router = APIRouter(prefix="/api/costs", tags=["costs"])


@router.get("/usd-rate")
def usd_rate(
    _: Annotated[dict, Depends(current_user)],
    refresh: bool = Query(False),
) -> dict:
    return svc.get_usd_rate(force_refresh=refresh)


@router.get("/lotes")
def list_lotes(_: Annotated[dict, Depends(current_user)]) -> list[dict]:
    return costs_db.list_lotes()


@router.get("/lotes/{lote_id}")
def get_lote(
    lote_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    res = costs_db.get_lote(lote_id)
    if not res:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    return res


@router.delete("/lotes/{lote_id}")
def delete_lote(
    lote_id: int,
    _: Annotated[dict, Depends(require_admin)],
) -> dict:
    if not costs_db.delete_lote(lote_id):
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    return {"ok": True}


@router.get("/current")
def list_current(
    _: Annotated[dict, Depends(current_user)],
    search: str = Query(""),
    limit: int = Query(500, le=2000),
) -> dict:
    rows = costs_db.current_costs(search=search or None, limit=limit)
    rate = None
    try:
        rate = svc.get_usd_rate()
    except Exception:
        pass
    return {"rows": rows, "usd_rate": rate}


@router.get("/sku/{sku}")
def sku_history(
    sku: str,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    res = costs_db.cost_by_sku(sku)
    if not res:
        raise HTTPException(status_code=404, detail="SKU sin costo cargado")
    return res


@router.post("/import")
async def import_csv(
    admin: Annotated[dict, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="archivo vacio")
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="archivo vacio")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="archivo muy grande (max 20MB)")
    try:
        result = svc.import_file(
            content,
            source_file=file.filename,
            imported_by=admin.get("email") or "?",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"error parseando archivo: {e}") from e
    return result


@router.post("/import-excel")
async def import_excel(
    admin: Annotated[dict, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict:
    """Importacion masiva desde el Excel "VALOR PRODUCTO.xlsx".

    El archivo debe tener una hoja "VALOR COMPRA Y PESO" con el formato esperado.
    Es replace-on-import por lote: cualquier lote existente se reemplaza.

    Solo admin (require_admin con is_admin=true OR role=admin).
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="archivo vacio")
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="solo se aceptan archivos .xlsx o .xlsm")
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="archivo vacio")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="archivo muy grande (max 50MB)")
    try:
        result = cost_excel_importer.import_excel(
            content,
            source_file=file.filename,
            imported_by=admin.get("email") or "?",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"error procesando Excel: {e}") from e
    return result
