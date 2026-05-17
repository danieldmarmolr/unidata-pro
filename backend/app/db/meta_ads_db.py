"""
Meta Ads (Facebook Marketing API) - tablas Supabase para insights de pauta.

5 tablas modeladas para 1:N:N (ad_account → campaign → adset → ad → insight diaria):
- meta_ad_accounts        : cuentas publicitarias linkeadas al token
- meta_campaigns          : campañas
- meta_adsets             : conjuntos de anuncios
- meta_ads                : anuncios individuales
- meta_insights_daily     : métricas por día y nivel (account/campaign/adset/ad)

Auto-migra al boot. Idempotente. Las metricas se UPSERT-ean por
(ad_id, date_start) para que correr el sync 2 veces no duplique.
"""
from __future__ import annotations

import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.meta_ads")

_LOCK = threading.RLock()
_INITIALIZED = False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_ad_accounts (
                    id              TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,
                    currency        TEXT,
                    unit            TEXT NOT NULL DEFAULT 'unidrop',
                    timezone_name   TEXT,
                    account_status  INT,
                    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                    last_synced_at  TIMESTAMPTZ,
                    last_sync_error TEXT,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_campaigns (
                    id              TEXT PRIMARY KEY,
                    ad_account_id   TEXT NOT NULL REFERENCES meta_ad_accounts(id) ON DELETE CASCADE,
                    name            TEXT NOT NULL,
                    objective       TEXT,
                    status          TEXT,
                    effective_status TEXT,
                    daily_budget    NUMERIC,
                    lifetime_budget NUMERIC,
                    budget_remaining NUMERIC,
                    start_time      TIMESTAMPTZ,
                    stop_time       TIMESTAMPTZ,
                    created_time    TIMESTAMPTZ,
                    updated_time    TIMESTAMPTZ,
                    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_campaigns_account "
                "ON meta_campaigns (ad_account_id, status)"
            )
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_adsets (
                    id                  TEXT PRIMARY KEY,
                    campaign_id         TEXT NOT NULL REFERENCES meta_campaigns(id) ON DELETE CASCADE,
                    ad_account_id       TEXT NOT NULL,
                    name                TEXT NOT NULL,
                    status              TEXT,
                    effective_status    TEXT,
                    daily_budget        NUMERIC,
                    lifetime_budget     NUMERIC,
                    bid_amount          NUMERIC,
                    optimization_goal   TEXT,
                    billing_event       TEXT,
                    targeting_summary   TEXT,
                    start_time          TIMESTAMPTZ,
                    end_time            TIMESTAMPTZ,
                    created_time        TIMESTAMPTZ,
                    updated_time        TIMESTAMPTZ,
                    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign "
                "ON meta_adsets (campaign_id, status)"
            )
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_ads (
                    id                  TEXT PRIMARY KEY,
                    adset_id            TEXT NOT NULL REFERENCES meta_adsets(id) ON DELETE CASCADE,
                    campaign_id         TEXT NOT NULL,
                    ad_account_id       TEXT NOT NULL,
                    name                TEXT NOT NULL,
                    status              TEXT,
                    effective_status    TEXT,
                    creative_id         TEXT,
                    creative_summary    TEXT,
                    preview_url         TEXT,
                    created_time        TIMESTAMPTZ,
                    updated_time        TIMESTAMPTZ,
                    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_ads_adset "
                "ON meta_ads (adset_id, status)"
            )
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_insights_daily (
                    id              BIGSERIAL PRIMARY KEY,
                    ad_account_id   TEXT NOT NULL,
                    campaign_id     TEXT,
                    adset_id        TEXT,
                    ad_id           TEXT,
                    date_start      DATE NOT NULL,
                    spend           NUMERIC NOT NULL DEFAULT 0,
                    impressions     BIGINT NOT NULL DEFAULT 0,
                    reach           BIGINT NOT NULL DEFAULT 0,
                    clicks          BIGINT NOT NULL DEFAULT 0,
                    unique_clicks   BIGINT NOT NULL DEFAULT 0,
                    inline_link_clicks BIGINT NOT NULL DEFAULT 0,
                    cpm             NUMERIC,
                    cpc             NUMERIC,
                    ctr             NUMERIC,
                    frequency       NUMERIC,
                    actions         JSONB,
                    action_values   JSONB,
                    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_insights_ad_date "
                "ON meta_insights_daily (COALESCE(ad_id,'_'), date_start)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_insights_account_date "
                "ON meta_insights_daily (ad_account_id, date_start DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_insights_campaign_date "
                "ON meta_insights_daily (campaign_id, date_start DESC) "
                "WHERE campaign_id IS NOT NULL"
            )
            cur.execute("""
                CREATE TABLE IF NOT EXISTS meta_insights_breakdowns_daily (
                    id              BIGSERIAL PRIMARY KEY,
                    ad_account_id   TEXT NOT NULL,
                    breakdown_type  TEXT NOT NULL,
                    breakdown_key   TEXT NOT NULL,
                    breakdown_key2  TEXT,
                    date_start      DATE NOT NULL,
                    spend           NUMERIC NOT NULL DEFAULT 0,
                    impressions     BIGINT NOT NULL DEFAULT 0,
                    reach           BIGINT NOT NULL DEFAULT 0,
                    clicks          BIGINT NOT NULL DEFAULT 0,
                    actions         JSONB,
                    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_bk_daily "
                "ON meta_insights_breakdowns_daily "
                "(ad_account_id, breakdown_type, breakdown_key, COALESCE(breakdown_key2,''), date_start)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_meta_bk_type_date "
                "ON meta_insights_breakdowns_daily (breakdown_type, date_start DESC)"
            )
        _INITIALIZED = True


# ----- CRUD helpers -----

def upsert_account(*, id: str, name: str, currency: str | None, unit: str,
                   timezone_name: str | None, account_status: int | None) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_ad_accounts (id, name, currency, unit, timezone_name, account_status)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                currency = EXCLUDED.currency,
                unit = EXCLUDED.unit,
                timezone_name = EXCLUDED.timezone_name,
                account_status = EXCLUDED.account_status,
                updated_at = NOW()
        """, (id, name, currency, unit, timezone_name, account_status))


def mark_account_synced(account_id: str, error: str | None = None) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE meta_ad_accounts SET last_synced_at = NOW(), last_sync_error = %s, updated_at = NOW() WHERE id = %s",
            (error, account_id),
        )


def upsert_campaign(row: dict) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_campaigns
                (id, ad_account_id, name, objective, status, effective_status,
                 daily_budget, lifetime_budget, budget_remaining,
                 start_time, stop_time, created_time, updated_time, synced_at)
            VALUES (%(id)s, %(ad_account_id)s, %(name)s, %(objective)s, %(status)s, %(effective_status)s,
                    %(daily_budget)s, %(lifetime_budget)s, %(budget_remaining)s,
                    %(start_time)s, %(stop_time)s, %(created_time)s, %(updated_time)s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                objective = EXCLUDED.objective,
                status = EXCLUDED.status,
                effective_status = EXCLUDED.effective_status,
                daily_budget = EXCLUDED.daily_budget,
                lifetime_budget = EXCLUDED.lifetime_budget,
                budget_remaining = EXCLUDED.budget_remaining,
                stop_time = EXCLUDED.stop_time,
                updated_time = EXCLUDED.updated_time,
                synced_at = NOW()
        """, row)


def upsert_adset(row: dict) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_adsets
                (id, campaign_id, ad_account_id, name, status, effective_status,
                 daily_budget, lifetime_budget, bid_amount, optimization_goal,
                 billing_event, targeting_summary, start_time, end_time,
                 created_time, updated_time, synced_at)
            VALUES (%(id)s, %(campaign_id)s, %(ad_account_id)s, %(name)s, %(status)s,
                    %(effective_status)s, %(daily_budget)s, %(lifetime_budget)s,
                    %(bid_amount)s, %(optimization_goal)s, %(billing_event)s,
                    %(targeting_summary)s, %(start_time)s, %(end_time)s,
                    %(created_time)s, %(updated_time)s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                effective_status = EXCLUDED.effective_status,
                daily_budget = EXCLUDED.daily_budget,
                lifetime_budget = EXCLUDED.lifetime_budget,
                bid_amount = EXCLUDED.bid_amount,
                optimization_goal = EXCLUDED.optimization_goal,
                end_time = EXCLUDED.end_time,
                updated_time = EXCLUDED.updated_time,
                synced_at = NOW()
        """, row)


def upsert_ad(row: dict) -> None:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_ads
                (id, adset_id, campaign_id, ad_account_id, name, status, effective_status,
                 creative_id, creative_summary, preview_url, created_time, updated_time, synced_at)
            VALUES (%(id)s, %(adset_id)s, %(campaign_id)s, %(ad_account_id)s, %(name)s,
                    %(status)s, %(effective_status)s, %(creative_id)s, %(creative_summary)s,
                    %(preview_url)s, %(created_time)s, %(updated_time)s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                effective_status = EXCLUDED.effective_status,
                creative_summary = EXCLUDED.creative_summary,
                updated_time = EXCLUDED.updated_time,
                synced_at = NOW()
        """, row)


def upsert_insight(row: dict) -> None:
    """UPSERT por (ad_id, date_start). Si ad_id es null usa '_' como placeholder."""
    init()
    import json
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_insights_daily
                (ad_account_id, campaign_id, adset_id, ad_id, date_start,
                 spend, impressions, reach, clicks, unique_clicks, inline_link_clicks,
                 cpm, cpc, ctr, frequency, actions, action_values, synced_at)
            VALUES (%(ad_account_id)s, %(campaign_id)s, %(adset_id)s, %(ad_id)s, %(date_start)s,
                    %(spend)s, %(impressions)s, %(reach)s, %(clicks)s, %(unique_clicks)s, %(inline_link_clicks)s,
                    %(cpm)s, %(cpc)s, %(ctr)s, %(frequency)s, %(actions)s, %(action_values)s, NOW())
            ON CONFLICT (COALESCE(ad_id, '_'), date_start) DO UPDATE SET
                spend = EXCLUDED.spend,
                impressions = EXCLUDED.impressions,
                reach = EXCLUDED.reach,
                clicks = EXCLUDED.clicks,
                unique_clicks = EXCLUDED.unique_clicks,
                inline_link_clicks = EXCLUDED.inline_link_clicks,
                cpm = EXCLUDED.cpm,
                cpc = EXCLUDED.cpc,
                ctr = EXCLUDED.ctr,
                frequency = EXCLUDED.frequency,
                actions = EXCLUDED.actions,
                action_values = EXCLUDED.action_values,
                synced_at = NOW()
        """, {**row, "actions": json.dumps(row.get("actions")) if row.get("actions") else None,
              "action_values": json.dumps(row.get("action_values")) if row.get("action_values") else None})


def upsert_breakdown(row: dict) -> None:
    """UPSERT por (account, breakdown_type, key, key2, date)."""
    init()
    import json
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            INSERT INTO meta_insights_breakdowns_daily
                (ad_account_id, breakdown_type, breakdown_key, breakdown_key2,
                 date_start, spend, impressions, reach, clicks, actions, synced_at)
            VALUES (%(ad_account_id)s, %(breakdown_type)s, %(breakdown_key)s,
                    %(breakdown_key2)s, %(date_start)s,
                    %(spend)s, %(impressions)s, %(reach)s, %(clicks)s,
                    %(actions)s, NOW())
            ON CONFLICT (ad_account_id, breakdown_type, breakdown_key,
                         COALESCE(breakdown_key2,''), date_start) DO UPDATE SET
                spend = EXCLUDED.spend,
                impressions = EXCLUDED.impressions,
                reach = EXCLUDED.reach,
                clicks = EXCLUDED.clicks,
                actions = EXCLUDED.actions,
                synced_at = NOW()
        """, {**row, "actions": json.dumps(row.get("actions")) if row.get("actions") else None})


def list_accounts() -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM meta_ad_accounts ORDER BY unit, name")
        return [_to_dict(r) for r in cur.fetchall()]


def _to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("created_at", "updated_at", "last_synced_at", "start_time", "stop_time",
              "created_time", "updated_time", "end_time", "synced_at", "date_start"):
        if k in d and d[k] is not None and not isinstance(d[k], str):
            d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else str(d[k])
    return d
