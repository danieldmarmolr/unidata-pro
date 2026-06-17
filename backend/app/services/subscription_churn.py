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

from sqlalchemy import text

from app.db.engines import get_engine
from app.db.local_persistence import get_conn
from app.services import subscription_mp

log = logging.getLogger("unidata.subscription_churn")

_VALID_PERIODS = {"30d": 30, "90d": 90, "6m": 180, "1y": 365}

_GRAN_CONFIG: dict[str, dict] = {
    "day":     {"trunc": "day",     "interval": "1 day",    "lookback_days": 30},
    "week":    {"trunc": "week",    "interval": "1 week",   "lookback_days": 12 * 7},
    "month":   {"trunc": "month",   "interval": "1 month",  "lookback_days": 366},
    "quarter": {"trunc": "quarter", "interval": "3 months", "lookback_days": 2 * 366},
    "year":    {"trunc": "year",    "interval": "1 year",   "lookback_days": 5 * 366},
}


def _period_days(period: str) -> int:
    return _VALID_PERIODS.get(period, 30)


def _granularity_config(granularity: str) -> dict:
    return _GRAN_CONFIG.get(granularity, _GRAN_CONFIG["month"])


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def get_churn_overview(period: str = "30d", granularity: str = "month") -> dict:
    days = _period_days(period)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    gran = _granularity_config(granularity)
    gran_cutoff = datetime.now(timezone.utc) - timedelta(days=gran["lookback_days"])

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
            f"""
            SELECT date_trunc('{gran["trunc"]}', created_at)::date AS period_start,
                   (date_trunc('{gran["trunc"]}', created_at) + INTERVAL '{gran["interval"]}')::date AS period_end,
                   status,
                   COUNT(*)::int AS count,
                   COALESCE(SUM(paid_subscription_total_arg), 0)::float AS paid_total_arg
            FROM subscription_refund_requests
            WHERE created_at >= %s
            GROUP BY 1, 2, 3
            ORDER BY 1
            """,
            (gran_cutoff,),
        )
        evolution_rows = cur.fetchall()

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
            SELECT COALESCE(SUM(COALESCE(paid_subscription_total_arg, refund_amount_arg)), 0)::float AS pending_refund,
                   COALESCE(SUM(paid_subscription_total_arg), 0)::float AS revenue_churned
            FROM subscription_refund_requests
            WHERE created_at >= %s
            """,
            (cutoff,),
        )
        money = cur.fetchone()
        pending_refund_arg = float(money["pending_refund"] or 0)
        revenue_churned_arg = float(money["revenue_churned"] or 0)

    evolution_series: dict[str, dict] = {}
    statuses = ("pending", "transferred", "integration_cancelled", "rejected")
    for r in evolution_rows:
        ps = r["period_start"].isoformat()
        pe = r["period_end"].isoformat()
        bucket = evolution_series.setdefault(
            ps,
            {
                "period_start": ps, "period_end": pe,
                "pending": 0, "transferred": 0, "integration_cancelled": 0, "rejected": 0,
                "total": 0, "paid_total_arg": 0.0,
            },
        )
        st = r["status"]
        cnt = int(r["count"])
        if st in statuses:
            bucket[st] = cnt
        bucket["total"] += cnt
        bucket["paid_total_arg"] += float(r["paid_total_arg"] or 0)

    evolution_list = sorted(evolution_series.values(), key=lambda x: x["period_start"])
    totals = [b["total"] for b in evolution_list]
    peak = max(totals) if totals else 0
    peak_bucket = next((b for b in evolution_list if b["total"] == peak), None) if peak > 0 else None
    avg_per_bucket = round(sum(totals) / len(totals), 1) if totals else 0
    trend = "flat"
    if len(totals) >= 4:
        half = len(totals) // 2
        first_half_avg = sum(totals[:half]) / half if half else 0
        second_half_avg = sum(totals[half:]) / (len(totals) - half)
        if second_half_avg > first_half_avg * 1.2:
            trend = "up"
        elif second_half_avg < first_half_avg * 0.8:
            trend = "down"

    total_requests = sum(by_status.values())
    total_form_errors = sum(t["count"] for t in telemetry_by_kind)
    distinct_failed_users = sum(t["distinct_incidents"] for t in telemetry_by_kind)

    completion_rate = None
    if total_form_errors + total_requests > 0:
        completion_rate = round(total_requests / (total_form_errors + total_requests) * 100, 1)

    dropshipper_ids = sorted({int(r["dropshipper_user_id"]) for r in recent_requests if r.get("dropshipper_user_id")})
    real_revenue_by_user, real_total = _real_revenue_from_talo(dropshipper_ids)
    for r in recent_requests:
        uid = r.get("dropshipper_user_id")
        r["paid_subscription_total_real_arg"] = real_revenue_by_user.get(int(uid)) if uid else None

    return {
        "period": period,
        "granularity": granularity,
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
            "revenue_churned_real_arg": real_total,
        },
        "by_status": by_status,
        "by_reason": by_reason,
        "by_plan": by_plan,
        "evolution": {
            "series": evolution_list,
            "stats": {
                "peak": peak,
                "peak_period_start": peak_bucket["period_start"] if peak_bucket else None,
                "peak_period_end": peak_bucket["period_end"] if peak_bucket else None,
                "average": avg_per_bucket,
                "trend": trend,
                "bucket_count": len(evolution_list),
            },
        },
        "telemetry_by_kind": telemetry_by_kind,
        "failed_users": failed_users,
        "recent_requests": recent_requests,
    }


def _real_revenue_from_talo(dropshipper_ids: list[int]) -> tuple[dict[int, float], float]:
    """Revenue REAL pagado por los dropshippers que pidieron baja, sumando los
    dos rieles de cobro: TaloPay (PaymentIntentSubscription PROCESSED) +
    MercadoPago (MpSubscriptionCharge approved, modelo vigente desde 2026-06).
    Devuelve (mapa user_id -> total, sumatoria total).
    """
    if not dropshipper_ids:
        return {}, 0.0
    try:
        eng = get_engine("unidrop")
        with eng.connect() as cx:
            rows = cx.execute(
                text("""
                    SELECT "userId"::bigint AS user_id,
                           COALESCE(SUM("paidAmount"), 0)::float AS total
                    FROM public."PaymentIntentSubscription"
                    WHERE status::text = 'PROCESSED'
                      AND "userId" = ANY(:ids)
                    GROUP BY "userId"
                """),
                {"ids": dropshipper_ids},
            ).mappings().all()
    except Exception as e:
        log.warning("no se pudo cruzar PaymentIntentSubscription: %s", e)
        return {}, 0.0

    by_user = {int(r["user_id"]): float(r["total"] or 0) for r in rows}
    for uid, (mp_total, _cnt) in subscription_mp.revenue_by_user(
        eng, user_ids=dropshipper_ids
    ).items():
        by_user[uid] = by_user.get(uid, 0.0) + mp_total
    total = sum(by_user.values())
    return by_user, total


def get_drill_down(period_start: str, period_end: str) -> dict:
    """Detalle de las solicitudes de un periodo especifico (drill-down desde el
    chart). period_start y period_end son ISO dates (YYYY-MM-DD).
    period_end es exclusivo (< period_end)."""
    with get_conn() as c, c.cursor() as cur:
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
            WHERE created_at >= %s::date
              AND created_at < %s::date
            ORDER BY created_at DESC
            """,
            (period_start, period_end),
        )
        rows = cur.fetchall()

        requests = [
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
            for r in rows
        ]

        by_status: dict[str, int] = {}
        by_reason: dict[str, int] = {}
        total_paid = 0.0
        total_refund = 0.0
        for r in requests:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
            by_reason[r["abandonment_reason"]] = by_reason.get(r["abandonment_reason"], 0) + 1
            total_paid += r["paid_subscription_total_arg"] or 0
            # Exposicion real de reembolso = lo pagado registrado (techo que se transfiere),
            # con fallback al monto del form para solicitudes viejas sin snapshot.
            total_refund += r["paid_subscription_total_arg"] or r["refund_amount_arg"] or 0

    return {
        "period_start": period_start,
        "period_end": period_end,
        "total_requests": len(requests),
        "revenue_churned_arg": total_paid,
        "pending_refund_arg": total_refund,
        "by_status": by_status,
        "by_reason": sorted(
            [{"reason": k, "count": v} for k, v in by_reason.items()],
            key=lambda x: -x["count"],
        ),
        "requests": requests,
    }
