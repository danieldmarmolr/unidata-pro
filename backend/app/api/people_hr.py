"""
People HR endpoints — time-off, onboarding, 1:1s, pulse surveys.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.security import current_user
from app.db import people_hr_db

router = APIRouter(prefix="/api/people", tags=["people-hr"])


def _is_privileged(user: dict) -> bool:
    return bool(user.get("is_admin")) or user.get("role") in ("admin", "gerencia")


def _can_manage_people(user: dict) -> bool:
    if _is_privileged(user):
        return True
    return user.get("area_slug") == "people" or "people" in (user.get("area_slugs") or [])


# ============================================================
# Time-off
# ============================================================

class TimeOffBody(BaseModel):
    kind: Literal["vacaciones", "licencia", "home_office", "viaje_work", "otro"]
    starts_on: str
    ends_on: str
    reason: str = Field(default="", max_length=2000)


class ReviewBody(BaseModel):
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=2000)


@router.post("/time-off", status_code=201)
def request_time_off(
    body: TimeOffBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_hr_db.request_time_off(
            user_id=user["id"], kind=body.kind,
            starts_on=body.starts_on, ends_on=body.ends_on,
            reason=body.reason,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/time-off")
def list_my_time_off(
    user: Annotated[dict, Depends(current_user)],
    user_id: int | None = None,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict:
    # Sin user_id explicito = mis solicitudes. Con user_id = solo si soy admin/People/gerencia
    target = user_id or user["id"]
    if target != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "no podes ver el time-off de otros")
    items = people_hr_db.list_time_off(user_id=target, status=status, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/time-off/approvals")
def my_pending_approvals(user: Annotated[dict, Depends(current_user)]) -> dict:
    items = people_hr_db.pending_for_manager(manager_id=user["id"])
    return {"items": items, "count": len(items)}


@router.post("/time-off/{time_off_id}/review")
def review(
    time_off_id: int,
    body: ReviewBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        result = people_hr_db.review_time_off(
            time_off_id=time_off_id, reviewer_id=user["id"],
            new_status=body.status, note=body.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result:
        raise HTTPException(404, "Solicitud no encontrada o ya revisada")
    return result


@router.post("/time-off/{time_off_id}/cancel")
def cancel(
    time_off_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    result = people_hr_db.cancel_time_off(time_off_id=time_off_id, user_id=user["id"])
    if not result:
        raise HTTPException(404, "Solicitud no encontrada o no podes cancelarla")
    return result


@router.get("/time-off/calendar")
def calendar(
    _: Annotated[dict, Depends(current_user)],
    month: Annotated[int, Query(ge=1, le=12)],
    year: Annotated[int, Query(ge=2020, le=2100)],
) -> dict:
    items = people_hr_db.team_calendar(month=month, year=year)
    return {"items": items, "month": month, "year": year, "count": len(items)}


# ============================================================
# Onboarding
# ============================================================

class CreateOnbBody(BaseModel):
    user_id: int
    manager_id: int | None = None


class TaskBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=400)
    description: str = Field(default="", max_length=2000)
    assignee_id: int | None = None
    due_date: str | None = None


class UpdateTaskBody(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    due_date: str | None = None
    status: Literal["pending", "in_progress", "done", "skipped"] | None = None
    sort_order: int | None = None


@router.get("/onboarding/{user_id}")
def list_onb(
    user_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    # Visible para el propio, su manager, o admin/People
    if user_id != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "sin permisos para ver este onboarding")
    items = people_hr_db.list_onboarding(user_id=user_id)
    return {"items": items, "count": len(items)}


@router.post("/onboarding/init", status_code=201)
def init_onb(
    body: CreateOnbBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People puede inicializar onboardings")
    items = people_hr_db.create_onboarding_for_user(
        user_id=body.user_id, created_by=user["id"], manager_id=body.manager_id,
    )
    return {"items": items, "count": len(items)}


@router.post("/onboarding/{user_id}/tasks", status_code=201)
def add_task(
    user_id: int,
    body: TaskBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if user_id != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "sin permisos")
    try:
        return people_hr_db.add_onboarding_task(
            user_id=user_id, title=body.title, description=body.description,
            assignee_id=body.assignee_id, due_date=body.due_date, created_by=user["id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/onboarding/tasks/{task_id}")
def update_task(
    task_id: int,
    body: UpdateTaskBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    payload = body.model_dump(exclude_unset=True, exclude_none=True)
    result = people_hr_db.update_onboarding_task(task_id=task_id, **payload)
    if not result:
        raise HTTPException(404, "Tarea no encontrada o sin cambios")
    return result


@router.delete("/onboarding/tasks/{task_id}")
def delete_task(
    task_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People")
    ok = people_hr_db.delete_onboarding_task(task_id=task_id)
    if not ok:
        raise HTTPException(404, "Tarea no encontrada")
    return {"ok": True}


# ============================================================
# 1:1s
# ============================================================

class OneOnOneBody(BaseModel):
    manager_id: int
    report_id: int
    scheduled_at: str


class UpdateOneOnOneBody(BaseModel):
    notes: str | None = None
    action_items: list[dict] | None = None
    scheduled_at: str | None = None
    completed: bool | None = None


@router.get("/one-on-ones")
def list_my_1on1s(
    user: Annotated[dict, Depends(current_user)],
    partner_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    items = people_hr_db.list_one_on_ones(viewer_id=user["id"], partner_id=partner_id, limit=limit)
    return {"items": items, "count": len(items)}


@router.post("/one-on-ones", status_code=201)
def create_1on1(
    body: OneOnOneBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    # Solo el manager (o admin) puede crear
    if body.manager_id != user["id"] and not _is_privileged(user):
        raise HTTPException(403, "solo el manager o admin puede crear el 1:1")
    try:
        return people_hr_db.create_one_on_one(
            manager_id=body.manager_id, report_id=body.report_id,
            scheduled_at=body.scheduled_at,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/one-on-ones/{one_on_one_id}")
def update_1on1(
    one_on_one_id: int,
    body: UpdateOneOnOneBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        result = people_hr_db.update_one_on_one(
            one_on_one_id=one_on_one_id, viewer_id=user["id"],
            **body.model_dump(exclude_unset=True),
        )
    except PermissionError:
        raise HTTPException(403, "no podes editar este 1:1")
    if not result:
        raise HTTPException(404, "1:1 no encontrado o sin cambios")
    return result


# ============================================================
# Pulse surveys
# ============================================================

class SurveyBody(BaseModel):
    kind: Literal["pulse", "enps", "custom"]
    question: str = Field(..., min_length=1, max_length=500)
    scale: Literal["nps", "1-5", "1-10", "yes_no", "options"] = "nps"
    options: list[str] | None = None
    anonymous: bool = True
    starts_at: str | None = None
    ends_at: str | None = None


class ResponseBody(BaseModel):
    value: int | None = None
    text_value: str | None = None
    comment: str = Field(default="", max_length=2000)


@router.get("/surveys/active")
def active_surveys(user: Annotated[dict, Depends(current_user)]) -> dict:
    items = people_hr_db.list_active_surveys(viewer_id=user["id"])
    return {"items": items, "count": len(items)}


@router.get("/surveys")
def all_surveys(
    user: Annotated[dict, Depends(current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People puede ver todas las encuestas")
    items = people_hr_db.list_all_surveys(limit=limit)
    return {"items": items, "count": len(items)}


@router.post("/surveys", status_code=201)
def create_survey(
    body: SurveyBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People puede crear encuestas")
    try:
        return people_hr_db.create_survey(
            kind=body.kind, question=body.question, scale=body.scale,
            options=body.options, anonymous=body.anonymous,
            starts_at=body.starts_at, ends_at=body.ends_at,
            created_by=user["id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/surveys/{survey_id}/respond", status_code=201)
def respond(
    survey_id: int,
    body: ResponseBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_hr_db.respond_survey(
            survey_id=survey_id, user_id=user["id"],
            value=body.value, text_value=body.text_value, comment=body.comment,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/surveys/{survey_id}/results")
def results(
    survey_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People puede ver resultados")
    return people_hr_db.survey_results(survey_id=survey_id)


@router.post("/surveys/{survey_id}/close")
def close(
    survey_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "solo admin/People puede cerrar encuestas")
    ok = people_hr_db.close_survey(survey_id=survey_id)
    if not ok:
        raise HTTPException(404, "encuesta no encontrada")
    return {"ok": True}
