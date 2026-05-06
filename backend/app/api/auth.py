"""Endpoints de auth."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.auth.security import current_user, issue_token
from app.config import Settings, get_settings
from app.db import users_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/login", response_model=TokenResponse)
def login(
    body: LoginBody,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    user = users_db.authenticate(body.email, body.password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales invalidas")
    if not user.get("is_active"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inactivo")
    token = issue_token(user["id"], user["email"], user["role"], settings)
    return TokenResponse(access_token=token, user=user)


@router.get("/me")
def me(user: Annotated[dict, Depends(current_user)]) -> dict:
    return user


@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if len(body.new_password) < 6:
        raise HTTPException(400, "Password muy corto (min 6)")
    ok = users_db.change_password(user["id"], body.current_password, body.new_password)
    if not ok:
        raise HTTPException(400, "Password actual incorrecto")
    return {"ok": True}
