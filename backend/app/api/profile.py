"""
Perfil de usuario extendido + onboarding flow.

Endpoints:
- GET  /api/users/me           -> profile completo (incluye area, cumple, etc)
- PATCH /api/users/me/profile  -> actualizar perfil (parcial; campos opcionales)
- GET  /api/users/areas        -> 10 areas oficiales para el dropdown
- GET  /api/users/stories      -> cumples + aniversarios del mes
- GET  /api/users/team         -> lista publica de companeros (nombre + area + foto)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.security import current_user
from app.db import areas_db

router = APIRouter(prefix="/api/users", tags=["users"])


class ProfilePatch(BaseModel):
    area_id: int | None = None
    secondary_area_ids: list[int] | None = None
    birthday_month: int | None = Field(default=None, ge=1, le=12)
    birthday_day: int | None = Field(default=None, ge=1, le=31)
    birthday_year: int | None = Field(default=None, ge=1900, le=2030)
    joined_at: str | None = None  # "YYYY-MM" o "YYYY-MM-DD"
    location_city: str | None = None
    interests: str | None = None
    avatar_url: str | None = None
    job_title: str | None = None
    bio: str | None = None
    mark_completed: bool = False


@router.get("/me")
def get_me(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Profile completo del user logueado, listo para el onboarding o la pagina de perfil."""
    p = areas_db.get_user_profile(user["id"])
    if not p:
        raise HTTPException(404, "User no encontrado")
    return {"user": p, "needs_onboarding": not p.get("profile_completed", False)}


@router.patch("/me/profile")
def patch_me(
    body: ProfilePatch,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        updated = areas_db.update_profile(
            user["id"],
            area_id=body.area_id,
            secondary_area_ids=body.secondary_area_ids,
            birthday_month=body.birthday_month,
            birthday_day=body.birthday_day,
            birthday_year=body.birthday_year,
            joined_at=body.joined_at,
            location_city=body.location_city,
            interests=body.interests,
            avatar_url=body.avatar_url,
            job_title=body.job_title,
            bio=body.bio,
            mark_completed=body.mark_completed,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not updated:
        raise HTTPException(404, "User no encontrado")
    return {"user": updated}


@router.get("/areas")
def list_areas(_: Annotated[dict, Depends(current_user)]) -> dict:
    return {"areas": areas_db.list_areas()}


@router.get("/stories")
def get_stories(
    _: Annotated[dict, Depends(current_user)],
    month: int | None = None,
) -> dict:
    """Cumples del mes + aniversarios del mes. Default: mes actual.
    `cumples_hoy` aparece como subset rapido para banner."""
    if month is not None and not (1 <= month <= 12):
        raise HTTPException(400, "month debe estar entre 1 y 12")
    return areas_db.stories_for_month(month)
