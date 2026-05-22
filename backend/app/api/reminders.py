"""
Recordatorios personales del user UNIDATA.

GET    /api/reminders                  -> lista (filtros: status)
POST   /api/reminders                  -> crear
POST   /api/reminders/{id}/complete    -> marcar completado
DELETE /api/reminders/{id}             -> borrar
"""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.security import current_user
from app.db import reminders_db

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/reminders", tags=["reminders"])

Status = Literal["pending", "overdue", "upcoming", "done"]
TargetType = Literal["dropshipper", "order", "customer", "cs_action", "alert", "general"]
Unit = Literal["unistore", "unidrop"]


class CreateBody(BaseModel):
    target_type: TargetType = "general"
    target_id: str | None = Field(default=None, max_length=120)
    target_unit: Unit | None = None
    due_at: str = Field(..., max_length=40)  # ISO 8601
    note: str = Field(..., min_length=1, max_length=2000)


class CompleteBody(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.get("")
def list_my(
    user: Annotated[dict, Depends(current_user)],
    status: Annotated[Status, Query()] = "pending",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    items = reminders_db.list_for_user(user_id=user["id"], status=status, limit=limit)
    return {"items": items, "count": len(items)}


@router.post("", status_code=201)
@limiter.limit("60/minute")
def create(
    request: Request,
    body: CreateBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        due_at = dt.datetime.fromisoformat(body.due_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "due_at debe ser ISO 8601 (ej: '2026-05-22T15:00:00Z')")
    if due_at <= dt.datetime.now(dt.timezone.utc):
        raise HTTPException(400, "due_at debe ser en el futuro")
    try:
        return reminders_db.create_reminder(
            user_id=user["id"],
            target_type=body.target_type,
            target_id=body.target_id,
            target_unit=body.target_unit,
            due_at=due_at,
            note=body.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{reminder_id}/complete")
def complete(
    reminder_id: int,
    body: CompleteBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    result = reminders_db.complete_reminder(reminder_id, user["id"], body.note)
    if not result:
        raise HTTPException(404, "Reminder no encontrado, ya completado, o no es tuyo")
    return result


@router.delete("/{reminder_id}")
def delete(
    reminder_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    ok = reminders_db.delete_reminder(reminder_id, user["id"])
    if not ok:
        raise HTTPException(404, "Reminder no encontrado o no es tuyo")
    return {"ok": True}
