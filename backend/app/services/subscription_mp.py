"""
Revenue de suscripcion cobrado por MercadoPago.

Desde ~2026-06-08 la suscripcion MELI de Unidrop se cobra por MercadoPago
(modelo MpSubscription + MpSubscriptionCharge), no por TaloPay
(PaymentIntentSubscription). Los dashboards de suscripcion solo sumaban el riel
viejo y subcontaban todo lo cobrado post-cutover. Estos helpers devuelven el
revenue del riel MercadoPago para sumarlo a los reportes.

Monto = MpSubscriptionCharge.amount (bruto) de cargos con status='approved'.
Es bruto (MP no expone el neto post-fee aca); convive con el paidAmount neto del
riel Talo. Fecha del cobro = COALESCE(chargedAt, createdAt). Plan = se filtra por
MpSubscription.subscriptionMeliId (mismo id que SubscriptionMeli).

Ver memory unidrop_subscription_billing_cutover.
"""
from __future__ import annotations

from app.services._utils import q, scalar, table_exists

_GRANS = {"day", "week", "month", "quarter", "year"}
_TS = 'COALESCE(c."chargedAt", c."createdAt")'
_FROM = (
    'public."MpSubscriptionCharge" c '
    'JOIN public."MpSubscription" s ON s.id = c."mpSubscriptionId"'
)


def available(eng) -> bool:
    return table_exists(eng, "public", "MpSubscriptionCharge")


def _plan(plan) -> str:
    if plan and str(plan) != "all":
        return f' AND s."subscriptionMeliId" = {int(plan)} '
    return ""


def revenue_window(eng, *, days: int, days_to: int | None = None, plan="all") -> float:
    """Suma de cobros approved en la ventana [now-days, now), o [now-days, now-days_to)."""
    if not available(eng):
        return 0.0
    upper = ""
    params: dict = {"days": days}
    if days_to is not None:
        upper = f" AND {_TS} < NOW() - make_interval(days => :days_to)"
        params["days_to"] = days_to
    return float(scalar(eng, f"""
        SELECT COALESCE(SUM(c.amount), 0)::float
        FROM {_FROM}
        WHERE c.status::text = 'approved'
          AND {_TS} >= NOW() - make_interval(days => :days){upper}
          {_plan(plan)}
    """, params) or 0)


def revenue_rows_by_bucket(eng, *, gran: str, days: int | None = None,
                           since_iso: str | None = None, plan="all") -> list[tuple]:
    """[(bucket_date, amount)] con date_trunc(gran) en hora AR. Misma forma que
    las series Talo -> se concatena y se suma por bucket sin merge extra."""
    if not available(eng):
        return []
    if gran not in _GRANS:
        gran = "day"
    bucket = f"date_trunc('{gran}', {_TS} AT TIME ZONE 'America/Argentina/Buenos_Aires')::date"
    where = "c.status::text = 'approved'"
    params: dict = {}
    if days is not None:
        where += f" AND {_TS} >= NOW() - make_interval(days => :days)"
        params["days"] = days
    if since_iso is not None:
        where += f" AND {_TS} >= :since"
        params["since"] = since_iso
    return [
        (r[0], float(r[1] or 0))
        for r in (q(eng, f"""
            SELECT {bucket} AS bucket, COALESCE(SUM(c.amount), 0)::float AS revenue
            FROM {_FROM}
            WHERE {where} {_plan(plan)}
            GROUP BY 1 ORDER BY 1
        """, params) or [])
    ]


def revenue_by_plan(eng, *, days: int, plan="all") -> dict[int, float]:
    """{subscriptionMeliId: monto approved en la ventana}."""
    if not available(eng):
        return {}
    rows = q(eng, f"""
        SELECT s."subscriptionMeliId" AS plan_id,
               COALESCE(SUM(c.amount), 0)::float AS revenue
        FROM {_FROM}
        WHERE c.status::text = 'approved'
          AND {_TS} >= NOW() - make_interval(days => :days)
          {_plan(plan)}
        GROUP BY 1
    """, {"days": days}) or []
    return {int(r[0]): float(r[1] or 0) for r in rows if r[0] is not None}


def revenue_by_user(eng, *, plan="all", user_ids: list[int] | None = None) -> dict[int, tuple]:
    """{userId: (total_approved, count)} historico. user_ids opcional para acotar."""
    if not available(eng):
        return {}
    where = "c.status::text = 'approved'"
    params: dict = {}
    if user_ids:
        where += ' AND s."userId" = ANY(:uids)'
        params["uids"] = list(user_ids)
    rows = q(eng, f"""
        SELECT s."userId" AS uid,
               COALESCE(SUM(c.amount), 0)::float AS total,
               COUNT(*)::int AS cnt
        FROM {_FROM}
        WHERE {where} {_plan(plan)}
        GROUP BY 1
    """, params) or []
    return {int(r[0]): (float(r[1] or 0), int(r[2] or 0)) for r in rows if r[0] is not None}
