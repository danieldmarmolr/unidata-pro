"""
Cola de acciones para CS - generada desde modales del dashboard.

GET    /api/cs-actions                  -> listado (filtros: status, unit, assigned_to)
GET    /api/cs-actions/count            -> conteo pendientes para badge
POST   /api/cs-actions                  -> crear (desde modal RFM segment/flow)
POST   /api/cs-actions/{id}/take        -> CS toma la accion (pending -> doing)
POST   /api/cs-actions/{id}/complete    -> CS marca completada (con nota opcional)
POST   /api/cs-actions/{id}/cancel      -> cancelar
PATCH  /api/cs-actions/{id}/note        -> editar nota libre
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.security import current_user, require_area
from app.db import cs_actions_db

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/cs-actions", tags=["cs-actions"])


class CreateActionBody(BaseModel):
    source_type: Literal["rfm_segment", "rfm_flow", "manual"]
    source_key: str = Field(..., min_length=1, max_length=200)
    unit: Literal["unistore", "unidrop"]
    title: str = Field(..., min_length=1, max_length=200)
    suggested_action: str = Field(..., min_length=1, max_length=2000)
    target_ids: list[int] = Field(default_factory=list, max_length=5000)
    metadata: dict | None = None


class NoteBody(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.get("")
def list_actions(
    user: Annotated[dict, Depends(current_user)],
    status: Annotated[Literal["pending", "doing", "done", "cancelled"] | None, Query()] = None,
    unit: Annotated[Literal["unistore", "unidrop"] | None, Query()] = None,
    assigned_to: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> dict:
    require_area(user, ["cs", "marketing"])
    items = cs_actions_db.list_actions(
        status=status, unit=unit, assigned_to=assigned_to, limit=limit,
    )
    return {
        "items": items,
        "pending_count": cs_actions_db.count_pending(),
        "pending_unistore": cs_actions_db.count_pending(unit="unistore"),
        "pending_unidrop": cs_actions_db.count_pending(unit="unidrop"),
    }


@router.get("/count")
def count(
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    return {
        "pending": cs_actions_db.count_pending(),
        "pending_unistore": cs_actions_db.count_pending(unit="unistore"),
        "pending_unidrop": cs_actions_db.count_pending(unit="unidrop"),
    }


@router.post("")
@limiter.limit("60/minute")
def create(
    request: Request,
    body: CreateActionBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    if not body.target_ids:
        raise HTTPException(400, "target_ids no puede estar vacio")
    action = cs_actions_db.create_action(
        source_type=body.source_type,
        source_key=body.source_key,
        unit=body.unit,
        title=body.title,
        suggested_action=body.suggested_action,
        target_ids=body.target_ids,
        created_by=user["id"],
        metadata=body.metadata,
    )
    return action


@router.post("/{action_id}/take")
def take(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs"])
    result = cs_actions_db.take_action(action_id, user["id"])
    if not result:
        raise HTTPException(404, "Accion no encontrada o ya tomada")
    return result


@router.post("/{action_id}/complete")
def complete(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
    body: NoteBody = Body(default_factory=NoteBody),
) -> dict:
    require_area(user, ["cs"])
    result = cs_actions_db.complete_action(action_id, user["id"], body.note)
    if not result:
        raise HTTPException(404, "Accion no encontrada o ya cerrada")
    return result


@router.post("/{action_id}/cancel")
def cancel(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
    body: NoteBody = Body(default_factory=NoteBody),
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.cancel_action(action_id, user["id"], body.note)
    if not result:
        raise HTTPException(404, "Accion no encontrada o ya cerrada")
    return result


@router.patch("/{action_id}/note")
def patch_note(
    action_id: int,
    body: NoteBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs"])
    result = cs_actions_db.update_note(action_id, body.note)
    if not result:
        raise HTTPException(404, "Accion no encontrada")
    return result
