"""
Churn de suscripciones MELI — overview para el dashboard Gerencia.

Cruza:
- `subscription_refund_requests` (Supabase) — solicitudes formales de baja
- `subscription_refund_telemetry` (Supabase) — errores client-side del form

Iteracion 1: solo agregados a partir de las dos tablas Supabase. Iteracion 2
sumara revenue churned desde `PaymentIntentSubscription` y analisis LLM.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.subscription_churn")

_VALID_PERIODS = {"30d": 30, "90d": 90, "6m": 180, "1y": 365}


def _period_days(period: str) -> int:
    return _VALID_PERIODS.get(period, 30)


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def get_churn_overview(period: str = "30d") -> dict:
    days = _period_days(period)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT status, COUNT(*)::int AS count
            FROM subscription_refund_requests
            WHERE created_at >= %s
            GROUP BY status
            """,
            (cutoff,),
        )
        by_status = {r["status"]: int(r["count"]) for r in cur.fetchall()}

        cur.execute(
            """
            SELECT abandonment_reason, COUNT(*)::int AS count
            FROM subscription_refund_requests
            WHERE created_at >= %s
            GROUP BY abandonment_reason
            ORDER BY count DESC
            """,
            (cutoff,),
        )
        by_reason = [
            {"reason": r["abandonment_reason"], "count": int(r["count"])}
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT COALESCE(subscription_plan_name, '(sin plan)') AS plan,
                   COUNT(*)::int AS count,
                   COALESCE(SUM(paid_subscription_total_arg), 0)::float AS paid_total_arg
            FROM subscription_refund_requests
            WHERE created_at >= %s
            GROUP BY plan
            ORDER BY count DESC
            """,
            (cutoff,),
        )
        by_plan = [
            {
                "plan": r["plan"],
                "count": int(r["count"]),
                "paid_total_arg": float(r["paid_total_arg"] or 0),
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT date_trunc('month', created_at)::date AS month,
                   status,
                   COUNT(*)::int AS count
            FROM subscription_refund_requests
            WHERE created_at >= NOW() - INTERVAL '12 months'
            GROUP BY 1, 2
            ORDER BY 1
            """
        )
        monthly_rows = cur.fetchall()

        cur.execute(
            """
            SELECT kind,
                   COUNT(*)::int AS count,
                   COUNT(DISTINCT correlation_id)::int AS distinct_incidents
            FROM subscription_refund_telemetry
            WHERE created_at >= %s
            GROUP BY kind
            ORDER BY count DESC
            """,
            (cutoff,),
        )
        telemetry_by_kind = [
            {
                "kind": r["kind"],
                "count": int(r["count"]),
                "distinct_incidents": int(r["distinct_incidents"]),
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT t.dni, t.email, t.kind,
                   MAX(t.created_at) AS last_seen,
                   COUNT(*)::int AS attempts,
                   STRING_AGG(DISTINCT t.message, ' | ') AS messages
            FROM subscription_refund_telemetry t
            WHERE t.created_at >= %s
              AND t.dni IS NOT NULL
            GROUP BY t.dni, t.email, t.kind
            ORDER BY last_seen DESC
            LIMIT 25
            """,
            (cutoff,),
        )
        failed_users = [
            {
                "dni": r["dni"],
                "email": r["email"],
                "kind": r["kind"],
                "last_seen": _iso(r["last_seen"]),
                "attempts": int(r["attempts"]),
                "messages": (r["messages"] or "")[:300] or None,
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT id, dropshipper_user_id, dropshipper_dni,
                   dropshipper_name, dropshipper_fantasy_name,
                   subscription_plan_name, abandonment_reason, reason,
                   status, refund_amount_arg,
                   paid_subscription_total_arg, paid_subscription_count,
                   bank_name, bank_holder_name, bank_cbu,
                   created_at, transferred_at, integration_cancelled_at,
                   rejected_at, rejection_reason
            FROM subscription_refund_requests
            WHERE created_at >= %s
            ORDER BY created_at DESC
            LIMIT 30
            """,
            (cutoff,),
        )
        recent_requests = [
            {
                "id": int(r["id"]),
                "dropshipper_user_id": int(r["dropshipper_user_id"]),
                "dni": r["dropshipper_dni"],
                "name": r["dropshipper_name"],
                "fantasy_name": r["dropshipper_fantasy_name"],
                "plan": r["subscription_plan_name"],
                "abandonment_reason": r["abandonment_reason"],
                "reason": r["reason"],
                "status": r["status"],
                "refund_amount_arg": float(r["refund_amount_arg"]) if r["refund_amount_arg"] is not None else None,
                "paid_subscription_total_arg": float(r["paid_subscription_total_arg"]) if r["paid_subscription_total_arg"] is not None else None,
                "paid_subscription_count": int(r["paid_subscription_count"]) if r["paid_subscription_count"] is not None else None,
                "bank_name": r["bank_name"],
                "bank_holder_name": r["bank_holder_name"],
                "bank_cbu_last4": (r["bank_cbu"] or "")[-4:] if r["bank_cbu"] else None,
                "created_at": _iso(r["created_at"]),
                "transferred_at": _iso(r["transferred_at"]),
                "integration_cancelled_at": _iso(r["integration_cancelled_at"]),
                "rejected_at": _iso(r["rejected_at"]),
                "rejection_reason": r["rejection_reason"],
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT COALESCE(SUM(refund_amount_arg), 0)::float AS pending_refund,
                   COALESCE(SUM(paid_subscription_total_arg), 0)::float AS revenue_churned
            FROM subscription_refund_requests
            WHERE created_at >= %s
            """,
            (cutoff,),
        )
        money = cur.fetchone()
        pending_refund_arg = float(money["pending_refund"] or 0)
        revenue_churned_arg = float(money["revenue_churned"] or 0)

    monthly_series: dict[str, dict] = {}
    statuses = ("pending", "transferred", "integration_cancelled", "rejected")
    for r in monthly_rows:
        m = r["month"].isoformat()
        bucket = monthly_series.setdefault(
            m,
            {"month": m, "pending": 0, "transferred": 0, "integration_cancelled": 0, "rejected": 0, "total": 0},
        )
        st = r["status"]
        if st in statuses:
            bucket[st] = int(r["count"])
        bucket["total"] += int(r["count"])

    total_requests = sum(by_status.values())
    total_form_errors = sum(t["count"] for t in telemetry_by_kind)
    distinct_failed_users = sum(t["distinct_incidents"] for t in telemetry_by_kind)

    completion_rate = None
    if total_form_errors + total_requests > 0:
        completion_rate = round(total_requests / (total_form_errors + total_requests) * 100, 1)

    return {
        "period": period,
        "kpis": {
            "total_requests": total_requests,
            "pending": by_status.get("pending", 0),
            "transferred": by_status.get("transferred", 0),
            "integration_cancelled": by_status.get("integration_cancelled", 0),
            "rejected": by_status.get("rejected", 0),
            "total_form_errors": total_form_errors,
            "distinct_failed_users": distinct_failed_users,
            "form_completion_rate_pct": completion_rate,
            "pending_refund_arg": pending_refund_arg,
            "revenue_churned_arg": revenue_churned_arg,
        },
        "by_status": by_status,
        "by_reason": by_reason,
        "by_plan": by_plan,
        "monthly_series": sorted(monthly_series.values(), key=lambda x: x["month"]),
        "telemetry_by_kind": telemetry_by_kind,
        "failed_users": failed_users,
        "recent_requests": recent_requests,
    }
