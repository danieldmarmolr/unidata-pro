"""Admin endpoints - solo rol admin."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel

from app.auth.security import require_admin
from app.db import users_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserCreate(BaseModel):
    email: str
    name: str = ""
    password: str
    role: str = "user"


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    new_password: str | None = None


@router.get("/users")
def list_users(admin: Annotated[dict, Depends(require_admin)]) -> list[dict]:
    return users_db.list_all()


@router.post("/users", status_code=201)
def create_user(
    body: UserCreate,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    try:
        return users_db.create(
            email=body.email,
            name=body.name,
            password=body.password,
            role=body.role,
            created_by=admin["email"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/users/{user_id}")
def update_user(
    user_id: Annotated[int, Path()],
    body: UserUpdate,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    if user_id == admin["id"] and body.role and body.role != "admin":
        raise HTTPException(400, "No podes degradarte a vos mismo (perderias acceso al panel)")
    if user_id == admin["id"] and body.is_active is False:
        raise HTTPException(400, "No podes desactivarte a vos mismo")
    try:
        result = users_db.update(
            user_id,
            name=body.name,
            role=body.role,
            is_active=body.is_active,
            new_password=body.new_password,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if result is None:
        raise HTTPException(404, "Usuario no encontrado o sin cambios")
    return result
