"""
Mi gestion personal — endpoints del legajo del colaborador.

RBAC:
  - default: el user solo accede a SUS archivos (user_id == current_user.id)
  - admin/gerencia/People: pueden ver/subir/borrar archivos de cualquier user
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from app.auth.security import current_user
from app.db import personal_db

router = APIRouter(prefix="/api/personal", tags=["personal"])


def _can_manage_others(user: dict) -> bool:
    if bool(user.get("is_admin")) or user.get("role") in ("admin", "gerencia"):
        return True
    if user.get("area_slug") == "people":
        return True
    return "people" in (user.get("area_slugs") or [])


def _resolve_target(user: dict, requested_user_id: int | None) -> int:
    """Devuelve el user_id real a usar. Si pediste otro user, valida permisos."""
    target = requested_user_id or user["id"]
    if target != user["id"] and not _can_manage_others(user):
        raise HTTPException(403, "no podes acceder al legajo de otro usuario")
    return target


@router.get("/legajo")
def my_legajo(
    user: Annotated[dict, Depends(current_user)],
    user_id: int | None = None,
) -> dict:
    """Resumen del legajo: counts por kind + ultimo recibo."""
    target = _resolve_target(user, user_id)
    return {
        "user_id": target,
        "summary": personal_db.my_legajo_summary(user_id=target),
    }


@router.get("/files")
def list_my_files(
    user: Annotated[dict, Depends(current_user)],
    kind: Annotated[Literal["documento", "recibo", "contrato"] | None, Query()] = None,
    user_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> dict:
    target = _resolve_target(user, user_id)
    try:
        items = personal_db.list_files(user_id=target, kind=kind, limit=limit)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "count": len(items)}


@router.post("/files", status_code=201)
async def upload_file(
    user: Annotated[dict, Depends(current_user)],
    file: Annotated[UploadFile, File(...)],
    kind: Annotated[Literal["documento", "recibo", "contrato"], Form()],
    title: Annotated[str, Form()],
    doc_kind: Annotated[str, Form()] = "",
    period_year: Annotated[int | None, Form()] = None,
    period_month: Annotated[int | None, Form()] = None,
    notes: Annotated[str, Form()] = "",
    user_id: Annotated[int | None, Form()] = None,
) -> dict:
    target = _resolve_target(user, user_id)
    if not file.content_type or file.content_type not in personal_db.ALLOWED_MIMES:
        raise HTTPException(
            415,
            f"Tipo no permitido. Validos: pdf, png, jpeg, webp, docx, xlsx",
        )
    content = await file.read()
    if len(content) > personal_db.MAX_FILE_BYTES:
        raise HTTPException(
            413,
            f"Archivo muy grande (max {personal_db.MAX_FILE_BYTES // 1024 // 1024}MB)",
        )
    try:
        return personal_db.save_file(
            user_id=target,
            kind=kind,
            title=title,
            content=content,
            mime=file.content_type,
            filename=file.filename or "",
            doc_kind=doc_kind,
            period_year=period_year,
            period_month=period_month,
            notes=notes,
            uploaded_by=user["id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/files/{file_id}/download")
def download_file(
    file_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> Response:
    meta = personal_db.get_file_meta(file_id=file_id)
    if not meta:
        raise HTTPException(404, "Archivo no encontrado")
    if meta["user_id"] != user["id"] and not _can_manage_others(user):
        raise HTTPException(403, "no podes acceder a este archivo")

    blob = personal_db.get_file_blob(file_id=file_id)
    if not blob:
        raise HTTPException(404, "Archivo no encontrado")

    # filename para Content-Disposition
    fname = blob.get("filename") or blob.get("title", f"file_{file_id}")
    # Quitar caracteres problematicos para el header HTTP
    safe = "".join(ch for ch in fname if ord(ch) >= 32 and ch not in '"\\').strip() or f"file_{file_id}"

    return Response(
        content=bytes(blob["content"]),
        media_type=blob["mime"],
        headers={
            "Content-Disposition": f'inline; filename="{safe}"',
            "Cache-Control": "private, no-cache",
            "Content-Length": str(blob["size_bytes"]),
        },
    )


@router.delete("/files/{file_id}")
def delete_my_file(
    file_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    meta = personal_db.get_file_meta(file_id=file_id)
    if not meta:
        raise HTTPException(404, "Archivo no encontrado")
    if meta["user_id"] != user["id"] and not _can_manage_others(user):
        raise HTTPException(403, "no podes borrar archivos de otros")
    ok = personal_db.delete_file(file_id=file_id)
    return {"ok": ok}
