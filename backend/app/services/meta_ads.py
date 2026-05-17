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
        params.insert(0, unit)
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
    params: list = []
    if unit:
        params.append(unit)
    params.append(days)
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

    spend = float(meta_tot[0] or 0) if meta_tot else 0.0
    impressions = int(meta_tot[1] or 0) if meta_tot else 0
    clicks = int(meta_tot[2] or 0) if meta_tot else 0

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
