"""Endpoints cron / autopilot para Customer Success.

Estos endpoints estan pensados para ser disparados desde un scheduler externo
(Railway cron, github actions, llamada manual del equipo) - asi evitamos
problemas de in-process scheduler con multi-worker.

Endpoints (todos requieren area cs o marketing):
- POST /api/cs-cron/reconcile-conversions  -> auto-marca converted los targets
  que despues del contact_at hicieron una compra.
- POST /api/cs-cron/weekly-rules           -> ejecuta reglas semanales:
  posible churn de la semana, VIP sin compra 30d, bienvenida nuevos.
- POST /api/cs-cron/detect-triggers        -> detecta eventos (cancel VIP,
  devoluciones recientes) y crea acciones.

Todas las funciones son IDEMPOTENTES: chequean por source_key + ventana antes
de crear una accion duplicada el mismo dia/semana.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.auth.security import current_user, require_area
from app.db import cs_actions_db
from app.db.engines import get_engine
from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.cs_cron")

router = APIRouter(prefix="/api/cs-cron", tags=["cs-cron"])


# -----------------------------------------------------------------------------
# Bloque C: reconcile conversions
# -----------------------------------------------------------------------------

@router.post("/reconcile-conversions")
def reconcile_conversions(
    user: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query(ge=1, le=180)] = 60,
) -> dict:
    """Para cada target en estado contacted/responded de los ultimos N dias,
    busca compras pagadas posteriores al contact_at y las atribuye como
    conversion. Idempotente: si ya esta converted no lo toca."""
    require_area(user, ["cs", "marketing"])
    result = {"unistore": 0, "unidrop": 0}

    # Unistore: customerId del target = tienda_nube.Customer.id
    open_unistore = cs_actions_db.list_open_targets_for_reconcile("unistore", days=days)
    if open_unistore:
        eng = get_engine("unistore")
        ids = list({int(r["target_id"]) for r in open_unistore})
        with eng.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT o."customerId" AS customer_id, o."createdAt" AS at, o.total::float AS amount
                    FROM tienda_nube."Order" o
                    WHERE o."customerId" = ANY(:ids)
                      AND o."paymentStatus" = 'paid'
                      AND o."createdAt" >= NOW() - (:days::int || ' days')::interval
                """),
                {"ids": ids, "days": days},
            ).fetchall()
        # Indexar pagos por customer_id
        by_cust: dict[int, list[tuple]] = {}
        for r in rows:
            by_cust.setdefault(int(r[0]), []).append((r[1], float(r[2] or 0)))
        # Cruzar contra cada target
        to_mark = []
        for t in open_unistore:
            tid = int(t["target_id"])
            contact_iso = t["contact_at"]
            contact_at = datetime.fromisoformat(contact_iso) if contact_iso else None
            if not contact_at:
                continue
            total = sum(
                amt for (at, amt) in by_cust.get(tid, [])
                if (at.replace(tzinfo=None) if at.tzinfo else at) > contact_at.replace(tzinfo=None)
            )
            if total > 0:
                to_mark.append({"action_id": int(t["action_id"]), "target_id": tid, "amount": float(total)})
        if to_mark:
            result["unistore"] = cs_actions_db.mark_converted_bulk(to_mark)

    # Unidrop: target_id = User.id, buscar PaymentIntent PROCESSED post contact_at
    open_unidrop = cs_actions_db.list_open_targets_for_reconcile("unidrop", days=days)
    if open_unidrop:
        eng = get_engine("unidrop")
        ids = list({int(r["target_id"]) for r in open_unidrop})
        with eng.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT cpa."userId" AS user_id, pi."createdAt" AS at, pi."paidAmount"::float AS amount
                    FROM public."PaymentIntent" pi
                    JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
                    WHERE cpa."userId" = ANY(:ids)
                      AND pi."status" = 'PROCESSED'
                      AND pi."createdAt" >= NOW() - (:days::int || ' days')::interval
                """),
                {"ids": ids, "days": days},
            ).fetchall()
        by_user: dict[int, list[tuple]] = {}
        for r in rows:
            by_user.setdefault(int(r[0]), []).append((r[1], float(r[2] or 0)))
        to_mark = []
        for t in open_unidrop:
            tid = int(t["target_id"])
            contact_iso = t["contact_at"]
            contact_at = datetime.fromisoformat(contact_iso) if contact_iso else None
            if not contact_at:
                continue
            total = sum(
                amt for (at, amt) in by_user.get(tid, [])
                if (at.replace(tzinfo=None) if at.tzinfo else at) > contact_at.replace(tzinfo=None)
            )
            if total > 0:
                to_mark.append({"action_id": int(t["action_id"]), "target_id": tid, "amount": float(total)})
        if to_mark:
            result["unidrop"] = cs_actions_db.mark_converted_bulk(to_mark)

    return {"ok": True, "marked_converted": result, "window_days": days}


# -----------------------------------------------------------------------------
# Bloque D: reglas weekly (autopilot)
# -----------------------------------------------------------------------------

def _already_exists_today(source_key: str, unit: str) -> bool:
    """True si ya hay una accion con ese source_key + unit creada en las
    ultimas 18 horas (evita crear duplicados si se llama el endpoint dos veces)."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM cs_actions
            WHERE source_key = %s AND unit = %s
              AND created_at >= NOW() - INTERVAL '18 hours'
            LIMIT 1
            """,
            (source_key, unit),
        )
        return cur.fetchone() is not None


def _rule_posible_churn_unistore(days_window: int = 7) -> dict | None:
    """Customers que entraron en estado posible_churn esta semana."""
    if _already_exists_today("autopilot_posible_churn_unistore", "unistore"):
        return None
    eng = get_engine("unistore")
    with eng.connect() as conn:
        # Customers con >=2 ordenes paid, ultima compra hace 60+ dias y al menos
        # una compra dentro de los ultimos 90 dias (para que sea reciente el churn).
        rows = conn.execute(
            text("""
                WITH stats AS (
                  SELECT c.id,
                         COUNT(*) FILTER (WHERE o."paymentStatus" = 'paid') AS n,
                         MAX(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS last_at
                  FROM tienda_nube."Customer" c
                  JOIN tienda_nube."Order" o ON o."customerId" = c.id
                  GROUP BY c.id
                )
                SELECT id FROM stats
                WHERE n >= 2
                  AND last_at < NOW() - INTERVAL '60 days'
                  AND last_at >= NOW() - INTERVAL '90 days'
            """),
        ).fetchall()
    ids = [int(r[0]) for r in rows]
    if not ids:
        return None
    return {"ids": ids, "unit": "unistore",
            "title": f"[Autopilot] Posible churn semanal Unistore · {len(ids)} clientes",
            "source_key": "autopilot_posible_churn_unistore",
            "suggested_action": "Clientes con 2+ compras que entraron en estado churn esta semana (gap >60d, <90d). Contactar por WhatsApp con descuento + recordatorio del producto que mas compraron."}


def _rule_vip_sin_compra_30d() -> dict | None:
    if _already_exists_today("autopilot_vip_inactivo_30d", "unistore"):
        return None
    eng = get_engine("unistore")
    with eng.connect() as conn:
        # VIP heuristico: lifetime_total >= 300k
        rows = conn.execute(
            text("""
                WITH stats AS (
                  SELECT c.id,
                         SUM(o.total) FILTER (WHERE o."paymentStatus" = 'paid')::float AS lifetime,
                         MAX(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS last_at
                  FROM tienda_nube."Customer" c
                  JOIN tienda_nube."Order" o ON o."customerId" = c.id
                  GROUP BY c.id
                )
                SELECT id FROM stats
                WHERE lifetime >= 300000
                  AND last_at < NOW() - INTERVAL '30 days'
                  AND last_at >= NOW() - INTERVAL '120 days'
            """),
        ).fetchall()
    ids = [int(r[0]) for r in rows]
    if not ids:
        return None
    return {"ids": ids, "unit": "unistore",
            "title": f"[Autopilot] VIP inactivo 30+ dias Unistore · {len(ids)} clientes",
            "source_key": "autopilot_vip_inactivo_30d",
            "suggested_action": "Clientes VIP (lifetime >=$300k) sin compra hace 30+ dias. Contactar PERSONALMENTE (no plantilla), preguntar feedback, ofrecer beneficio exclusivo."}


def _rule_bienvenida_nuevos_24h() -> dict | None:
    if _already_exists_today("autopilot_bienvenida_24h", "unistore"):
        return None
    eng = get_engine("unistore")
    with eng.connect() as conn:
        # Customers cuya PRIMERA compra paid fue en las ultimas 24h
        rows = conn.execute(
            text("""
                WITH first AS (
                  SELECT c.id, MIN(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS first_at
                  FROM tienda_nube."Customer" c
                  JOIN tienda_nube."Order" o ON o."customerId" = c.id
                  GROUP BY c.id
                )
                SELECT id FROM first WHERE first_at >= NOW() - INTERVAL '24 hours'
            """),
        ).fetchall()
    ids = [int(r[0]) for r in rows]
    if not ids:
        return None
    return {"ids": ids, "unit": "unistore",
            "title": f"[Autopilot] Bienvenida 24h Unistore · {len(ids)} clientes",
            "source_key": "autopilot_bienvenida_24h",
            "suggested_action": "Primeros compradores de las ultimas 24h. Agradecer la compra, confirmar entrega, pedir review post-entrega."}


@router.post("/weekly-rules")
def run_weekly_rules(
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Ejecuta las reglas configuradas. Idempotente (no duplica si ya corrio
    en las ultimas 18h)."""
    require_area(user, ["cs", "marketing"])
    rules = [_rule_posible_churn_unistore, _rule_vip_sin_compra_30d, _rule_bienvenida_nuevos_24h]
    created = []
    skipped = []
    for fn in rules:
        try:
            r = fn()
            if r is None:
                skipped.append(fn.__name__)
                continue
            action = cs_actions_db.create_action(
                source_type="manual",
                source_key=r["source_key"],
                unit=r["unit"],
                title=r["title"],
                suggested_action=r["suggested_action"],
                target_ids=r["ids"],
                created_by=int(user["id"]),
                metadata={"autopilot": True, "rule": fn.__name__},
            )
            created.append({"rule": fn.__name__, "action_id": action["id"], "targets": len(r["ids"])})
        except Exception as e:
            log.exception("autopilot rule failed: %s", fn.__name__)
            skipped.append(f"{fn.__name__}:error:{e}")
    return {"ok": True, "created": created, "skipped": skipped}


# -----------------------------------------------------------------------------
# Bloque E: triggers desde eventos
# -----------------------------------------------------------------------------

def _trigger_cancel_vip(window_days: int = 1) -> dict | None:
    """Customers VIP cuya orden mas reciente fue cancelada en la ventana."""
    if _already_exists_today("trigger_cancel_vip", "unistore"):
        return None
    eng = get_engine("unistore")
    with eng.connect() as conn:
        rows = conn.execute(
            text("""
                WITH last_status AS (
                  SELECT DISTINCT ON (o."customerId") o."customerId" AS customer_id,
                         o.status, o."paymentStatus", o."createdAt"
                  FROM tienda_nube."Order" o
                  ORDER BY o."customerId", o."createdAt" DESC
                ),
                lifetime AS (
                  SELECT c.id, SUM(o.total) FILTER (WHERE o."paymentStatus" = 'paid')::float AS lt
                  FROM tienda_nube."Customer" c
                  JOIN tienda_nube."Order" o ON o."customerId" = c.id
                  GROUP BY c.id
                )
                SELECT ls.customer_id
                FROM last_status ls
                JOIN lifetime lf ON lf.id = ls.customer_id
                WHERE ls.status = 'cancelled'
                  AND ls."createdAt" >= NOW() - (:days::int || ' days')::interval
                  AND lf.lt >= 300000
            """),
            {"days": window_days},
        ).fetchall()
    ids = [int(r[0]) for r in rows]
    if not ids:
        return None
    return {"ids": ids, "unit": "unistore",
            "title": f"[Trigger] Cancelacion VIP ultima 24h · {len(ids)} casos",
            "source_key": "trigger_cancel_vip",
            "suggested_action": "Clientes VIP que cancelaron su ultima orden hace <24h. URGENTE - contactar HOY, entender motivo, intentar recuperar la venta o evitar churn."}


@router.post("/detect-triggers")
def detect_triggers(
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """Detecta eventos accionables y crea las cs_actions correspondientes."""
    require_area(user, ["cs", "marketing"])
    triggers = [_trigger_cancel_vip]
    created = []
    skipped = []
    for fn in triggers:
        try:
            r = fn()
            if r is None:
                skipped.append(fn.__name__)
                continue
            action = cs_actions_db.create_action(
                source_type="manual",
                source_key=r["source_key"],
                unit=r["unit"],
                title=r["title"],
                suggested_action=r["suggested_action"],
                target_ids=r["ids"],
                created_by=int(user["id"]),
                metadata={"trigger": True, "rule": fn.__name__},
            )
            # Auto-priority alta para triggers
            cs_actions_db.set_priority(action["id"], "high")
            created.append({"rule": fn.__name__, "action_id": action["id"], "targets": len(r["ids"])})
        except Exception as e:
            log.exception("trigger failed: %s", fn.__name__)
            skipped.append(f"{fn.__name__}:error:{e}")
    return {"ok": True, "created": created, "skipped": skipped}
