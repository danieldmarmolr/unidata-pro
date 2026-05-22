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
    """Lista los targets de la accion enriquecidos con TODA la data util para
    personalizar la difusion: nombre, telefono, email, dni, ciudad, ultima
    compra, monto ultima, dias desde ultima, ticket promedio, lifetime spent,
    cantidad de ordenes, top SKU.

    Variables disponibles para el template: {{nombre}}, {{primer_nombre}},
    {{email}}, {{dni}}, {{ciudad}}, {{ultima_compra}}, {{dias_desde_ultima}},
    {{monto_ultima}}, {{ticket_promedio}}, {{lifetime_total}}, {{ordenes_total}},
    {{top_sku}}, {{top_producto}}.
    """
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
                    WITH user_stats AS (
                        SELECT u.id AS user_id,
                               COALESCE(SUM(pi."paidAmount") FILTER (WHERE pi."status" = 'PROCESSED'), 0)::float AS lifetime_total,
                               MAX(pi."createdAt") FILTER (WHERE pi."status" = 'PROCESSED') AS ultima_venta,
                               COUNT(*) FILTER (WHERE pi."status" = 'PROCESSED')::int AS pi_count,
                               AVG(pi."paidAmount") FILTER (WHERE pi."status" = 'PROCESSED')::float AS ticket_avg
                        FROM public."User" u
                        LEFT JOIN public."CustomerPaymentAccount" cpa ON cpa."userId" = u.id
                        LEFT JOIN public."PaymentIntent" pi ON pi."customerAccountId" = cpa.id
                        WHERE u.id = ANY(:ids)
                        GROUP BY u.id
                    )
                    SELECT u.id,
                           COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS nombre,
                           COALESCE(u.email,'')                    AS email,
                           COALESCE(u.phone,'')                    AS phone,
                           COALESCE(u.dni::text,'')                AS dni,
                           COALESCE(u.city,'')                     AS ciudad,
                           COALESCE(us.lifetime_total, 0)::float   AS lifetime_total,
                           us.ultima_venta::date                   AS ultima_compra,
                           CASE WHEN us.ultima_venta IS NOT NULL
                                THEN EXTRACT(DAY FROM (NOW() - us.ultima_venta))::int
                                ELSE NULL END                      AS dias_desde_ultima,
                           COALESCE(us.pi_count, 0)::int           AS ordenes_total,
                           COALESCE(us.ticket_avg, 0)::float       AS ticket_promedio
                    FROM public."User" u
                    LEFT JOIN user_stats us ON us.user_id = u.id
                    WHERE u.id = ANY(:ids)
                """),
                {"ids": target_ids},
            ).fetchall()
        for r in rows:
            enriched[int(r[0])] = {
                "nombre": r[1], "email": r[2], "phone": r[3], "dni": r[4],
                "ciudad": r[5],
                "lifetime_total": float(r[6] or 0),
                "ultima_compra": r[7].isoformat() if r[7] else None,
                "dias_desde_ultima": r[8],
                "ordenes_total": int(r[9] or 0),
                "ticket_promedio": float(r[10] or 0),
                "monto_ultima": 0.0,  # PaymentIntent es agregado, no se ata a una sola venta
                "top_sku": "",
                "top_producto": "",
            }
    else:
        eng = get_engine("unistore")
        with eng.connect() as conn:
            rows = conn.execute(
                text("""
                    WITH cust_stats AS (
                        SELECT c.id AS customer_id,
                               COALESCE(SUM(o.total) FILTER (WHERE o."paymentStatus" = 'paid'), 0)::float AS lifetime_total,
                               COUNT(*) FILTER (WHERE o."paymentStatus" = 'paid')::int  AS ordenes_total,
                               AVG(o.total) FILTER (WHERE o."paymentStatus" = 'paid')::float AS ticket_avg,
                               MAX(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS ultima_compra_ts
                        FROM tienda_nube."Customer" c
                        LEFT JOIN tienda_nube."Order" o ON o."customerId" = c.id
                        WHERE c.id = ANY(:ids)
                        GROUP BY c.id
                    ),
                    last_order AS (
                        SELECT DISTINCT ON (o."customerId")
                               o."customerId" AS customer_id,
                               o.total       AS monto_ultima,
                               o.id          AS last_order_id
                        FROM tienda_nube."Order" o
                        WHERE o."customerId" = ANY(:ids) AND o."paymentStatus" = 'paid'
                        ORDER BY o."customerId", o."createdAt" DESC
                    ),
                    top_sku_per_cust AS (
                        SELECT customer_id, sku, name, total_qty
                        FROM (
                            SELECT o."customerId" AS customer_id,
                                   oi.sku, oi.name,
                                   SUM(oi.quantity)::int AS total_qty,
                                   ROW_NUMBER() OVER (PARTITION BY o."customerId" ORDER BY SUM(oi.quantity) DESC) AS rn
                            FROM tienda_nube."Order" o
                            JOIN tienda_nube."OrderItem" oi ON oi."orderId" = o.id
                            WHERE o."customerId" = ANY(:ids)
                              AND o."paymentStatus" = 'paid'
                              AND oi.sku IS NOT NULL AND oi.sku <> ''
                            GROUP BY o."customerId", oi.sku, oi.name
                        ) ranked
                        WHERE rn = 1
                    )
                    SELECT c.id,
                           COALESCE(c.name, c.email, 'Customer '||c.id::text) AS nombre,
                           COALESCE(c.email,'')               AS email,
                           COALESCE(c.phone,'')               AS phone,
                           COALESCE(c.city, c.province, '')   AS ciudad,
                           COALESCE(cs.lifetime_total, 0)::float AS lifetime_total,
                           cs.ultima_compra_ts::date          AS ultima_compra,
                           CASE WHEN cs.ultima_compra_ts IS NOT NULL
                                THEN EXTRACT(DAY FROM (NOW() - cs.ultima_compra_ts))::int
                                ELSE NULL END                 AS dias_desde_ultima,
                           COALESCE(cs.ordenes_total, 0)::int AS ordenes_total,
                           COALESCE(cs.ticket_avg, 0)::float  AS ticket_promedio,
                           COALESCE(lo.monto_ultima, 0)::float AS monto_ultima,
                           COALESCE(t.sku, '')                AS top_sku,
                           COALESCE(t.name, '')               AS top_producto
                    FROM tienda_nube."Customer" c
                    LEFT JOIN cust_stats cs   ON cs.customer_id = c.id
                    LEFT JOIN last_order lo   ON lo.customer_id = c.id
                    LEFT JOIN top_sku_per_cust t ON t.customer_id = c.id
                    WHERE c.id = ANY(:ids)
                """),
                {"ids": target_ids},
            ).fetchall()
        for r in rows:
            enriched[int(r[0])] = {
                "nombre": r[1], "email": r[2], "phone": r[3], "dni": "",
                "ciudad": r[4],
                "lifetime_total": float(r[5] or 0),
                "ultima_compra": r[6].isoformat() if r[6] else None,
                "dias_desde_ultima": r[7],
                "ordenes_total": int(r[8] or 0),
                "ticket_promedio": float(r[9] or 0),
                "monto_ultima": float(r[10] or 0),
                "top_sku": r[11] or "",
                "top_producto": r[12] or "",
            }

    targets_status = {t["target_id"]: t for t in cs_actions_db.list_targets(action_id)}

    items = []
    for tid in target_ids:
        info = enriched.get(tid) or {
            "nombre": f"#{tid}", "email": "", "phone": "", "dni": "",
            "ciudad": "", "lifetime_total": 0.0, "ultima_compra": None,
            "dias_desde_ultima": None, "ordenes_total": 0, "ticket_promedio": 0.0,
            "monto_ultima": 0.0, "top_sku": "", "top_producto": "",
        }
        st = targets_status.get(tid) or {}
        items.append({
            "target_id": tid,
            **info,
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


@router.get("/performance/summary")
def performance(
    user: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query(ge=1, le=365)] = 60,
) -> dict:
    """Funnel + ROI + breakdown por source_type, unit, status."""
    require_area(user, ["cs", "marketing"])
    return cs_actions_db.performance_summary(days=days)


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
