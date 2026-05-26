"""
Aprende UNIDATA — endpoints de capacitacion.

Todos los users pueden ver/completar lecciones. No requiere area especifica.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.security import current_user
from app.db import aprende_db

router = APIRouter(prefix="/api/aprende", tags=["aprende"])


@router.get("/areas")
def list_areas(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Lista todas las areas con contador de lecciones + progreso del user."""
    items = aprende_db.list_areas_with_counts(user_id=user["id"])
    summary = aprende_db.my_progress_summary(user_id=user["id"])
    return {"items": items, "summary": summary}


@router.get("/lessons/{area_slug}")
def list_area_lessons(
    area_slug: str,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    items = aprende_db.list_lessons_for_area(area_slug=area_slug, user_id=user["id"])
    return {"items": items, "area_slug": area_slug, "count": len(items)}


class MarkBody(BaseModel):
    lesson_slug: str
    done: bool = True


@router.post("/progress")
def mark_progress(
    body: MarkBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return aprende_db.mark_lesson(
            user_id=user["id"], lesson_slug=body.lesson_slug, done=body.done,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/me")
def my_summary(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Resumen overall + breakdown por area."""
    return {
        "summary": aprende_db.my_progress_summary(user_id=user["id"]),
        "by_area": aprende_db.list_areas_with_counts(user_id=user["id"]),
    }
