"""
GET    /api/dropshipper-notes              -> lista por dropshipper
POST   /api/dropshipper-notes              -> crear
PATCH  /api/dropshipper-notes/{id}         -> editar (autor o admin)
POST   /api/dropshipper-notes/{id}/archive -> archivar (soft-delete)
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.security import current_user
from app.db import dropshipper_notes_db

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/dropshipper-notes", tags=["dropshipper-notes"])

Unit = Literal["unistore", "unidrop"]
Category = Literal["general", "cs", "billing", "support", "retention", "flag", "ops"]


class CreateBody(BaseModel):
    dropshipper_id: int
    unit: Unit
    note: str = Field(..., min_length=1, max_length=4000)
    category: Category = "general"


class UpdateBody(BaseModel):
    note: str | None = Field(default=None, min_length=1, max_length=4000)
    category: Category | None = None


@router.get("")
def list_notes(
    _: Annotated[dict, Depends(current_user)],
    dropshipper_id: Annotated[int, Query()],
    unit: Annotated[Unit, Query()],
    include_archived: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    items = dropshipper_notes_db.list_for_dropshipper(
        dropshipper_id=dropshipper_id,
        dropshipper_unit=unit,
        include_archived=include_archived,
        limit=limit,
    )
    return {"items": items, "count": len(items)}


@router.post("", status_code=201)
@limiter.limit("60/minute")
def create(
    request: Request,
    body: CreateBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return dropshipper_notes_db.create_note(
            dropshipper_id=body.dropshipper_id,
            dropshipper_unit=body.unit,
            author_id=user["id"],
            author_email=user["email"],
            note=body.note,
            category=body.category,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{note_id}")
def update(
    note_id: int,
    body: UpdateBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = dropshipper_notes_db.get_note(note_id)
    if not existing:
        raise HTTPException(404, "Nota no encontrada")
    is_admin = bool(user.get("is_admin")) or user.get("role") == "admin"
    if existing["author_id"] != user["id"] and not is_admin:
        raise HTTPException(403, "Solo el autor (o un admin) puede editar la nota")
    try:
        result = dropshipper_notes_db.update_note(
            note_id, note=body.note, category=body.category,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result:
        raise HTTPException(404, "Nota archivada o sin cambios")
    return result


@router.post("/{note_id}/archive")
def archive(
    note_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    result = dropshipper_notes_db.archive_note(note_id, archived_by=user["id"])
    if not result:
        raise HTTPException(404, "Nota no encontrada o ya archivada")
    return result
