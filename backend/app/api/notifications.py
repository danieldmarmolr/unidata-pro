"""
Endpoints de notificaciones in-app (it_alerts).

GET    /api/notifications              -> lista de alertas (filtros: pending, severity)
GET    /api/notifications/count        -> conteo de pendientes (para badge sidebar)
POST   /api/notifications/{id}/resolve -> marcar como revisada
POST   /api/notifications/{id}/unresolve -> reabrir (admin only)
POST   /api/notifications/sync         -> dispara generacion automatica (cron)
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.security import current_user, require_admin
from app.db import notifications_db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    _: Annotated[dict, Depends(current_user)],
    only_pending: Annotated[bool, Query()] = False,
    severity: Annotated[Literal["info", "warning", "critical"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    items = notifications_db.list_alerts(
        only_pending=only_pending, limit=limit, severity=severity,
    )
    pending_count = notifications_db.count_pending()
    critical_count = notifications_db.count_pending(severity="critical")
    return {
        "items": items,
        "pending_count": pending_count,
        "critical_pending_count": critical_count,
    }


@router.get("/count")
def count(
    _: Annotated[dict, Depends(current_user)],
) -> dict:
    """Conteo de pendientes (para badge en sidebar). Endpoint super liviano."""
    return {
        "pending": notifications_db.count_pending(),
        "critical_pending": notifications_db.count_pending(severity="critical"),
    }


@router.post("/{alert_id}/resolve")
def resolve(
    alert_id: int,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    result = notifications_db.mark_resolved(alert_id, user["id"])
    if not result:
        raise HTTPException(404, "Alerta no encontrada o ya resuelta")
    return result


@router.post("/{alert_id}/unresolve")
def unresolve(
    alert_id: int,
    _: Annotated[dict, Depends(require_admin)],
) -> dict:
    result = notifications_db.mark_unresolved(alert_id)
    if not result:
        raise HTTPException(404, "Alerta no encontrada")
    return result


@router.post("/sync")
def sync_alerts(
    _: Annotated[dict, Depends(require_admin)],
) -> dict:
    """Dispara la generacion de alertas desde integration_health + dashboards.
    Solo admin (en futuro lo lanza un cron sin auth)."""
    from app.services import dashboards as dash_svc
    result = dash_svc.executive_overview(period="30d")
    integrations = result.get("integration_health", [])
    created: list[dict] = []
    for ig in integrations:
        status = ig.get("status")
        days = ig.get("days_since_last")
        name = ig.get("name") or "?"
        unit = ig.get("unit") or "?"
        if status == "error":
            alert = notifications_db.create_alert(
                type="integration_down",
                severity="critical",
                source=f"{unit}/{name}",
                title=f"Integracion '{name}' sin actividad",
                message=(
                    f"La integracion {name} ({unit}) no ha tenido lecturas hace {days} dias."
                    " Revisar credenciales, webhooks o conexion."
                ),
                metadata={"unit": unit, "days_since_last": days},
                dedupe_key=f"integration:{unit}:{name}",
            )
            if alert:
                created.append(alert)
        elif status == "warn":
            alert = notifications_db.create_alert(
                type="integration_slow",
                severity="warning",
                source=f"{unit}/{name}",
                title=f"Integracion '{name}' lenta",
                message=f"La integracion {name} ({unit}) tiene retraso de {days} dia(s).",
                metadata={"unit": unit, "days_since_last": days},
                dedupe_key=f"integration-slow:{unit}:{name}",
            )
            if alert:
                created.append(alert)
    # Alertas operativas top de Gerencia tambien generan notificaciones
    for op_alert in (result.get("top_alerts") or [])[:5]:
        if not isinstance(op_alert, str):
            continue
        alert = notifications_db.create_alert(
            type="operational",
            severity="warning",
            source="dashboards/executive",
            title="Alerta operativa",
            message=op_alert,
            metadata={},
            dedupe_key=f"op:{op_alert[:80]}",
        )
        if alert:
            created.append(alert)
    return {"created": len(created), "items": created}
