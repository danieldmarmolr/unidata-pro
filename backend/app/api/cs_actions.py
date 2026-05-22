"""
Cola de acciones para CS - generada desde modales del dashboard.

GET    /api/cs-actions                          -> listado (filtros: status, unit, assigned_to)
GET    /api/cs-actions/count                    -> conteo pendientes para badge
POST   /api/cs-actions                          -> crear (desde modal RFM segment/flow/manual)
POST   /api/cs-actions/{id}/take                -> CS toma la accion (pending -> doing)
POST   /api/cs-actions/{id}/complete            -> CS marca completada (con nota opcional)
POST   /api/cs-actions/{id}/cancel              -> cancelar
PATCH  /api/cs-actions/{id}/note                -> editar nota libre
PATCH  /api/cs-actions/{id}/priority            -> setear priority (low/normal/high)
PATCH  /api/cs-actions/{id}/deadline            -> setear deadline_at
POST   /api/cs-actions/{id}/assign              -> asignar a otro user (lider)
GET    /api/cs-actions/{id}/targets             -> targets enriquecidos (nombre+telefono+email)
GET    /api/cs-actions/{id}/stats               -> KPIs (contactados/respondieron/convirtieron)
POST   /api/cs-actions/{id}/targets/{tid}/status -> setear contact_status del target
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import text

from app.auth.security import current_user, require_area
from app.db import cs_actions_db
from app.db.engines import get_engine

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


class PriorityBody(BaseModel):
    priority: Literal["low", "normal", "high"]


class DeadlineBody(BaseModel):
    deadline_at: str | None = Field(default=None, description="ISO timestamp o null")


class AssignBody(BaseModel):
    user_id: int | None = Field(default=None, description="None para desasignar")


class TargetStatusBody(BaseModel):
    contact_status: Literal["pending", "contacted", "responded", "converted", "no_response", "opt_out"]
    note: str = Field(default="", max_length=1000)
    converted_amount: float | None = None


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


@router.post("/{action_id}/reopen")
def reopen(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Reabre una accion done/cancelled. Si tenia assigned_to vuelve a 'doing',
    sino a 'pending'."""
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.reopen_action(action_id)
    if not result:
        raise HTTPException(404, "Accion no encontrada o no esta cerrada")
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


@router.patch("/{action_id}/priority")
def patch_priority(
    action_id: int,
    body: PriorityBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.set_priority(action_id, body.priority)
    if not result:
        raise HTTPException(404, "Accion no encontrada")
    return result


@router.patch("/{action_id}/deadline")
def patch_deadline(
    action_id: int,
    body: DeadlineBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.set_deadline(action_id, body.deadline_at)
    if not result:
        raise HTTPException(404, "Accion no encontrada")
    return result


@router.post("/{action_id}/assign")
def assign(
    action_id: int,
    body: AssignBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.assign_action(action_id, body.user_id)
    if not result:
        raise HTTPException(404, "Accion no encontrada")
    return result


@router.get("/{action_id}/targets")
def list_targets(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Lista los targets de la accion enriquecidos con nombre + telefono + email.
    Sirve para que la bandeja arme cards con WhatsApp y permita difusion."""
    require_area(user, ["cs", "marketing"])
    action = cs_actions_db.get_action(action_id)
    if not action:
        raise HTTPException(404, "Accion no encontrada")

    target_ids = [int(x) for x in (action.get("target_ids") or [])]
    if not target_ids:
        return {"action_id": action_id, "unit": action.get("unit"), "items": [], "stats": cs_actions_db.action_stats(action_id)}

    unit = action.get("unit")
    enriched: dict[int, dict] = {}
    if unit == "unidrop":
        eng = get_engine("unidrop")
        with eng.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT u.id, COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS nombre,
                           COALESCE(u.email,'') AS email, COALESCE(u.phone,'') AS phone,
                           COALESCE(u.dni::text,'') AS dni
                    FROM public."User" u
                    WHERE u.id = ANY(:ids)
                """),
                {"ids": target_ids},
            ).fetchall()
        for r in rows:
            enriched[int(r[0])] = {"nombre": r[1], "email": r[2], "phone": r[3], "dni": r[4]}
    else:
        eng = get_engine("unistore")
        with eng.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT c.id, COALESCE(c.name, c.email, 'Customer '||c.id::text) AS nombre,
                           COALESCE(c.email,'') AS email, COALESCE(c.phone,'') AS phone
                    FROM tienda_nube."Customer" c
                    WHERE c.id = ANY(:ids)
                """),
                {"ids": target_ids},
            ).fetchall()
        for r in rows:
            enriched[int(r[0])] = {"nombre": r[1], "email": r[2], "phone": r[3], "dni": ""}

    targets_status = {t["target_id"]: t for t in cs_actions_db.list_targets(action_id)}

    items = []
    for tid in target_ids:
        info = enriched.get(tid) or {"nombre": f"#{tid}", "email": "", "phone": "", "dni": ""}
        st = targets_status.get(tid) or {}
        items.append({
            "target_id": tid,
            "nombre": info["nombre"],
            "email": info["email"],
            "phone": info["phone"],
            "dni": info.get("dni", ""),
            "contact_status": st.get("contact_status", "pending"),
            "contact_at": st.get("contact_at"),
            "response_at": st.get("response_at"),
            "converted_at": st.get("converted_at"),
            "converted_amount": st.get("converted_amount"),
            "notes": st.get("notes"),
            "updated_at": st.get("updated_at"),
        })

    return {
        "action_id": action_id,
        "unit": unit,
        "items": items,
        "stats": cs_actions_db.action_stats(action_id),
    }


@router.get("/{action_id}/stats")
def stats(
    action_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    return cs_actions_db.action_stats(action_id)


@router.post("/{action_id}/targets/{target_id}/status")
def set_target_status_endpoint(
    action_id: int,
    target_id: int,
    body: TargetStatusBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    require_area(user, ["cs", "marketing"])
    result = cs_actions_db.set_target_status(
        action_id=action_id,
        target_id=target_id,
        contact_status=body.contact_status,
        user_id=user["id"],
        note=body.note,
        converted_amount=body.converted_amount,
    )
    if not result:
        raise HTTPException(404, "Target no encontrado")
    return result
