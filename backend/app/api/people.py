"""
People module — gestion social interna (Humand replacement).

Endpoints (todos requieren JWT):
  GET    /api/people/directory                  -> lista plana de colaboradores
  GET    /api/people/org-chart                  -> data para arbol jerarquico
  GET    /api/people/profile/{user_id}          -> perfil publico
  GET    /api/people/stories                    -> cumples + aniversarios del mes

  GET    /api/people/feed                       -> feed paginado (pinned + recientes)
  POST   /api/people/feed                       -> crear post (cualquier user activo)
  PATCH  /api/people/feed/{id}                  -> editar post propio (o admin)
  DELETE /api/people/feed/{id}                  -> soft-delete (autor o admin/People)
  POST   /api/people/feed/{id}/pin              -> pinear (admin/gerencia/People)
  POST   /api/people/feed/{id}/unpin            -> despinear (admin/gerencia/People)
  POST   /api/people/feed/{id}/read             -> confirmar lectura de anuncio
  GET    /api/people/feed/{id}/reads            -> lista de lectores (admin/gerencia/People)

  POST   /api/people/feed/{id}/react            -> toggle reaccion emoji
  GET    /api/people/feed/{id}/comments         -> lista de comentarios
  POST   /api/people/feed/{id}/comments         -> crear comentario
  DELETE /api/people/comments/{cid}             -> borrar comentario (autor o admin/People)

  GET    /api/people/kudos                      -> lista de kudos (filtros: to/from/value)
  POST   /api/people/kudos                      -> dar kudos (crea auto-post en feed)
  GET    /api/people/kudos/leaderboard          -> top dadores/receptores + por value

  GET    /api/people/values                     -> valores activos
  POST   /api/people/values                     -> crear value (admin/People)
  PATCH  /api/people/values/{id}                -> editar value (admin/People)
  DELETE /api/people/values/{id}                -> soft-delete value (admin/People)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth.security import current_user
from app.db import areas_db, people_db

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/people", tags=["people"])


def _is_privileged(user: dict) -> bool:
    """admin / is_admin=TRUE / gerencia tienen bypass total."""
    return (
        bool(user.get("is_admin"))
        or user.get("role") == "admin"
        or user.get("role") == "gerencia"
    )


def _can_manage_people(user: dict) -> bool:
    """Privilegiados + colaboradores cuya area primaria/secundaria es People."""
    if _is_privileged(user):
        return True
    area_slugs = user.get("area_slugs") or []
    if user.get("area_slug") == "people":
        return True
    return "people" in area_slugs


# ---------- directory + org chart ----------

@router.get("/directory")
def get_directory(
    _: Annotated[dict, Depends(current_user)],
    only_active: bool = True,
) -> dict:
    items = people_db.list_directory(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.get("/org-chart")
def get_org_chart(_: Annotated[dict, Depends(current_user)]) -> dict:
    items = people_db.org_chart()
    return {"items": items, "count": len(items)}


@router.get("/profile/{user_id}")
def get_profile(
    user_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    p = people_db.get_public_profile(user_id, viewer_id=user["id"])
    if not p:
        raise HTTPException(404, "Colaborador no encontrado")
    return p


@router.get("/stories")
def get_stories(
    _: Annotated[dict, Depends(current_user)],
    month: int | None = None,
) -> dict:
    if month is not None and not (1 <= month <= 12):
        raise HTTPException(400, "month debe estar entre 1 y 12")
    return areas_db.stories_for_month(month)


# ---------- feed ----------

class PollBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=400)
    options: list[str] = Field(..., min_length=2, max_length=10)
    multi_choice: bool = False
    closes_at: str | None = None


class CreatePostBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=8000)
    image_url: str | None = None
    space_id: int | None = None
    mention_user_ids: list[int] | None = None
    poll: PollBody | None = None


class UpdatePostBody(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    image_url: str | None = None


class PinPostBody(BaseModel):
    pinned_until: str | None = None  # ISO date opcional
    requires_read_ack: bool = False


class ReactBody(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=16)


class CommentBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    mention_user_ids: list[int] | None = None


@router.get("/feed")
def list_feed(
    user: Annotated[dict, Depends(current_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before_id: int | None = None,
    space_id: int | None = None,
) -> dict:
    items = people_db.list_feed(
        viewer_id=user["id"], limit=limit, before_id=before_id, space_id=space_id,
    )
    next_cursor = items[-1]["id"] if items and len(items) >= limit else None
    return {"items": items, "next_before_id": next_cursor}


@router.post("/feed", status_code=201)
@limiter.limit("30/minute")
def create_post(
    request: Request,
    body: CreatePostBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    # Verificar policy del espacio si viene
    if body.space_id is not None:
        sp = people_db.get_space(body.space_id)
        if not sp:
            raise HTTPException(404, "Espacio no encontrado")
        if not people_db.can_post_in_space(
            sp, is_privileged=_is_privileged(user), in_people=_can_manage_people(user),
        ):
            raise HTTPException(403, f"No podes postear en {sp['name']}")
    try:
        post = people_db.create_post(
            author_id=user["id"],
            content=body.content,
            image_url=body.image_url,
            space_id=body.space_id,
            mention_user_ids=body.mention_user_ids,
        )
        if body.poll:
            people_db.create_poll(
                post_id=post["id"],
                question=body.poll.question,
                options=body.poll.options,
                multi_choice=body.poll.multi_choice,
                closes_at=body.poll.closes_at,
            )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return post


@router.patch("/feed/{post_id}")
def update_post(
    post_id: int,
    body: UpdatePostBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    if existing["author_id"] != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "Solo el autor o People/admin puede editar este post")
    try:
        result = people_db.update_post(
            post_id, content=body.content, image_url=body.image_url,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result:
        raise HTTPException(400, "sin cambios")
    return result


@router.delete("/feed/{post_id}")
def delete_post(
    post_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing:
        raise HTTPException(404, "Post no encontrado")
    if existing["author_id"] != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "Solo el autor o People/admin puede borrar este post")
    ok = people_db.delete_post(post_id)
    if not ok:
        raise HTTPException(404, "Post ya estaba borrado")
    return {"ok": True}


@router.post("/feed/{post_id}/pin")
def pin_post(
    post_id: int,
    body: PinPostBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede pinear anuncios")
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    result = people_db.pin_post(
        post_id,
        by_user_id=user["id"],
        pinned_until=body.pinned_until,
        requires_read_ack=body.requires_read_ack,
    )
    if not result:
        raise HTTPException(400, "no se pudo pinear")
    return result


@router.post("/feed/{post_id}/unpin")
def unpin_post(
    post_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede despinear")
    result = people_db.unpin_post(post_id)
    if not result:
        raise HTTPException(404, "Post no encontrado")
    return result


@router.post("/feed/{post_id}/read")
def mark_read(
    post_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    people_db.mark_post_read(post_id, user["id"])
    return {"ok": True}


@router.get("/feed/{post_id}/reads")
def list_reads(
    post_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede ver la lista de lectores")
    items = people_db.list_post_reads(post_id)
    return {"items": items, "count": len(items)}


# ---------- reactions ----------

@router.post("/feed/{post_id}/react")
def react(
    post_id: int,
    body: ReactBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    try:
        return people_db.toggle_reaction(post_id, user["id"], body.emoji)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- comments ----------

@router.get("/feed/{post_id}/comments")
def list_comments(
    post_id: int,
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    items = people_db.list_comments(post_id)
    return {"items": items, "count": len(items)}


@router.post("/feed/{post_id}/comments", status_code=201)
@limiter.limit("60/minute")
def create_comment(
    request: Request,
    post_id: int,
    body: CommentBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    try:
        return people_db.create_comment(
            post_id, user["id"], body.content,
            mention_user_ids=body.mention_user_ids,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_comment(comment_id)
    if not existing:
        raise HTTPException(404, "Comentario no encontrado")
    if existing["author_id"] != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "Solo el autor o People/admin puede borrar")
    ok = people_db.delete_comment(comment_id)
    if not ok:
        raise HTTPException(404, "Comentario ya estaba borrado")
    return {"ok": True}


# ---------- kudos ----------

class KudoBody(BaseModel):
    to_user_id: int
    value_slug: str = Field(..., min_length=1, max_length=64)
    message: str = Field(default="", max_length=2000)


@router.get("/kudos")
def list_kudos(
    _: Annotated[dict, Depends(current_user)],
    to_user_id: int | None = None,
    from_user_id: int | None = None,
    value_slug: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    items = people_db.list_kudos(
        to_user_id=to_user_id,
        from_user_id=from_user_id,
        value_slug=value_slug,
        limit=limit,
    )
    return {"items": items, "count": len(items)}


@router.post("/kudos", status_code=201)
@limiter.limit("30/minute")
def give_kudo(
    request: Request,
    body: KudoBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_db.create_kudo(
            from_user_id=user["id"],
            to_user_id=body.to_user_id,
            value_slug=body.value_slug,
            message=body.message,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/kudos/leaderboard")
def kudos_leaderboard(
    _: Annotated[dict, Depends(current_user)],
    since_days: Annotated[int, Query(ge=1, le=365)] = 90,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict:
    return people_db.kudos_leaderboard(since_days=since_days, limit=limit)


# ---------- values ----------

class ValueBody(BaseModel):
    slug: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    emoji: str = Field(..., min_length=1, max_length=16)
    color: str = Field(default="#7a3eae", max_length=16)
    description: str = Field(default="", max_length=500)


class UpdateValueBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    emoji: str | None = Field(default=None, min_length=1, max_length=16)
    color: str | None = Field(default=None, max_length=16)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None
    sort_order: int | None = None


@router.get("/values")
def get_values(
    _: Annotated[dict, Depends(current_user)],
    only_active: bool = True,
) -> dict:
    items = people_db.list_values(only_active=only_active)
    return {"items": items, "count": len(items)}


@router.post("/values", status_code=201)
def create_value(
    body: ValueBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede crear valores")
    try:
        return people_db.create_value(
            slug=body.slug,
            name=body.name,
            emoji=body.emoji,
            color=body.color,
            description=body.description,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/values/{value_id}")
def update_value(
    value_id: int,
    body: UpdateValueBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede editar valores")
    payload = body.model_dump(exclude_unset=True)
    result = people_db.update_value(value_id, **payload)
    if not result:
        raise HTTPException(404, "Valor no encontrado o sin cambios")
    return result


@router.delete("/values/{value_id}")
def delete_value(
    value_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede desactivar valores")
    ok = people_db.delete_value(value_id)
    if not ok:
        raise HTTPException(404, "Valor no encontrado")
    return {"ok": True}


# ============================================================
# Spaces (canales)
# ============================================================

@router.get("/spaces")
def list_spaces(user: Annotated[dict, Depends(current_user)]) -> dict:
    items = people_db.list_spaces(viewer_id=user["id"])
    return {"items": items, "count": len(items)}


# ============================================================
# Mentions search (autocompletar @)
# ============================================================

@router.get("/users/search")
def search_users(
    _: Annotated[dict, Depends(current_user)],
    q: str = "",
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
) -> dict:
    items = people_db.search_users_for_mention(q, limit=limit)
    return {"items": items, "count": len(items)}


# ============================================================
# DMs (conversations + messages)
# ============================================================

class CreateDMBody(BaseModel):
    user_id: int


class CreateGroupBody(BaseModel):
    name: str = Field(default="", max_length=120)
    member_ids: list[int] = Field(..., min_length=1)


class MessageBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    image_url: str | None = None


@router.get("/conversations")
def list_conversations(user: Annotated[dict, Depends(current_user)]) -> dict:
    items = people_db.list_my_conversations(user_id=user["id"])
    return {"items": items, "count": len(items)}


@router.post("/conversations/dm", status_code=201)
def create_dm(
    body: CreateDMBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        cid = people_db.get_or_create_dm(user_a=user["id"], user_b=body.user_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"conversation_id": cid}


@router.post("/conversations/group", status_code=201)
def create_group(
    body: CreateGroupBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        cid = people_db.create_group_conversation(
            name=body.name, created_by=user["id"], member_ids=body.member_ids,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"conversation_id": cid}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: int,
    user: Annotated[dict, Depends(current_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before_id: int | None = None,
) -> dict:
    try:
        items = people_db.list_messages(
            conversation_id=conversation_id,
            viewer_id=user["id"],
            limit=limit,
            before_id=before_id,
        )
    except PermissionError:
        raise HTTPException(403, "No sos miembro de esta conversation")
    next_cursor = items[0]["id"] if items and len(items) >= limit else None
    return {"items": items, "next_before_id": next_cursor}


@router.post("/conversations/{conversation_id}/messages", status_code=201)
@limiter.limit("120/minute")
def send_message(
    request: Request,
    conversation_id: int,
    body: MessageBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_db.post_message(
            conversation_id=conversation_id,
            author_id=user["id"],
            content=body.content,
            image_url=body.image_url,
        )
    except PermissionError:
        raise HTTPException(403, "No sos miembro de esta conversation")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/conversations/{conversation_id}/read")
def mark_conv_read(
    conversation_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    people_db.mark_conversation_read(conversation_id=conversation_id, user_id=user["id"])
    return {"ok": True}


# ============================================================
# Notifications / Inbox
# ============================================================

@router.get("/notifications")
def list_notifications(
    user: Annotated[dict, Depends(current_user)],
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    items = people_db.list_notifications(
        user_id=user["id"], unread_only=unread_only, limit=limit,
    )
    return {"items": items, "count": len(items)}


@router.get("/notifications/badge")
def notifications_badge(user: Annotated[dict, Depends(current_user)]) -> dict:
    return people_db.unread_badge(user_id=user["id"])


@router.post("/notifications/{notification_id}/read")
def mark_notif_read(
    notification_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    ok = people_db.mark_notification_read(
        notification_id=notification_id, user_id=user["id"],
    )
    return {"ok": ok}


@router.post("/notifications/read-all")
def mark_all_read(user: Annotated[dict, Depends(current_user)]) -> dict:
    n = people_db.mark_all_notifications_read(user_id=user["id"])
    return {"marked": n}


# ============================================================
# Edit comment
# ============================================================

class UpdateCommentBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


@router.patch("/comments/{comment_id}")
def update_comment(
    comment_id: int,
    body: UpdateCommentBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_comment(comment_id)
    if not existing:
        raise HTTPException(404, "Comentario no encontrado")
    if existing["author_id"] != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "Solo el autor o People/admin puede editar")
    try:
        return people_db.update_comment(comment_id, content=body.content) or {}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ============================================================
# Polls
# ============================================================

class VoteBody(BaseModel):
    option_id: int


@router.post("/feed/{post_id}/poll/vote")
def vote_on_poll(
    post_id: int,
    body: VoteBody,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_db.vote_poll(post_id=post_id, option_id=body.option_id, user_id=user["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/feed/{post_id}/poll/vote")
def unvote_on_poll(
    post_id: int,
    option_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    try:
        return people_db.unvote_poll(post_id=post_id, option_id=option_id, user_id=user["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


# ============================================================
# Bookmarks
# ============================================================

@router.post("/feed/{post_id}/bookmark")
def toggle_bookmark(
    post_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    existing = people_db.get_post(post_id)
    if not existing or existing.get("deleted_at"):
        raise HTTPException(404, "Post no encontrado")
    return people_db.toggle_bookmark(post_id=post_id, user_id=user["id"])


@router.get("/bookmarks")
def list_bookmarks(
    user: Annotated[dict, Depends(current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    items = people_db.list_my_bookmarks(user_id=user["id"], limit=limit)
    return {"items": items, "count": len(items)}


# ============================================================
# Search global
# ============================================================

@router.get("/search")
def search(
    user: Annotated[dict, Depends(current_user)],
    q: str = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict:
    return people_db.search_all(query=q, viewer_id=user["id"], limit=limit)


# ============================================================
# Insights (analytics) - solo admin/People/gerencia
# ============================================================

@router.get("/insights")
def insights(
    user: Annotated[dict, Depends(current_user)],
    since_days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> dict:
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/gerencia/People puede ver insights")
    return people_db.insights_dashboard(since_days=since_days)


# ============================================================
# Email digest (HTML para que n8n / SMTP / Resend envie)
# ============================================================

@router.get("/digest/preview", response_model=None)
def digest_preview(
    user: Annotated[dict, Depends(current_user)],
    target_user_id: int | None = None,
    as_html: bool = False,
):
    """Preview del digest del user (default: self).
    Si as_html=true devuelve text/html para inspeccion en browser.
    Admin/People pueden ver el digest de otros (target_user_id)."""
    uid = target_user_id or user["id"]
    if uid != user["id"] and not _can_manage_people(user):
        raise HTTPException(403, "sin permisos")
    data = people_db.digest_data_for_user(user_id=uid)
    if as_html:
        import os
        frontend = os.environ.get("FRONTEND_URL", "https://app.unidatacenter.com.ar")
        html = _render_digest_html(data, frontend)
        return Response(content=html or "<p>Sin contenido nuevo</p>", media_type="text/html")
    return data


@router.get("/digest/recipients")
def digest_recipients(
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Lista de users con contenido en su digest. Para n8n: itera esto,
    pega el HTML via /digest/preview?target_user_id=X&as_html=true,
    y envia el email."""
    if not _can_manage_people(user):
        raise HTTPException(403, "Solo admin/People puede ejecutar el digest masivo")
    # Recorrer users activos
    with people_db.get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, name, email FROM users WHERE is_active = TRUE ORDER BY id")
        all_users = [dict(r) for r in cur.fetchall()]
    recipients = []
    for u in all_users:
        d = people_db.digest_data_for_user(user_id=u["id"])
        if d.get("has_content"):
            recipients.append({
                "user_id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "unread_notifs": len(d.get("unread_notifs", [])),
                "unread_dms": sum(x["n"] for x in d.get("unread_dms", [])),
            })
    return {"recipients": recipients, "count": len(recipients)}


# ============================================================
# Uploads (imagenes embebidas)
# ============================================================

@router.post("/uploads", status_code=201)
@limiter.limit("30/minute")
async def upload_image(
    request: Request,
    user: Annotated[dict, Depends(current_user)],
    file: Annotated[UploadFile, File(...)],
) -> dict:
    if not file.content_type or file.content_type not in people_db.ALLOWED_MIMES:
        raise HTTPException(415, f"Tipo no permitido. Validos: jpeg, png, webp, gif")
    content = await file.read()
    if len(content) > people_db.MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"Archivo muy grande (max {people_db.MAX_UPLOAD_SIZE // 1024 // 1024}MB)")
    try:
        return people_db.save_upload(
            content=content, mime=file.content_type, uploaded_by=user["id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


def _render_digest_html(data: dict, frontend_url: str) -> str:
    """Render HTML email-safe del digest."""
    if not data.get("has_content"):
        return ""
    u = data.get("user", {})
    rows = []
    rows.append(f"""<div style="background:#7a3eae;color:#fff;padding:20px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:20px;">Hola {u.get('name', 'che')} 👋</h1>
        <div style="opacity:.9;font-size:13px;margin-top:4px;">Tu resumen diario de UNIDATA · People</div>
    </div>""")

    if data["birthdays_today"]:
        items = ", ".join(b["name"] for b in data["birthdays_today"])
        rows.append(f"""<div style="padding:16px 20px;border-bottom:1px solid #eee;background:#fef3c7;">
            <div style="font-size:13px;font-weight:bold;color:#92400e;">🎂 Hoy cumple</div>
            <div style="font-size:13px;margin-top:4px;">{items}</div>
        </div>""")

    if data["unread_dms"]:
        dms_html = "".join(
            f'<div style="margin-top:4px;font-size:12px;color:#475569;">'
            f'  <b>{d.get("name") or "DM"}</b>: {(d.get("last_preview") or "")[:80]}'
            f'  <span style="color:#7a3eae;font-weight:bold;"> · {d["n"]} sin leer</span>'
            f'</div>'
            for d in data["unread_dms"]
        )
        rows.append(f"""<div style="padding:16px 20px;border-bottom:1px solid #eee;">
            <div style="font-size:13px;font-weight:bold;color:#0f172a;">💬 Mensajes sin leer ({len(data["unread_dms"])})</div>
            {dms_html}
            <a href="{frontend_url}/dashboard/people/dms" style="display:inline-block;margin-top:8px;font-size:12px;color:#7a3eae;font-weight:bold;text-decoration:none;">Abrir DMs →</a>
        </div>""")

    if data["unread_notifs"]:
        notif_html = "".join(
            f'<div style="margin-top:4px;font-size:12px;color:#475569;">'
            f'  <b>{n.get("actor_name") or "Alguien"}</b> · {n["kind"]}: {(n.get("preview") or "")[:80]}'
            f'</div>'
            for n in data["unread_notifs"]
        )
        rows.append(f"""<div style="padding:16px 20px;border-bottom:1px solid #eee;">
            <div style="font-size:13px;font-weight:bold;color:#0f172a;">🔔 Notificaciones ({len(data["unread_notifs"])})</div>
            {notif_html}
            <a href="{frontend_url}/dashboard/people/inbox" style="display:inline-block;margin-top:8px;font-size:12px;color:#7a3eae;font-weight:bold;text-decoration:none;">Abrir Inbox →</a>
        </div>""")

    if data["top_posts"]:
        posts_html = "".join(
            f'<div style="margin-top:8px;padding:8px;background:#f8fafc;border-radius:6px;">'
            f'  <div style="font-size:11px;color:#94a3b8;">'
            f'    {p.get("space_emoji") or "💬"} {p.get("space_name") or "Feed"} · {p["author_name"]}'
            f'  </div>'
            f'  <div style="font-size:12px;margin-top:2px;">{(p.get("content") or "")[:140]}</div>'
            f'  <div style="font-size:10px;color:#94a3b8;margin-top:4px;">{p["reactions"]} reacciones · {p["comments"]} comentarios</div>'
            f'</div>'
            for p in data["top_posts"][:3]
        )
        rows.append(f"""<div style="padding:16px 20px;border-bottom:1px solid #eee;">
            <div style="font-size:13px;font-weight:bold;color:#0f172a;">📣 Posts destacados del dia</div>
            {posts_html}
        </div>""")

    if data["upcoming_events"]:
        ev_html = "".join(
            f'<div style="margin-top:4px;font-size:12px;color:#475569;">'
            f'  <b>{e["title"]}</b> · {(e.get("starts_at") or "")[:16].replace("T", " ")}'
            f'  {" · " + (e.get("location") or "") if e.get("location") else ""}'
            f'  {" · <span style=color:#10b981;>vas</span>" if e.get("my_rsvp") == "yes" else ""}'
            f'</div>'
            for e in data["upcoming_events"]
        )
        rows.append(f"""<div style="padding:16px 20px;border-bottom:1px solid #eee;">
            <div style="font-size:13px;font-weight:bold;color:#0f172a;">📅 Proximos eventos</div>
            {ev_html}
        </div>""")

    rows.append(f"""<div style="padding:16px 20px;font-size:11px;color:#94a3b8;text-align:center;background:#f8fafc;border-radius:0 0 12px 12px;">
        Enviado por UNIDATA People · <a href="{frontend_url}/dashboard/people" style="color:#7a3eae;">Abrir panel</a>
    </div>""")

    return f"""<!DOCTYPE html><html><body style="margin:0;padding:20px;font-family:-apple-system,sans-serif;background:#f1f5f9;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);">
            {"".join(rows)}
        </div>
    </body></html>"""


@router.get("/uploads/{upload_id}")
def serve_upload(upload_id: int) -> Response:
    """Sirve el contenido binario de un upload. Publico (no requiere auth)
    porque las URLs son dificiles de adivinar y se usan para <img src=>."""
    row = people_db.get_upload(upload_id)
    if not row:
        raise HTTPException(404, "Upload no encontrado")
    return Response(
        content=row["content"],
        media_type=row["mime"],
        headers={
            "Cache-Control": "public, max-age=2592000, immutable",
            "Content-Length": str(row["size_bytes"]),
        },
    )
