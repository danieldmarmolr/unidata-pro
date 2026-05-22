"""CRUD de templates persistentes de mensajes CS."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user, require_area
from app.db import cs_templates_db

router = APIRouter(prefix="/api/cs-templates", tags=["cs-templates"])


class CreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    source_type: str | None = Field(default=None, max_length=80)
    unit: Literal["unistore", "unidrop"] | None = None


class UpdateBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=4000)


class AttachBody(BaseModel):
    template_id: int | None = None


@router.get("")
def list_templates(
    user: Annotated[dict, Depends(current_user)],
    source_type: Annotated[str | None, Query()] = None,
    unit: Annotated[Literal["unistore", "unidrop"] | None, Query()] = None,
    include_archived: Annotated[bool, Query()] = False,
) -> dict:
    require_area(user, ["cs", "marketing"])
    items = cs_templates_db.list_templates(source_type=source_type, unit=unit, include_archived=include_archived)
    return {"items": items}


@router.post("")
def create(
    body: CreateBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    return cs_templates_db.create(
        name=body.name,
        body=body.body,
        source_type=body.source_type,
        unit=body.unit,
        created_by=user["id"],
    )


@router.patch("/{template_id}")
def update(
    template_id: int,
    body: UpdateBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_templates_db.update(template_id, name=body.name, body=body.body)
    if not result:
        raise HTTPException(404, "Template no encontrado")
    return result


@router.delete("/{template_id}")
def archive(
    template_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    ok = cs_templates_db.archive(template_id)
    if not ok:
        raise HTTPException(404, "Template no encontrado o ya archivado")
    return {"ok": True}


@router.post("/attach/{action_id}")
def attach(
    action_id: int,
    body: AttachBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Vincula un template a una accion + incrementa times_used."""
    require_area(user, ["cs", "marketing"])
    cs_templates_db.attach_to_action(action_id, body.template_id)
    if body.template_id:
        cs_templates_db.mark_used(body.template_id)
    return {"ok": True, "action_id": action_id, "template_id": body.template_id}
