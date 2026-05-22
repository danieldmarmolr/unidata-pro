"""
Endpoints para metadata curada de tablas (descripciones + tags).

GET es publico a cualquier user autenticado.
PATCH/DELETE requieren admin, gerencia, o area=it_data
(equipos que conocen las fuentes pueden anotar; resto puede leer).
"""
from __future__ import annotations

from typing import Annotated, Literal

import logging
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query

from app.auth.security import current_user
from app.db import catalog_metadata_db as cmd
from app.services import catalog_auto_doc as auto_doc

log = logging.getLogger("unidata.catalog_metadata.api")

router = APIRouter(prefix="/api/catalog-metadata", tags=["catalog-metadata"])

Unit = Literal["unistore", "unidrop", "unidev"]


def _can_edit(user: dict) -> bool:
    if user.get("is_admin"):
        return True
    role = (user.get("role") or "").lower()
    if role in ("admin", "gerencia"):
        return True
    area = (user.get("area_slug") or "").lower()
    return area == "it_data"


def _require_edit(user: dict) -> None:
    if not _can_edit(user):
        raise HTTPException(
            status_code=403,
            detail="Necesitas admin / gerencia / area=it_data para editar metadata del catalogo",
        )


@router.get("/{unit}")
def list_metadata(
    unit: Annotated[Unit, Path()],
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    """Lista metadata + stats de uso (queries + last_used) para una unit."""
    rows = cmd.list_for_unit(unit)
    stats = cmd.usage_stats(unit)
    enriched = []
    for r in rows:
        key = f"{r['schema_name']}.{r['table_name']}"
        s = stats.get(key, {})
        enriched.append({
            **r,
            "queries": s.get("queries", 0),
            "last_used_at": s.get("last_used_at"),
            "last_user": s.get("last_user"),
        })
    tags = cmd.all_tags(unit)
    return {"unit": unit, "items": enriched, "tags": tags}


@router.get("/{unit}/{schema_name}/{table_name}")
def get_metadata(
    unit: Annotated[Unit, Path()],
    schema_name: Annotated[str, Path()],
    table_name: Annotated[str, Path()],
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    row = cmd.get_for_table(unit, schema_name, table_name)
    return row or {
        "unit": unit,
        "schema_name": schema_name,
        "table_name": table_name,
        "description": None,
        "tags": [],
    }


@router.patch("/{unit}/{schema_name}/{table_name}")
def upsert_metadata(
    unit: Annotated[Unit, Path()],
    schema_name: Annotated[str, Path()],
    table_name: Annotated[str, Path()],
    user: Annotated[dict, Depends(current_user)],
    payload: Annotated[dict, Body()],
) -> dict:
    _require_edit(user)
    description = payload.get("description")
    tags = payload.get("tags")
    if description is not None and not isinstance(description, str):
        raise HTTPException(status_code=400, detail="description debe ser string o null")
    if tags is not None and not isinstance(tags, list):
        raise HTTPException(status_code=400, detail="tags debe ser array")

    try:
        return cmd.upsert(
            unit=unit,
            schema_name=schema_name,
            table_name=table_name,
            description=description,
            tags=tags,
            updated_by_id=int(user["id"]),
            updated_by_email=user.get("email", ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{unit}/{schema_name}/{table_name}")
def delete_metadata(
    unit: Annotated[Unit, Path()],
    schema_name: Annotated[str, Path()],
    table_name: Annotated[str, Path()],
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    _require_edit(user)
    deleted = cmd.delete_metadata(unit, schema_name, table_name)
    return {"deleted": deleted}


# -------------------------------------------------------------------
# AUTO-DOC con Gemini
# -------------------------------------------------------------------

@router.post("/{unit}/{schema_name}/{table_name}/auto-doc")
def auto_doc_table(
    unit: Annotated[Unit, Path()],
    schema_name: Annotated[str, Path()],
    table_name: Annotated[str, Path()],
    user: Annotated[dict, Depends(current_user)],
    force: Annotated[bool, Query()] = False,
) -> dict:
    """Genera descripcion + tags con Gemini para 1 tabla.
    Si la tabla ya tiene metadata editada manualmente, salta a menos que force=true."""
    _require_edit(user)

    existing = cmd.get_for_table(unit, schema_name, table_name)
    if existing and (existing.get("description") or existing.get("tags")) and not force:
        return {
            "status": "skipped",
            "reason": "ya tiene metadata - usar force=true para sobreescribir",
            "existing": existing,
        }

    try:
        ai = auto_doc.generate_doc_for_table(unit, schema_name, table_name)
    except Exception as e:
        log.warning("auto-doc fallo para %s.%s.%s: %s", unit, schema_name, table_name, e)
        raise HTTPException(status_code=500, detail=f"Gemini error: {e}")

    saved = cmd.upsert(
        unit=unit,
        schema_name=schema_name,
        table_name=table_name,
        description=ai["description"],
        tags=ai["tags"],
        updated_by_id=int(user["id"]),
        updated_by_email=f"auto-doc:{user.get('email','')}",
    )
    return {"status": "ok", "ai": ai, "saved": saved}


@router.post("/{unit}/auto-doc")
def auto_doc_schema(
    unit: Annotated[Unit, Path()],
    user: Annotated[dict, Depends(current_user)],
    schema: Annotated[str, Query()],
    force: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 40,
) -> dict:
    """Recorre todas las tablas de un schema y autodocumenta las que faltan.
    Tope de 40 tablas/request para no exceder timeouts del backend (~2s/tabla)."""
    _require_edit(user)

    tables = auto_doc.list_tables_in_schema(unit, schema)
    if not tables:
        return {"unit": unit, "schema": schema, "processed": [], "skipped": [], "errors": []}

    processed: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    started = time.time()
    for t in tables[:limit]:
        existing = cmd.get_for_table(unit, schema, t)
        if existing and (existing.get("description") or existing.get("tags")) and not force:
            skipped.append({"table": t, "reason": "ya tiene metadata"})
            continue
        try:
            ai = auto_doc.generate_doc_for_table(unit, schema, t)
            cmd.upsert(
                unit=unit,
                schema_name=schema,
                table_name=t,
                description=ai["description"],
                tags=ai["tags"],
                updated_by_id=int(user["id"]),
                updated_by_email=f"auto-doc:{user.get('email','')}",
            )
            processed.append({
                "table": t,
                "description": ai["description"][:120],
                "tags": ai["tags"],
            })
        except Exception as e:
            log.warning("auto-doc %s.%s.%s fallo: %s", unit, schema, t, e)
            errors.append({"table": t, "error": str(e)[:200]})

    return {
        "unit": unit,
        "schema": schema,
        "duration_sec": round(time.time() - started, 1),
        "total_tables": len(tables),
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
        "more_pending": len(tables) > limit,
    }
