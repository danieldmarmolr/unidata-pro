"""
Meta Ads (Facebook Marketing API) — sync + queries.

Sync flow:
1. Fetch /me/adaccounts → upsert meta_ad_accounts
2. Para cada ad account:
   2a. GET /act_X/campaigns?fields=...&limit=100 (paginado)
   2b. GET /act_X/adsets?...
   2c. GET /act_X/ads?...
   2d. GET /act_X/insights?level=ad&time_range={...}&fields=...&time_increment=1
       (cada insight = 1 día x 1 ad)

API: raw HTTP via httpx en vez de facebook-business SDK (más liviano y
explícito). Auth: ?access_token={token} query param.

Env vars:
- META_ACCESS_TOKEN          : System User token (long-lived 60d o nunca-expira)
- META_AD_ACCOUNT_IDS        : csv "act_111,act_222" (override fetch /me/adaccounts)
- META_ACCOUNT_UNIT_MAP      : csv "act_111:unidrop,act_222:unistore" (unit per account)
- META_API_VERSION           : default "v21.0"
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import threading
from typing import Any

import httpx

from app.db import meta_ads_db
from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.meta_ads")

META_API_VERSION = os.environ.get("META_API_VERSION", "v21.0")
META_API_BASE = f"https://graph.facebook.com/{META_API_VERSION}"


def _get_token() -> str:
    token = (os.environ.get("META_ACCESS_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN no esta seteada en el environment")
    return token


def _unit_map() -> dict[str, str]:
    raw = os.environ.get("META_ACCOUNT_UNIT_MAP", "")
    out: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" in pair:
            acc_id, unit = pair.split(":", 1)
            out[acc_id.strip()] = unit.strip().lower()
    return out


def _account_ids_override() -> list[str]:
    raw = os.environ.get("META_AD_ACCOUNT_IDS", "")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _http_get(path: str, params: dict | None = None) -> dict:
    p = dict(params or {})
    p["access_token"] = _get_token()
    url = f"{META_API_BASE}{path}"
    with httpx.Client(timeout=60.0) as client:
        r = client.get(url, params=p)
    if r.status_code >= 400:
        raise RuntimeError(f"Meta API {r.status_code} on {path}: {r.text[:300]}")
    return r.json()


def _http_get_paged(path: str, params: dict | None = None, max_pages: int = 50) -> list[dict]:
    """GET con manejo de paginación cursor-based."""
    out: list[dict] = []
    p = dict(params or {})
    url = f"{META_API_BASE}{path}"
    p["access_token"] = _get_token()
    pages = 0
    next_url: str | None = None
    with httpx.Client(timeout=60.0) as client:
        while pages < max_pages:
            r = client.get(next_url, params=p if pages == 0 else None) if next_url else client.get(url, params=p)
            if r.status_code >= 400:
                raise RuntimeError(f"Meta API {r.status_code}: {r.text[:300]}")
            data = r.json()
            out.extend(data.get("data") or [])
            pages += 1
            next_url = (data.get("paging") or {}).get("next")
            if not next_url:
                break
            # When following 'next' the token is already embedded
            p = None
    log.info("Meta paged %s → %d items in %d pages", path, len(out), pages)
    return out


# ─── Discovery / accounts ─────────────────────────────────────────────────────


def _fetch_accounts() -> list[dict]:
    """Lista cuentas accesibles por el token. Override por env si está seteado."""
    override = _account_ids_override()
    unit_map = _unit_map()
    if override:
        # Fetch detail de cada cuenta especificada
        out = []
        for acc_id in override:
            try:
                detail = _http_get(f"/{acc_id}",
                                   params={"fields": "id,name,currency,timezone_name,account_status"})
                detail["unit"] = unit_map.get(acc_id, "unidrop")
                out.append(detail)
            except Exception as e:
                log.warning("Fetch account %s fail: %s", acc_id, e)
        return out
    # Fallback: /me/adaccounts
    accounts = _http_get_paged("/me/adaccounts",
                               params={"fields": "id,name,currency,timezone_name,account_status",
                                       "limit": 50})
    for a in accounts:
        a["unit"] = unit_map.get(a["id"], "unidrop")
    return accounts


# ─── Sync campaigns / adsets / ads ────────────────────────────────────────────


def _sync_campaigns(account_id: str) -> int:
    items = _http_get_paged(
        f"/{account_id}/campaigns",
        params={
            "fields": "id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time",
            "limit": 200,
        },
    )
    for it in items:
        meta_ads_db.upsert_campaign({
            "id": it["id"],
            "ad_account_id": account_id,
            "name": it.get("name", ""),
            "objective": it.get("objective"),
            "status": it.get("status"),
            "effective_status": it.get("effective_status"),
            "daily_budget": _to_money(it.get("daily_budget")),
            "lifetime_budget": _to_money(it.get("lifetime_budget")),
            "budget_remaining": _to_money(it.get("budget_remaining")),
            "start_time": it.get("start_time"),
            "stop_time": it.get("stop_time"),
            "created_time": it.get("created_time"),
            "updated_time": it.get("updated_time"),
        })
    return len(items)


def _sync_adsets(account_id: str) -> int:
    items = _http_get_paged(
        f"/{account_id}/adsets",
        params={
            "fields": "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_amount,optimization_goal,billing_event,start_time,end_time,created_time,updated_time,targeting",
            "limit": 200,
        },
    )
    for it in items:
        meta_ads_db.upsert_adset({
            "id": it["id"],
            "campaign_id": it.get("campaign_id"),
            "ad_account_id": account_id,
            "name": it.get("name", ""),
            "status": it.get("status"),
            "effective_status": it.get("effective_status"),
            "daily_budget": _to_money(it.get("daily_budget")),
            "lifetime_budget": _to_money(it.get("lifetime_budget")),
            "bid_amount": _to_money(it.get("bid_amount")),
            "optimization_goal": it.get("optimization_goal"),
            "billing_event": it.get("billing_event"),
            "targeting_summary": _summarize_targeting(it.get("targeting")),
            "start_time": it.get("start_time"),
            "end_time": it.get("end_time"),
            "created_time": it.get("created_time"),
            "updated_time": it.get("updated_time"),
        })
    return len(items)


def _sync_ads(account_id: str) -> int:
    items = _http_get_paged(
        f"/{account_id}/ads",
        params={
            "fields": "id,name,adset_id,campaign_id,status,effective_status,creative{id,title,body,thumbnail_url},preview_shareable_link,created_time,updated_time",
            "limit": 200,
        },
    )
    for it in items:
        creative = it.get("creative") or {}
        creative_summary = " · ".join(filter(None, [creative.get("title"), creative.get("body")]))[:500]
        meta_ads_db.upsert_ad({
            "id": it["id"],
            "adset_id": it.get("adset_id"),
            "campaign_id": it.get("campaign_id"),
            "ad_account_id": account_id,
            "name": it.get("name", ""),
            "status": it.get("status"),
            "effective_status": it.get("effective_status"),
            "creative_id": creative.get("id"),
            "creative_summary": creative_summary or None,
            "preview_url": it.get("preview_shareable_link"),
            "created_time": it.get("created_time"),
            "updated_time": it.get("updated_time"),
        })
    return len(items)


# ─── Sync insights ────────────────────────────────────────────────────────────


def _sync_insights(account_id: str, since: str, until: str) -> int:
    """Trae insights diarias por ad. since/until en formato 'YYYY-MM-DD'."""
    fields = ",".join([
        "campaign_id", "adset_id", "ad_id",
        "spend", "impressions", "reach", "clicks", "unique_clicks", "inline_link_clicks",
        "cpm", "cpc", "ctr", "frequency", "actions", "action_values",
    ])
    items = _http_get_paged(
        f"/{account_id}/insights",
        params={
            "level": "ad",
            "fields": fields,
            "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "time_increment": "1",
            "limit": 500,
        },
        max_pages=200,
    )
    for it in items:
        meta_ads_db.upsert_insight({
            "ad_account_id": account_id,
            "campaign_id": it.get("campaign_id"),
            "adset_id": it.get("adset_id"),
            "ad_id": it.get("ad_id"),
            "date_start": it.get("date_start"),
            "spend": _f(it.get("spend")),
            "impressions": _i(it.get("impressions")),
            "reach": _i(it.get("reach")),
            "clicks": _i(it.get("clicks")),
            "unique_clicks": _i(it.get("unique_clicks")),
            "inline_link_clicks": _i(it.get("inline_link_clicks")),
            "cpm": _f(it.get("cpm")),
            "cpc": _f(it.get("cpc")),
            "ctr": _f(it.get("ctr")),
            "frequency": _f(it.get("frequency")),
            "actions": it.get("actions"),
            "action_values": it.get("action_values"),
        })
    return len(items)


# ─── Public sync API ──────────────────────────────────────────────────────────


# Tipos de breakdown soportados (subset común que Meta acepta solo).
# Algunos breakdowns son mutuamente excluyentes en una sola request, por eso
# sincronizamos uno por uno.
SUPPORTED_BREAKDOWNS = [
    "age",
    "gender",
    "publisher_platform",                 # facebook / instagram / audience_network / messenger
    "platform_position",                  # feed / story / reels / etc
    "device_platform",                    # mobile / desktop
    "country",
    "region",                              # provincia (para AR)
    "hourly_stats_aggregated_by_advertiser_time_zone",
]


def _sync_one_breakdown(account_id: str, breakdown: str, since: str, until: str) -> int:
    fields = "spend,impressions,reach,clicks,actions"
    items = _http_get_paged(
        f"/{account_id}/insights",
        params={
            "level": "account",
            "fields": fields,
            "breakdowns": breakdown,
            "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "time_increment": "1",
            "limit": 500,
        },
        max_pages=200,
    )
    for it in items:
        key = it.get(breakdown)
        if key is None and breakdown == "hourly_stats_aggregated_by_advertiser_time_zone":
            # Field puede llegar como "hourly_stats_aggregated_by_advertiser_time_zone"
            key = it.get("hourly_stats_aggregated_by_advertiser_time_zone")
        meta_ads_db.upsert_breakdown({
            "ad_account_id": account_id,
            "breakdown_type": breakdown,
            "breakdown_key": str(key) if key is not None else "",
            "breakdown_key2": None,
            "date_start": it.get("date_start"),
            "spend": _f(it.get("spend")) or 0.0,
            "impressions": _i(it.get("impressions")) or 0,
            "reach": _i(it.get("reach")) or 0,
            "clicks": _i(it.get("clicks")) or 0,
            "actions": it.get("actions"),
        })
    return len(items)


def sync_breakdowns(historical_days: int = 30, types: list[str] | None = None) -> dict:
    """Sync de breakdowns. Por default ultimos 30d porque el volumen crece x N segmentos."""
    meta_ads_db.init()
    bd_types = types or SUPPORTED_BREAKDOWNS
    accounts = meta_ads_db.list_accounts()
    if not accounts:
        accounts = _fetch_accounts()
        for a in accounts:
            meta_ads_db.upsert_account(
                id=a["id"], name=a.get("name", ""), currency=a.get("currency"),
                unit=a.get("unit", "unidrop"), timezone_name=a.get("timezone_name"),
                account_status=a.get("account_status"),
            )
    today = dt.date.today()
    since = (today - dt.timedelta(days=int(historical_days))).isoformat()
    until = today.isoformat()
    result: dict[str, Any] = {"accounts": [], "since": since, "until": until, "breakdowns": bd_types}
    for acc in accounts:
        acc_id = acc["id"]
        acc_res: dict[str, Any] = {"id": acc_id, "name": acc.get("name"), "rows": {}, "error": None}
        for bd in bd_types:
            try:
                n = _sync_one_breakdown(acc_id, bd, since, until)
                acc_res["rows"][bd] = n
            except Exception as e:
                err = str(e)[:400]
                log.warning("Sync breakdown %s/%s fail: %s", acc_id, bd, err)
                acc_res["rows"][bd] = -1
                acc_res["error"] = err
        result["accounts"].append(acc_res)
    return result


def sync_all(historical_days: int = 365) -> dict:
    """Sync completo. Llamable desde endpoint admin o cron."""
    meta_ads_db.init()
    accounts = _fetch_accounts()
    if not accounts:
        raise RuntimeError("No se obtuvieron cuentas. Revisar token + permisos.")

    today = dt.date.today()
    since = (today - dt.timedelta(days=int(historical_days))).isoformat()
    until = today.isoformat()

    result = {"accounts": [], "since": since, "until": until}
    for acc in accounts:
        acc_id = acc["id"]
        unit = acc.get("unit", "unidrop")
        log.info("Sync Meta account %s (%s)", acc_id, unit)
        meta_ads_db.upsert_account(
            id=acc_id, name=acc.get("name", ""), currency=acc.get("currency"),
            unit=unit, timezone_name=acc.get("timezone_name"),
            account_status=acc.get("account_status"),
        )
        acc_summary = {"id": acc_id, "name": acc.get("name"), "unit": unit,
                       "campaigns": 0, "adsets": 0, "ads": 0, "insights": 0, "error": None}
        try:
            acc_summary["campaigns"] = _sync_campaigns(acc_id)
            acc_summary["adsets"] = _sync_adsets(acc_id)
            acc_summary["ads"] = _sync_ads(acc_id)
            acc_summary["insights"] = _sync_insights(acc_id, since, until)
            meta_ads_db.mark_account_synced(acc_id, None)
        except Exception as e:
            err = str(e)[:500]
            log.warning("Sync %s fail: %s", acc_id, err)
            acc_summary["error"] = err
            meta_ads_db.mark_account_synced(acc_id, err)
        result["accounts"].append(acc_summary)
    return result


# ─── Queries para endpoints ───────────────────────────────────────────────────


def overview(period: str = "30d", unit: str | None = None) -> dict:
    """KPIs agregados + daily spend series."""
    days = _period_days(period)
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = [days]
    if unit:
        params.append(unit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT
                COALESCE(SUM(i.spend), 0)::float                          AS spend,
                COALESCE(SUM(i.impressions), 0)::bigint                   AS impressions,
                COALESCE(SUM(i.clicks), 0)::bigint                        AS clicks,
                COALESCE(SUM(i.reach), 0)::bigint                         AS reach,
                COUNT(DISTINCT i.campaign_id) FILTER (WHERE i.spend > 0)::int AS active_campaigns,
                CASE WHEN SUM(i.impressions) > 0
                     THEN SUM(i.spend) / SUM(i.impressions) * 1000
                     ELSE 0 END::float                                    AS cpm,
                CASE WHEN SUM(i.clicks) > 0
                     THEN SUM(i.spend) / SUM(i.clicks)
                     ELSE 0 END::float                                    AS cpc,
                CASE WHEN SUM(i.impressions) > 0
                     THEN SUM(i.clicks)::float / SUM(i.impressions) * 100
                     ELSE 0 END::float                                    AS ctr
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE i.date_start >= CURRENT_DATE - make_interval(days => %s)
            {where_unit}
        """, params)
        kpi_row = cur.fetchone()
        cur.execute(f"""
            SELECT i.date_start::text AS d,
                   COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE i.date_start >= CURRENT_DATE - make_interval(days => %s)
            {where_unit}
            GROUP BY 1 ORDER BY 1
        """, params)
        daily = [dict(r) for r in cur.fetchall()]
        cur.execute(f"""
            SELECT a.id, a.name, a.currency, a.unit, a.last_synced_at::text AS last_synced_at,
                   COALESCE(SUM(i.spend), 0)::float AS spend
            FROM meta_ad_accounts a
            LEFT JOIN meta_insights_daily i ON i.ad_account_id = a.id
                AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            WHERE 1=1 {('AND a.unit = %s' if unit else '')}
            GROUP BY a.id, a.name, a.currency, a.unit, a.last_synced_at
            ORDER BY spend DESC NULLS LAST
        """, params)
        accounts = [dict(r) for r in cur.fetchall()]

    return {
        "kpi": dict(kpi_row) if kpi_row else {},
        "daily": daily,
        "accounts": accounts,
        "period": period,
        "unit": unit,
    }


def campaigns(period: str = "30d", unit: str | None = None, limit: int = 100) -> list[dict]:
    days = _period_days(period)
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = [days]
    if unit:
        params.append(unit)
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT c.id, c.name, c.objective, c.status, c.effective_status,
                   c.daily_budget::float, c.lifetime_budget::float,
                   a.unit, a.name AS account_name, a.currency,
                   COALESCE(SUM(i.spend), 0)::float          AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint   AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint        AS clicks,
                   CASE WHEN SUM(i.impressions) > 0
                        THEN SUM(i.spend) / SUM(i.impressions) * 1000
                        ELSE 0 END::float                    AS cpm,
                   CASE WHEN SUM(i.clicks) > 0
                        THEN SUM(i.spend) / SUM(i.clicks)
                        ELSE 0 END::float                    AS cpc,
                   CASE WHEN SUM(i.impressions) > 0
                        THEN SUM(i.clicks)::float / SUM(i.impressions) * 100
                        ELSE 0 END::float                    AS ctr
            FROM meta_campaigns c
            INNER JOIN meta_ad_accounts a ON a.id = c.ad_account_id
            LEFT JOIN meta_insights_daily i ON i.campaign_id = c.id
                AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            WHERE 1=1 {where_unit}
            GROUP BY c.id, c.name, c.objective, c.status, c.effective_status,
                     c.daily_budget, c.lifetime_budget, a.unit, a.name, a.currency
            ORDER BY spend DESC NULLS LAST
            LIMIT %s
        """, params)
        return [dict(r) for r in cur.fetchall()]


def unidrop_impact(period: str = "30d") -> dict:
    """Cross-area: cruza spend Meta Ads con metricas Unidrop reales.

    Pensado para responder: "¿cuanto cuesta adquirir un dropshipper via Meta?
    ¿cual fue el ROAS? ¿que campañas trajeron mas signups?"

    Definiciones:
    - CAC dropshipper = spend / nuevos User creados en el periodo
    - CAC suscripcion = spend / nuevos subscription_status='active' en el periodo
    - ROAS = revenue PaymentIntent.paidAmount / spend (gross, no neto)
    - Daily overlay = serie diaria de spend + signups + revenue PI
    """
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)
    meta_ads_db.init()

    # 1) Spend total + daily Meta (unit=unidrop)
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE a.unit = 'unidrop'
              AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
        """, (days,))
        meta_tot = cur.fetchone()
        cur.execute("""
            SELECT i.date_start::text AS d,
                   COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE a.unit = 'unidrop'
              AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            GROUP BY 1 ORDER BY 1
        """, (days,))
        meta_daily = [dict(r) for r in cur.fetchall()]

    # 2) Unidrop datos (signups, suscripciones, revenue) — engine unidrop_api
    eng_drop = get_engine("unidrop")
    sign_rows = q(eng_drop, """
        SELECT COUNT(*)::int AS signups
        FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0,)]
    new_signups = int(sign_rows[0][0] or 0) if sign_rows else 0

    sub_rows = q(eng_drop, """
        SELECT COUNT(*)::int AS new_subs
        FROM public."User"
        WHERE "start_date_subscription" IS NOT NULL
          AND "start_date_subscription" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0,)]
    new_subs = int(sub_rows[0][0] or 0) if sub_rows else 0

    rev_rows = q(eng_drop, """
        SELECT COALESCE(SUM(pi."paidAmount"), 0)::float AS rev,
               COUNT(*)::int AS pi_count
        FROM public."PaymentIntent" pi
        WHERE pi.status = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0.0, 0)]
    revenue = float(rev_rows[0][0] or 0) if rev_rows else 0.0
    pi_count = int(rev_rows[0][1] or 0) if rev_rows else 0

    # 3) Daily signups + revenue Unidrop
    daily_signups = q(eng_drop, """
        SELECT date_trunc('day', "createdAt")::date::text AS d,
               COUNT(*)::int AS n
        FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :d)
        GROUP BY 1 ORDER BY 1
    """, {"d": days}) or []
    daily_revenue = q(eng_drop, """
        SELECT date_trunc('day', pi."createdAt")::date::text AS d,
               COALESCE(SUM(pi."paidAmount"), 0)::float AS rev
        FROM public."PaymentIntent" pi
        WHERE pi.status = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
        GROUP BY 1 ORDER BY 1
    """, {"d": days}) or []

    # Merge daily series
    daily_map: dict[str, dict] = {}
    for r in meta_daily:
        d = r["d"]
        daily_map[d] = {"d": d, "spend": float(r["spend"] or 0),
                        "clicks": int(r["clicks"] or 0),
                        "signups": 0, "revenue": 0.0}
    for r in daily_signups:
        d = r[0]
        if d not in daily_map:
            daily_map[d] = {"d": d, "spend": 0.0, "clicks": 0, "signups": 0, "revenue": 0.0}
        daily_map[d]["signups"] = int(r[1] or 0)
    for r in daily_revenue:
        d = r[0]
        if d not in daily_map:
            daily_map[d] = {"d": d, "spend": 0.0, "clicks": 0, "signups": 0, "revenue": 0.0}
        daily_map[d]["revenue"] = float(r[1] or 0)
    daily = sorted(daily_map.values(), key=lambda x: x["d"])

    # get_conn usa RealDictCursor → meta_tot es dict
    spend = float((meta_tot or {}).get("spend") or 0)
    impressions = int((meta_tot or {}).get("impressions") or 0)
    clicks = int((meta_tot or {}).get("clicks") or 0)

    cac_dropshipper = (spend / new_signups) if new_signups > 0 else 0.0
    cac_subscripcion = (spend / new_subs) if new_subs > 0 else 0.0
    roas = (revenue / spend) if spend > 0 else 0.0
    cost_per_click = (spend / clicks) if clicks > 0 else 0.0

    # 4) Funnel: impressions → clicks → signups → suscripciones
    funnel = [
        {"step": "Impresiones", "value": impressions, "rate_from_prev": None},
        {"step": "Clicks", "value": clicks,
         "rate_from_prev": (clicks / impressions * 100) if impressions > 0 else 0},
        {"step": "Nuevos signups", "value": new_signups,
         "rate_from_prev": (new_signups / clicks * 100) if clicks > 0 else 0},
        {"step": "Suscripciones nuevas", "value": new_subs,
         "rate_from_prev": (new_subs / new_signups * 100) if new_signups > 0 else 0},
    ]

    return {
        "period": period,
        "kpi": {
            "spend": spend,
            "impressions": impressions,
            "clicks": clicks,
            "new_signups": new_signups,
            "new_subscriptions": new_subs,
            "revenue_pi": revenue,
            "pi_count": pi_count,
            "cac_dropshipper": cac_dropshipper,
            "cac_subscripcion": cac_subscripcion,
            "roas": roas,
            "cpc": cost_per_click,
        },
        "daily": daily,
        "funnel": funnel,
    }


def signups_per_day(period: str = "30d") -> list[dict]:
    """Per-day list of new Unidrop users with full Unidrop profile (ML/TN channels, orders, GMV, revenue)."""
    from app.db.engines import get_engine
    from app.services._utils import q
    from collections import defaultdict

    days = _period_days(period)
    eng = get_engine("unidrop")
    rows = q(eng, """
        WITH ml_stats AS (
            SELECT mla.id AS mla_id,
                   mla.nickname AS nickname_meli,
                   COUNT(oml.id) FILTER (WHERE oml."status" = 'paid')::int AS ml_orders,
                   COALESCE(SUM(oml."totalAmount") FILTER (WHERE oml."status" = 'paid'), 0)::float AS ml_gmv
            FROM mercado_libre_dev."MercadoLibreUserAccount" mla
            LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml
                ON mla."mlUserId"::text = oml."sellerId"::text
            GROUP BY mla.id, mla.nickname
        ),
        tn_cred AS (
            SELECT u2.id AS user_id
            FROM public."User" u2
            INNER JOIN public."TiendaNubeCredential" t ON t.store_id = u2.store_id
            WHERE u2.store_id IS NOT NULL
        ),
        tn_stats AS (
            SELECT user_id,
                   COUNT(*) FILTER (WHERE payment_status::text = 'paid')::int AS tn_orders,
                   COALESCE(SUM(total) FILTER (WHERE payment_status::text = 'paid'), 0)::float AS tn_gmv
            FROM public.tienda_nube_orders
            WHERE user_id IS NOT NULL
            GROUP BY user_id
        ),
        revenue_all AS (
            SELECT cpa."userId" AS user_id,
                   COALESCE(SUM(pi."paidAmount"), 0)::float AS revenue_total
            FROM public."CustomerPaymentAccount" cpa
            INNER JOIN public."PaymentIntent" pi ON pi."customerAccountId" = cpa.id
            WHERE pi.status = 'PROCESSED'
            GROUP BY cpa."userId"
        )
        SELECT
            u."createdAt"::date::text AS d,
            u.id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS nombre,
            u.email,
            COALESCE(u.dni, '') AS dni,
            COALESCE(u.personeria::text, '') AS personeria,
            CASE WHEN u.end_date_subscription IS NOT NULL AND u.end_date_subscription > NOW()
                 THEN TRUE ELSE FALSE END AS suscripto,
            u.end_date_subscription::text AS vence,
            COALESCE(sm.name, '') AS plan_name,
            COALESCE(ml.nickname_meli, '') AS nickname_meli,
            (u."mercadoLibreAccountId" IS NOT NULL) AS tiene_ml,
            COALESCE(ml.ml_orders, 0) AS ml_orders,
            COALESCE(ml.ml_gmv, 0) AS ml_gmv,
            (tnc.user_id IS NOT NULL) AS tiene_tn,
            COALESCE(tns.tn_orders, 0) AS tn_orders,
            COALESCE(tns.tn_gmv, 0) AS tn_gmv,
            COALESCE(rev.revenue_total, 0) AS revenue_total
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        LEFT JOIN ml_stats ml ON ml.mla_id = u."mercadoLibreAccountId"
        LEFT JOIN tn_cred tnc ON tnc.user_id = u.id
        LEFT JOIN tn_stats tns ON tns.user_id = u.id
        LEFT JOIN revenue_all rev ON rev.user_id = u.id
        WHERE u."createdAt" >= NOW() - make_interval(days => :d)
        ORDER BY u."createdAt"::date ASC, COALESCE(rev.revenue_total, 0) DESC NULLS LAST
    """, {"d": days}) or []

    by_day: dict[str, list] = defaultdict(list)
    for r in rows:
        by_day[r[0]].append({
            "id": r[1], "nombre": r[2] or "",
            "email": r[3] or "", "dni": r[4] or "",
            "personeria": r[5] or "",
            "suscripto": bool(r[6]), "vence": r[7],
            "plan_name": r[8] or "",
            "nickname_meli": r[9] or "",
            "tiene_ml": bool(r[10]),
            "ml_orders": int(r[11] or 0),
            "ml_gmv": float(r[12] or 0),
            "tiene_tn": bool(r[13]),
            "tn_orders": int(r[14] or 0),
            "tn_gmv": float(r[15] or 0),
            "revenue_total": float(r[16] or 0),
        })
    return [{"d": d, "count": len(u), "users": u} for d, u in sorted(by_day.items())]


def campaign_daily_spend(campaign_id: str, period: str = "30d") -> list[dict]:
    """Daily spend/clicks/impressions for a specific campaign."""
    days = _period_days(period)
    meta_ads_db.init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT i.date_start::text AS d,
                   COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions
            FROM meta_insights_daily i
            WHERE i.campaign_id = %s
              AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            GROUP BY 1 ORDER BY 1
        """, (campaign_id, days))
        return [dict(r) for r in cur.fetchall()]


def adsets(campaign_id: str | None = None, period: str = "30d", limit: int = 100) -> list[dict]:
    days = _period_days(period)
    meta_ads_db.init()
    where_cmp = "AND s.campaign_id = %s" if campaign_id else ""
    params: list = [days]
    if campaign_id:
        params.append(campaign_id)
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT s.id, s.name, s.campaign_id, s.status, s.effective_status,
                   s.daily_budget::float, s.lifetime_budget::float,
                   s.optimization_goal, s.billing_event, s.targeting_summary,
                   COALESCE(SUM(i.spend), 0)::float        AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint      AS clicks
            FROM meta_adsets s
            LEFT JOIN meta_insights_daily i ON i.adset_id = s.id
                AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            WHERE 1=1 {where_cmp}
            GROUP BY s.id, s.name, s.campaign_id, s.status, s.effective_status,
                     s.daily_budget, s.lifetime_budget, s.optimization_goal,
                     s.billing_event, s.targeting_summary
            ORDER BY spend DESC NULLS LAST
            LIMIT %s
        """, params)
        return [dict(r) for r in cur.fetchall()]


def ads(adset_id: str | None = None, period: str = "30d", limit: int = 100) -> list[dict]:
    days = _period_days(period)
    meta_ads_db.init()
    where_ads = "AND ad.adset_id = %s" if adset_id else ""
    params: list = [days]
    if adset_id:
        params.append(adset_id)
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT ad.id, ad.name, ad.adset_id, ad.campaign_id, ad.status, ad.effective_status,
                   ad.creative_summary, ad.preview_url,
                   COALESCE(SUM(i.spend), 0)::float        AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint      AS clicks
            FROM meta_ads ad
            LEFT JOIN meta_insights_daily i ON i.ad_id = ad.id
                AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            WHERE 1=1 {where_ads}
            GROUP BY ad.id, ad.name, ad.adset_id, ad.campaign_id, ad.status,
                     ad.effective_status, ad.creative_summary, ad.preview_url
            ORDER BY spend DESC NULLS LAST
            LIMIT %s
        """, params)
        return [dict(r) for r in cur.fetchall()]


# ─── Breakdowns queries ───────────────────────────────────────────────────────


def breakdown(period: str = "30d", unit: str | None = None, breakdown_type: str = "age",
              limit: int = 50) -> dict:
    """Devuelve breakdown agregado (no daily). El default age aplica al subset Unidrop."""
    days = _period_days(period)
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = [breakdown_type, days]
    if unit:
        params.append(unit)
    params.append(limit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT b.breakdown_key AS key,
                   SUM(b.spend)::float       AS spend,
                   SUM(b.impressions)::bigint AS impressions,
                   SUM(b.clicks)::bigint     AS clicks,
                   CASE WHEN SUM(b.impressions) > 0
                        THEN SUM(b.clicks)::float / SUM(b.impressions) * 100
                        ELSE 0 END::float    AS ctr,
                   CASE WHEN SUM(b.clicks) > 0
                        THEN SUM(b.spend) / SUM(b.clicks)
                        ELSE 0 END::float    AS cpc
            FROM meta_insights_breakdowns_daily b
            INNER JOIN meta_ad_accounts a ON a.id = b.ad_account_id
            WHERE b.breakdown_type = %s
              AND b.date_start >= CURRENT_DATE - make_interval(days => %s)
              {where_unit}
            GROUP BY b.breakdown_key
            ORDER BY spend DESC NULLS LAST
            LIMIT %s
        """, params)
        rows = [dict(r) for r in cur.fetchall()]
    return {"type": breakdown_type, "period": period, "unit": unit, "data": rows}


def hourly_performance(period: str = "30d", unit: str | None = None) -> dict:
    """Performance por hora del día (avanzado para optimizar dayparting)."""
    days = _period_days(period)
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = [days]
    if unit:
        params.append(unit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT b.breakdown_key AS hour,
                   SUM(b.spend)::float       AS spend,
                   SUM(b.impressions)::bigint AS impressions,
                   SUM(b.clicks)::bigint     AS clicks,
                   CASE WHEN SUM(b.impressions) > 0
                        THEN SUM(b.clicks)::float / SUM(b.impressions) * 100
                        ELSE 0 END::float    AS ctr,
                   CASE WHEN SUM(b.clicks) > 0
                        THEN SUM(b.spend) / SUM(b.clicks)
                        ELSE 0 END::float    AS cpc
            FROM meta_insights_breakdowns_daily b
            INNER JOIN meta_ad_accounts a ON a.id = b.ad_account_id
            WHERE b.breakdown_type = 'hourly_stats_aggregated_by_advertiser_time_zone'
              AND b.date_start >= CURRENT_DATE - make_interval(days => %s)
              {where_unit}
            GROUP BY b.breakdown_key
            ORDER BY hour
        """, params)
        rows = [dict(r) for r in cur.fetchall()]
    return {"period": period, "unit": unit, "data": rows}


# ─── Cross-data: atribucion ventas / productos / retention ────────────────────


def sales_attribution(period: str = "30d") -> dict:
    """Revenue PaymentIntent atribuido a usuarios firmados durante el periodo de campañas Meta.

    Modelo simple: para cada usuario creado en el periodo, su revenue PI (paid) se atribuye
    al spend Meta de Unidrop. Esto da:
      - Atribución total: revenue de cohort vs total revenue del periodo
      - Revenue / dropshipper atribuido (LTV inicial)
      - Distribución temporal (creados día X aportaron $Y en los siguientes Z días)
    """
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)
    meta_ads_db.init()

    # Spend Meta unidrop
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(SUM(i.spend), 0)::float AS spend
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE a.unit = 'unidrop'
              AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
        """, (days,))
        sp = cur.fetchone() or {}
        spend = float((sp or {}).get("spend") or 0)

    eng = get_engine("unidrop")
    # Revenue PI total del periodo (denominador)
    rev_tot_rows = q(eng, """
        SELECT COALESCE(SUM(pi."paidAmount"), 0)::float AS rev,
               COUNT(*)::int AS pi_count
        FROM public."PaymentIntent" pi
        WHERE pi.status = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0.0, 0)]
    revenue_total = float(rev_tot_rows[0][0] or 0)
    pi_count_total = int(rev_tot_rows[0][1] or 0)

    # Revenue PI de la cohort (usuarios creados en el periodo)
    cohort_rev = q(eng, """
        SELECT COUNT(DISTINCT u.id)::int AS users_with_revenue,
               COALESCE(SUM(pi."paidAmount"), 0)::float AS rev,
               COUNT(pi.id)::int AS pi_count
        FROM public."User" u
        INNER JOIN public."PaymentIntent" pi ON pi."userId" = u.id
        WHERE u."createdAt" >= NOW() - make_interval(days => :d)
          AND pi.status = 'PROCESSED'
          AND pi."createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0, 0.0, 0)]
    users_with_rev = int(cohort_rev[0][0] or 0)
    revenue_attributed = float(cohort_rev[0][1] or 0)
    pi_count_attributed = int(cohort_rev[0][2] or 0)

    # Nuevos signups del periodo (denominador para LTV inicial)
    new_signups_row = q(eng, """
        SELECT COUNT(*)::int FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0,)]
    new_signups = int(new_signups_row[0][0] or 0)

    # Daily attribution: para cada dia, revenue del cohort
    cohort_daily = q(eng, """
        SELECT date_trunc('day', u."createdAt")::date::text AS signup_d,
               COUNT(DISTINCT u.id)::int AS signups,
               COALESCE(SUM(pi."paidAmount"), 0)::float AS rev_first_30d
        FROM public."User" u
        LEFT JOIN public."PaymentIntent" pi
               ON pi."userId" = u.id
              AND pi.status = 'PROCESSED'
              AND pi."createdAt" >= u."createdAt"
              AND pi."createdAt" <= u."createdAt" + INTERVAL '30 days'
        WHERE u."createdAt" >= NOW() - make_interval(days => :d)
        GROUP BY 1 ORDER BY 1
    """, {"d": days}) or []

    rev_attribution_pct = (revenue_attributed / revenue_total * 100) if revenue_total > 0 else 0.0
    ltv_first_30d = (revenue_attributed / new_signups) if new_signups > 0 else 0.0
    roas_attr = (revenue_attributed / spend) if spend > 0 else 0.0

    return {
        "period": period,
        "kpi": {
            "spend": spend,
            "revenue_total": revenue_total,
            "revenue_attributed": revenue_attributed,
            "rev_attribution_pct": rev_attribution_pct,
            "pi_count_total": pi_count_total,
            "pi_count_attributed": pi_count_attributed,
            "new_signups": new_signups,
            "users_with_revenue": users_with_rev,
            "activation_rate": (users_with_rev / new_signups * 100) if new_signups > 0 else 0.0,
            "ltv_first_30d": ltv_first_30d,
            "roas_attributed": roas_attr,
        },
        "daily_cohort": [{"d": r[0], "signups": int(r[1] or 0), "rev_first_30d": float(r[2] or 0)} for r in cohort_daily],
    }


def top_attributed_products(period: str = "30d", limit: int = 20) -> dict:
    """Top SKUs vendidos por dropshippers que firmaron en el periodo (cohort Meta-attributed)."""
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)

    eng = get_engine("unidrop")

    # SKUs cross-channel (ML + TN) en orders de los users del cohort
    rows = q(eng, """
        WITH cohort_users AS (
          SELECT id, dni FROM public."User"
          WHERE "createdAt" >= NOW() - make_interval(days => :d)
        ),
        ml_lines AS (
          SELECT oim."sellerSku" AS sku,
                 oim."item_title" AS title,
                 oim."imagesUrls" AS images,
                 SUM(oim.quantity)::int AS qty,
                 SUM(oim."totalAmount")::float AS revenue
          FROM cohort_users c
          INNER JOIN public."OrderMercadoLibre" oml ON oml."userId" = c.id
          INNER JOIN public."OrderItemMercadoLibre" oim ON oim."orderMercadoLibreId" = oml.id
          WHERE oml."dateCreated" >= NOW() - make_interval(days => :d)
            AND oml.status = 'paid'
          GROUP BY 1, 2, 3
        ),
        tn_lines AS (
          SELECT tnoi.sku AS sku,
                 tnoi.name AS title,
                 NULL::text AS images,
                 SUM(tnoi.quantity)::int AS qty,
                 SUM(tnoi.price * tnoi.quantity)::float AS revenue
          FROM cohort_users c
          INNER JOIN public.tienda_nube_orders tno ON tno.user_id = c.id
          INNER JOIN public.tienda_nube_order_items tnoi ON tnoi.tienda_nube_order_id = tno.tienda_nube_id
          WHERE tno.created_at_tn >= NOW() - make_interval(days => :d)
            AND tno.payment_status::text = 'paid'
          GROUP BY 1, 2
        ),
        unified AS (
          SELECT sku, title, images, qty, revenue FROM ml_lines
          UNION ALL
          SELECT sku, title, images, qty, revenue FROM tn_lines
        )
        SELECT sku,
               MAX(title) AS title,
               MAX(images) AS images,
               SUM(qty)::int AS qty,
               SUM(revenue)::float AS revenue
        FROM unified
        WHERE sku IS NOT NULL AND sku <> ''
        GROUP BY sku
        ORDER BY revenue DESC NULLS LAST
        LIMIT :lim
    """, {"d": days, "lim": limit}) or []

    items = []
    for r in rows:
        img_str = r[2]
        first_img: str | None = None
        if img_str:
            if isinstance(img_str, str):
                first_img = img_str.split(",")[0].strip() or None
            elif isinstance(img_str, list):
                first_img = (img_str[0] if img_str else None)
        items.append({
            "sku": r[0],
            "title": r[1],
            "image": first_img,
            "qty": int(r[3] or 0),
            "revenue": float(r[4] or 0),
        })

    return {"period": period, "items": items}


def cohort_retention(period: str = "30d") -> dict:
    """Retention 30/60/90d para users del cohort (firmados en el periodo). Activo = sub activa hoy."""
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)
    eng = get_engine("unidrop")
    rows = q(eng, """
        WITH cohort AS (
          SELECT id, "createdAt"::date AS d, subscription_status
          FROM public."User"
          WHERE "createdAt" >= NOW() - make_interval(days => :d)
        )
        SELECT
          COUNT(*)::int AS cohort_size,
          COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active_now,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 30 AND subscription_status = 'active')::int AS active_30d_plus,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 30)::int AS cohort_30d_plus,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 60 AND subscription_status = 'active')::int AS active_60d_plus,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 60)::int AS cohort_60d_plus,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 90 AND subscription_status = 'active')::int AS active_90d_plus,
          COUNT(*) FILTER (WHERE d <= CURRENT_DATE - 90)::int AS cohort_90d_plus
        FROM cohort
    """, {"d": days}) or [(0,) * 8]
    r = rows[0]
    cohort_size = int(r[0] or 0)
    active_now = int(r[1] or 0)
    d30_active, d30_total = int(r[2] or 0), int(r[3] or 0)
    d60_active, d60_total = int(r[4] or 0), int(r[5] or 0)
    d90_active, d90_total = int(r[6] or 0), int(r[7] or 0)
    return {
        "period": period,
        "cohort_size": cohort_size,
        "active_now": active_now,
        "activation_pct": (active_now / cohort_size * 100) if cohort_size > 0 else 0.0,
        "retention_30d": {"cohort": d30_total, "active": d30_active,
                          "pct": (d30_active / d30_total * 100) if d30_total > 0 else 0.0},
        "retention_60d": {"cohort": d60_total, "active": d60_active,
                          "pct": (d60_active / d60_total * 100) if d60_total > 0 else 0.0},
        "retention_90d": {"cohort": d90_total, "active": d90_active,
                          "pct": (d90_active / d90_total * 100) if d90_total > 0 else 0.0},
    }


def same_time_compare(period: str = "30d", unit: str | None = None) -> dict:
    """Compara KPIs vs mismo bloque de tiempo en periodos previos (7d / 28d back).
    Devuelve % de variación de spend, clicks y signups Unidrop.
    """
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)
    meta_ads_db.init()

    def _meta_window(days_back_start: int) -> dict:
        where_unit = "AND a.unit = %s" if unit else ""
        params: list = [days_back_start, days_back_start - days]
        if unit:
            params.append(unit)
        with get_conn() as c, c.cursor() as cur:
            cur.execute(f"""
                SELECT COALESCE(SUM(i.spend), 0)::float AS spend,
                       COALESCE(SUM(i.clicks), 0)::bigint AS clicks,
                       COALESCE(SUM(i.impressions), 0)::bigint AS impressions
                FROM meta_insights_daily i
                INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
                WHERE i.date_start <= CURRENT_DATE - make_interval(days => %s)
                  AND i.date_start > CURRENT_DATE - make_interval(days => %s)
                  {where_unit}
            """, params)
            return dict(cur.fetchone() or {})

    cur_window = _meta_window(0)
    prev_window = _meta_window(days)

    # Signups Unidrop window
    eng = get_engine("unidrop")
    cur_sig = q(eng, """
        SELECT COUNT(*)::int FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :d)
    """, {"d": days}) or [(0,)]
    prev_sig = q(eng, """
        SELECT COUNT(*)::int FROM public."User"
        WHERE "createdAt" >= NOW() - make_interval(days => :d2)
          AND "createdAt" < NOW() - make_interval(days => :d)
    """, {"d": days, "d2": days * 2}) or [(0,)]
    cur_signups = int(cur_sig[0][0] or 0)
    prev_signups = int(prev_sig[0][0] or 0)

    def _delta(a: float, b: float) -> float:
        return ((a - b) / b * 100) if b else 0.0

    return {
        "period": period,
        "current": {
            "spend": float(cur_window.get("spend") or 0),
            "clicks": int(cur_window.get("clicks") or 0),
            "impressions": int(cur_window.get("impressions") or 0),
            "signups": cur_signups,
        },
        "previous": {
            "spend": float(prev_window.get("spend") or 0),
            "clicks": int(prev_window.get("clicks") or 0),
            "impressions": int(prev_window.get("impressions") or 0),
            "signups": prev_signups,
        },
        "delta_pct": {
            "spend": _delta(float(cur_window.get("spend") or 0), float(prev_window.get("spend") or 0)),
            "clicks": _delta(float(cur_window.get("clicks") or 0), float(prev_window.get("clicks") or 0)),
            "impressions": _delta(float(cur_window.get("impressions") or 0), float(prev_window.get("impressions") or 0)),
            "signups": _delta(cur_signups, prev_signups),
        },
    }


# ─── Today vs Yesterday + Spend Pace + MKT relationship ──────────────────────


def today_vs_yesterday(unit: str | None = None) -> dict:
    """Compara KPIs de HOY (parcial, dia en curso) vs AYER (cerrado).

    Meta restate insights por varios dias — los numeros de "hoy" cambian
    hasta el dia siguiente. Util para detectar overspend / underdelivery.
    """
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = []
    if unit:
        params.append(unit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT i.date_start::text AS d,
                   COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE i.date_start IN (CURRENT_DATE, CURRENT_DATE - 1)
              {where_unit}
            GROUP BY 1
        """, params)
        rows = {r["d"]: dict(r) for r in cur.fetchall()}
    today_str = dt.date.today().isoformat()
    yest_str = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    blank = {"spend": 0.0, "impressions": 0, "clicks": 0}
    t = rows.get(today_str, blank)
    y = rows.get(yest_str, blank)

    def _d(a: float, b: float) -> float:
        return ((a - b) / b * 100) if b else 0.0

    t_spend = float(t.get("spend") or 0); y_spend = float(y.get("spend") or 0)
    t_impr = int(t.get("impressions") or 0); y_impr = int(y.get("impressions") or 0)
    t_clk = int(t.get("clicks") or 0); y_clk = int(y.get("clicks") or 0)
    return {
        "today": {"date": today_str, "spend": t_spend, "impressions": t_impr, "clicks": t_clk,
                  "ctr": (t_clk / t_impr * 100) if t_impr > 0 else 0.0,
                  "cpc": (t_spend / t_clk) if t_clk > 0 else 0.0},
        "yesterday": {"date": yest_str, "spend": y_spend, "impressions": y_impr, "clicks": y_clk,
                      "ctr": (y_clk / y_impr * 100) if y_impr > 0 else 0.0,
                      "cpc": (y_spend / y_clk) if y_clk > 0 else 0.0},
        "delta_pct": {
            "spend": _d(t_spend, y_spend),
            "impressions": _d(t_impr, y_impr),
            "clicks": _d(t_clk, y_clk),
        },
        "note": "today es parcial - Meta restate por ~3d. Comparar como tendencia, no absoluto.",
    }


def spend_pace(unit: str | None = None) -> list[dict]:
    """Por cada campaña activa con daily_budget: spend de hoy vs pace esperado
    (linealizado por hora del dia AR).

    delta_pct > 0 = overspending vs pace lineal
    delta_pct < 0 = underdelivery (Meta no esta gastando el budget)
    """
    meta_ads_db.init()
    where_unit = "AND a.unit = %s" if unit else ""
    params: list = []
    if unit:
        params.append(unit)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT c.id, c.name, c.effective_status, c.status,
                   c.daily_budget::float AS daily_budget,
                   a.name AS account_name, a.unit, a.currency,
                   COALESCE(SUM(i.spend) FILTER (WHERE i.date_start = CURRENT_DATE), 0)::float AS spend_today,
                   COALESCE(SUM(i.spend) FILTER (WHERE i.date_start = CURRENT_DATE - 1), 0)::float AS spend_yesterday
            FROM meta_campaigns c
            INNER JOIN meta_ad_accounts a ON a.id = c.ad_account_id
            LEFT JOIN meta_insights_daily i ON i.campaign_id = c.id
                AND i.date_start IN (CURRENT_DATE, CURRENT_DATE - 1)
            WHERE c.daily_budget > 0
              AND UPPER(COALESCE(c.effective_status, c.status, '')) = 'ACTIVE'
              {where_unit}
            GROUP BY c.id, c.name, c.effective_status, c.status, c.daily_budget,
                     a.name, a.unit, a.currency
            ORDER BY daily_budget DESC NULLS LAST
        """, params)
        rows = [dict(r) for r in cur.fetchall()]

    # Hora actual AR
    ar_tz = dt.timezone(dt.timedelta(hours=-3))
    now_ar = dt.datetime.now(ar_tz)
    pct_day = (now_ar.hour + now_ar.minute / 60.0) / 24.0
    out = []
    for r in rows:
        budget = float(r.get("daily_budget") or 0)
        spent = float(r.get("spend_today") or 0)
        expected = budget * pct_day
        delta_pct = ((spent - expected) / expected * 100) if expected > 0 else 0.0
        out.append({
            "id": r["id"],
            "name": r.get("name"),
            "account_name": r.get("account_name"),
            "currency": r.get("currency"),
            "status": r.get("effective_status") or r.get("status"),
            "daily_budget": budget,
            "spend_today": spent,
            "spend_yesterday": float(r.get("spend_yesterday") or 0),
            "expected_now": expected,
            "pace_pct": (spent / budget * 100) if budget > 0 else 0.0,
            "expected_pct": pct_day * 100,
            "delta_pct": delta_pct,
        })
    return out


def mkt_unidrop_relationship(period: str = "90d") -> dict:
    """Quality del cohort de signups Unidrop semana por semana vs spend Meta.

    Para cada semana en el periodo, devuelve:
    - signups
    - subs (con start_date_subscription en la semana)
    - users_paid (al menos 1 PaymentIntent PROCESSED en primeros 30d)
    - active_now (subscription_status='active' hoy)
    - rev_first_30d
    - spend Meta esa semana
    - CACs y LTV inicial derivados

    Sirve para responder: "¿estamos mejorando la calidad del adquirido?
    ¿Las campañas mas nuevas traen mejor LTV?"
    """
    from app.db.engines import get_engine
    from app.services._utils import q
    days = _period_days(period)
    meta_ads_db.init()

    # Spend Meta semanal (unidrop)
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT date_trunc('week', i.date_start)::date::text AS week_start,
                   COALESCE(SUM(i.spend), 0)::float AS spend,
                   COALESCE(SUM(i.clicks), 0)::bigint AS clicks,
                   COALESCE(SUM(i.impressions), 0)::bigint AS impressions
            FROM meta_insights_daily i
            INNER JOIN meta_ad_accounts a ON a.id = i.ad_account_id
            WHERE a.unit = 'unidrop'
              AND i.date_start >= CURRENT_DATE - make_interval(days => %s)
            GROUP BY 1 ORDER BY 1
        """, (days,))
        meta_weeks = {r["week_start"]: dict(r) for r in cur.fetchall()}

    eng = get_engine("unidrop")
    cohort_rows = q(eng, """
        WITH cohort AS (
            SELECT u.id,
                   date_trunc('week', u."createdAt")::date AS week_start,
                   u."createdAt",
                   u.subscription_status,
                   u.start_date_subscription
            FROM public."User" u
            WHERE u."createdAt" >= NOW() - make_interval(days => :d)
        ),
        rev30 AS (
            SELECT c.id AS user_id,
                   COALESCE(SUM(pi."paidAmount"), 0)::float AS rev_30d,
                   COUNT(pi.id)::int AS pi_count
            FROM cohort c
            INNER JOIN public."PaymentIntent" pi ON pi."userId" = c.id
              AND pi.status = 'PROCESSED'
              AND pi."createdAt" >= c."createdAt"
              AND pi."createdAt" <= c."createdAt" + INTERVAL '30 days'
            GROUP BY c.id
        )
        SELECT c.week_start::text AS week_start,
               COUNT(*)::int AS signups,
               COUNT(*) FILTER (WHERE c.start_date_subscription IS NOT NULL)::int AS subs,
               COUNT(*) FILTER (WHERE c.subscription_status = 'active')::int AS active_now,
               COUNT(DISTINCT r.user_id)::int AS users_paid,
               COALESCE(SUM(r.rev_30d), 0)::float AS rev_30d
        FROM cohort c
        LEFT JOIN rev30 r ON r.user_id = c.id
        GROUP BY c.week_start
        ORDER BY c.week_start
    """, {"d": days}) or []

    weeks: list[dict] = []
    totals = {"signups": 0, "subs": 0, "active_now": 0, "users_paid": 0,
              "rev_30d": 0.0, "spend": 0.0}
    for r in cohort_rows:
        week = r[0]
        signups = int(r[1] or 0)
        subs = int(r[2] or 0)
        active_now = int(r[3] or 0)
        users_paid = int(r[4] or 0)
        rev = float(r[5] or 0)
        meta = meta_weeks.get(week, {})
        spend = float(meta.get("spend") or 0)
        clicks = int(meta.get("clicks") or 0)
        weeks.append({
            "week_start": week,
            "spend": spend,
            "clicks": clicks,
            "signups": signups,
            "subs": subs,
            "active_now": active_now,
            "users_paid": users_paid,
            "rev_30d": rev,
            "activation_pct": (users_paid / signups * 100) if signups > 0 else 0.0,
            "sub_rate_pct": (subs / signups * 100) if signups > 0 else 0.0,
            "retention_pct": (active_now / signups * 100) if signups > 0 else 0.0,
            "ltv_first_30d": (rev / signups) if signups > 0 else 0.0,
            "cac_signup": (spend / signups) if signups > 0 else 0.0,
            "cac_sub": (spend / subs) if subs > 0 else 0.0,
            "click_to_signup_pct": (signups / clicks * 100) if clicks > 0 else 0.0,
        })
        totals["signups"] += signups
        totals["subs"] += subs
        totals["active_now"] += active_now
        totals["users_paid"] += users_paid
        totals["rev_30d"] += rev
        totals["spend"] += spend

    s = totals["signups"]
    summary = {
        **totals,
        "weeks_count": len(weeks),
        "avg_cac_signup": (totals["spend"] / s) if s else 0.0,
        "avg_cac_sub": (totals["spend"] / totals["subs"]) if totals["subs"] else 0.0,
        "avg_ltv_30d": (totals["rev_30d"] / s) if s else 0.0,
        "avg_activation_pct": (totals["users_paid"] / s * 100) if s else 0.0,
        "avg_sub_rate_pct": (totals["subs"] / s * 100) if s else 0.0,
        "avg_retention_pct": (totals["active_now"] / s * 100) if s else 0.0,
        "roas_30d": (totals["rev_30d"] / totals["spend"]) if totals["spend"] else 0.0,
    }
    return {"period": period, "weeks": weeks, "summary": summary}


# ─── Async dispatcher (background sync) ───────────────────────────────────────


SYNC_KINDS = ("sync_all", "sync_breakdowns")


def _run_sync_bg(run_id: int, kind: str, historical_days: int) -> None:
    """Hilo background: marca running, ejecuta, marca done/error."""
    from app.db import meta_sync_runs_db as runs_db
    log.info("Sync run %d (%s, %dd) START", run_id, kind, historical_days)
    try:
        runs_db.mark_running(run_id)
        if kind == "sync_all":
            summary = sync_all(historical_days=historical_days)
        elif kind == "sync_breakdowns":
            summary = sync_breakdowns(historical_days=historical_days)
        else:
            raise RuntimeError(f"kind invalido: {kind}")
        runs_db.mark_done(run_id, summary)
        log.info("Sync run %d (%s) DONE", run_id, kind)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        log.exception("Sync run %d (%s) FAILED: %s", run_id, kind, err)
        try:
            runs_db.mark_error(run_id, err)
        except Exception:
            log.exception("No se pudo marcar run %d como error", run_id)


def start_sync_async(
    kind: str,
    historical_days: int,
    started_by_id: int | None,
    started_by_email: str | None,
) -> dict:
    """Crea run y spawn de thread daemon. Retorna {run_id, reused}.

    Si ya hay un run activo (pending/running) del mismo kind, reusa ese run_id
    en vez de spawnear otro (idempotencia frente a doble-click).
    """
    if kind not in SYNC_KINDS:
        raise RuntimeError(f"kind invalido: {kind}")
    from app.db import meta_sync_runs_db as runs_db
    runs_db.init()
    active = runs_db.find_active(kind)
    if active:
        return {"run_id": int(active["id"]), "reused": True}
    run_id = runs_db.create_run(kind, historical_days, started_by_id, started_by_email)
    t = threading.Thread(
        target=_run_sync_bg,
        args=(run_id, kind, historical_days),
        daemon=True,
        name=f"meta-sync-{run_id}",
    )
    t.start()
    return {"run_id": run_id, "reused": False}


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _period_days(p: str) -> int:
    return {"7d": 7, "30d": 30, "90d": 90, "1y": 365, "all": 3650}.get(p, 30)


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _to_money(v: Any) -> float | None:
    """Meta devuelve budgets en centavos como string. Convertir a unidades monetarias."""
    if v is None:
        return None
    try:
        return float(v) / 100.0
    except (TypeError, ValueError):
        return None


def _summarize_targeting(t: dict | None) -> str | None:
    if not t:
        return None
    parts = []
    if t.get("geo_locations"):
        geo = t["geo_locations"]
        countries = geo.get("countries") or []
        if countries:
            parts.append("geo:" + ",".join(countries[:5]))
    if t.get("age_min") or t.get("age_max"):
        parts.append(f"age:{t.get('age_min', '?')}-{t.get('age_max', '?')}")
    if t.get("genders"):
        parts.append("gender:" + ",".join(str(g) for g in t["genders"]))
    if t.get("interests"):
        parts.append(f"interests:{len(t['interests'])}")
    return " | ".join(parts) or None
