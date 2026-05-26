"""Admin endpoints - solo rol admin."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel

from app.auth.security import require_admin
from app.db import areas_db, users_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserCreate(BaseModel):
    email: str
    name: str = ""
    password: str
    role: str = "user"
    is_admin: bool = False
    area_id: int | None = None
    secondary_area_ids: list[int] | None = None
    manager_user_id: int | None = None
    job_title: str | None = None
    bio: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    is_admin: bool | None = None
    new_password: str | None = None
    area_id: int | None = None
    secondary_area_ids: list[int] | None = None
    manager_user_id: int | None = None
    job_title: str | None = None
    bio: str | None = None
    hidden_from_directory: bool | None = None
    clear_area: bool = False
    clear_manager: bool = False


@router.get("/areas")
def list_areas_admin(admin: Annotated[dict, Depends(require_admin)]) -> list[dict]:
    return areas_db.list_areas()


@router.get("/users")
def list_users(admin: Annotated[dict, Depends(require_admin)]) -> list[dict]:
    return users_db.list_all()


@router.post("/users", status_code=201)
def create_user(
    body: UserCreate,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    try:
        created = users_db.create(
            email=body.email,
            name=body.name,
            password=body.password,
            role=body.role,
            is_admin=body.is_admin,
            created_by=admin["email"],
        )
        needs_extra = (
            body.area_id is not None
            or body.manager_user_id is not None
            or body.job_title is not None
            or body.bio is not None
        )
        if needs_extra:
            users_db.update(
                created["id"],
                area_id=body.area_id,
                manager_user_id=body.manager_user_id,
                job_title=body.job_title,
                bio=body.bio,
            )
        if body.secondary_area_ids is not None:
            areas_db.set_user_areas(
                created["id"],
                primary_area_id=body.area_id,
                secondary_area_ids=body.secondary_area_ids,
            )
        return created
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/users/{user_id}")
def update_user(
    user_id: Annotated[int, Path()],
    body: UserUpdate,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    # Auto-proteccion: el admin no puede quitarse a si mismo el flag admin
    if user_id == admin["id"] and body.is_admin is False:
        raise HTTPException(400, "No podes quitarte a vos mismo el flag admin (perderias acceso al panel)")
    if user_id == admin["id"] and body.role and body.role == "lector":
        # Permitir gerencia/analista, solo bloquear bajadas a lector si tampoco mantiene is_admin
        if not body.is_admin:
            raise HTTPException(400, "No podes pasarte a lector sin mantener is_admin")
    if user_id == admin["id"] and body.is_active is False:
        raise HTTPException(400, "No podes desactivarte a vos mismo")
    try:
        result = users_db.update(
            user_id,
            name=body.name,
            role=body.role,
            is_active=body.is_active,
            is_admin=body.is_admin,
            new_password=body.new_password,
            area_id=body.area_id,
            manager_user_id=body.manager_user_id,
            job_title=body.job_title,
            bio=body.bio,
            hidden_from_directory=body.hidden_from_directory,
            clear_area=body.clear_area,
            clear_manager=body.clear_manager,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Si vino la lista de secundarias, la sobrescribimos atomicamente.
    # Aceptamos lista vacia (= sin secundarias). None = no tocar.
    if body.secondary_area_ids is not None:
        # Primaria final tras eventual update (clear_area / area_id)
        with_users = users_db.find_by_id(user_id)
        primary = with_users["area_id"] if with_users else None
        try:
            areas_db.set_user_areas(
                user_id,
                primary_area_id=primary,
                secondary_area_ids=body.secondary_area_ids,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        # Re-fetch para devolver el estado final tras el ajuste de secundarias
        result = users_db.find_by_id(user_id)
        result = users_db._to_dict(result) if result else result
    if result is None:
        raise HTTPException(404, "Usuario no encontrado o sin cambios")
    return result


@router.post("/backup/run")
def trigger_backup(admin: Annotated[dict, Depends(require_admin)]) -> dict:
    """Dispara backup manual de Supabase. Usa pg_dump + opcional S3.

    Requiere SUPABASE_DB_URL en entorno. Si BACKUP_S3_BUCKET tambien esta,
    sube el dump a S3. Sino, queda en disco local del server.
    """
    from app.scripts.backup_supabase import main as backup_main
    code = backup_main()
    if code != 0:
        raise HTTPException(500, f"Backup fallo con codigo {code}. Revisa logs del server.")
    return {"ok": True, "message": "Backup ejecutado correctamente"}
