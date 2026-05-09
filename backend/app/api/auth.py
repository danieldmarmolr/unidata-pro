"""Endpoints de auth."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.security import current_user, issue_token
from app.config import Settings, get_settings
from app.db import users_db

# Limiter compartido (configurado en main.py) - lo usamos solo para decorar endpoints
limiter = Limiter(key_func=get_remote_address)

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


class RegisterBody(BaseModel):
    email: str
    name: str


class SetInitialPasswordBody(BaseModel):
    email: str
    new_password: str


class CheckBody(BaseModel):
    email: str


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")  # Anti brute-force: max 10 intentos por minuto por IP
def login(
    request: Request,
    body: LoginBody,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    user = users_db.authenticate(body.email, body.password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales invalidas")
    if not user.get("is_active"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inactivo")
    token = issue_token(user["id"], user["email"], user["role"], settings, is_admin=user.get("is_admin", False))
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


# ----- Self-registration (Camino A: dominio @unistore.ar) -----

@router.post("/register")
@limiter.limit("5/minute")  # Anti spam: max 5 registros por minuto por IP
def register(request: Request, body: RegisterBody) -> dict:
    """Self-registration con dominio @unistore.ar.
    Crea cuenta en estado 'pendiente de password' (rol lector).
    Despues de esto el frontend debe pedirle al user que setee su password
    con POST /set-initial-password.
    """
    try:
        user = users_db.register_pending(email=body.email, name=body.name)
    except ValueError as e:
        msg = str(e)
        if "ya existe" in msg.lower():
            raise HTTPException(status.HTTP_409_CONFLICT, msg) from None
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg) from None
    return {"user": user, "requires_password_setup": True}


@router.post("/set-initial-password", response_model=TokenResponse)
def set_initial_password(
    body: SetInitialPasswordBody,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    """Setea la primera password de un user recien creado por self-registration
    (o de uno cuyo password fue reseteado por un admin).
    Solo funciona si el user existe activo y password_hash IS NULL.
    Devuelve un JWT directamente para no obligar al usuario a hacer login despues.
    """
    try:
        user = users_db.set_initial_password(body.email, body.new_password)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    if not user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "el usuario ya tiene password seteada o no existe - usa /login",
        )
    token = issue_token(user["id"], user["email"], user["role"], settings, is_admin=user.get("is_admin", False))
    return TokenResponse(access_token=token, user=user)


@router.post("/check")
def check_email_status(body: CheckBody) -> dict:
    """Endpoint helper para que el frontend sepa que mostrar:
    - exists=False, valid_domain=True  -> formulario de registro
    - exists=True, needs_password=True -> formulario de set-initial-password
    - exists=True, needs_password=False -> formulario de login
    """
    email = body.email.strip().lower()
    valid_domain = email.endswith(f"@{users_db.ALLOWED_REGISTRATION_DOMAIN}")
    user = users_db.find_by_email(email)
    return {
        "email": email,
        "valid_domain": valid_domain,
        "exists": user is not None,
        "needs_password": users_db.needs_password_setup(email),
        "is_active": bool(user["is_active"]) if user else False,
    }
