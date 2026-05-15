"""JWT helpers + dependencies para auth/role."""
from __future__ import annotations

import datetime as dt
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.config import Settings, get_settings
from app.db import users_db, areas_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def issue_token(
    user_id: int,
    email: str,
    role: str,
    settings: Settings | None = None,
    is_admin: bool = False,
    expires_hours: int | None = None,
    scope: str | None = None,
) -> str:
    s = settings or get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    hours = expires_hours if expires_hours is not None else s.jwt_expires_hours
    payload: dict = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "is_admin": bool(is_admin) or role == "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=hours)).timestamp()),
    }
    if scope:
        payload["scope"] = scope
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_token(token: str, settings: Settings | None = None) -> dict:
    s = settings or get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])


async def current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autorizado")
    try:
        payload = decode_token(token, settings)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalido")
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token sin sub")
    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalido")
    row = users_db.find_by_id(user_id)
    if not row or not row["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inactivo")
    profile = areas_db.get_user_profile(user_id)
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "role": row["role"],
        "is_admin": bool(row.get("is_admin")) or row["role"] == "admin",
        "area_id": profile.get("area_id") if profile else None,
        "area_slug": profile.get("area_slug") if profile else None,
    }


def require_area(user: dict, areas: list[str]) -> None:
    """Lanza 403 si el usuario no pertenece a ninguna de las areas requeridas.
    Admin y gerencia tienen bypass completo.
    """
    if user.get("is_admin") or user.get("role") in ("admin", "gerencia"):
        return
    user_area = user.get("area_slug")
    if not user_area or user_area not in areas:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Tu área ({user_area or 'sin área asignada'}) no tiene acceso a este recurso",
        )


async def require_admin(user: Annotated[dict, Depends(current_user)]) -> dict:
    """Permite acceso si role='admin' (legacy) o is_admin=TRUE (nuevo modelo).

    Asi 'gerencia' u otros roles pueden tambien tener permisos de admin si el
    superadmin se los otorga via el flag is_admin.
    """
    if not user.get("is_admin") and user.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere permisos de admin")
    return user
