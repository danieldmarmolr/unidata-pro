"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { api, getUser } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import {
  ArrowLeft, DollarSign, Eye, MousePointerClick, Target, TrendingUp,
  RefreshCw, AlertTriangle, Users, UserPlus, Repeat, Zap, Clock, MapPin,
  Smartphone, Layers, ArrowUpRight, ArrowDownRight, ShoppingBag, Activity,
  CheckCircle2, XCircle, History, ChevronDown, ChevronUp,
} from "lucide-react";
import { MetaImpactChart } from "@/components/meta-impact-chart";

// ─── Types ──────────────────────────────────────────────────────────────────

type MetaOverview = {
  kpi: {
    spend: number; impressions: number; clicks: number; reach: number;
    active_campaigns: number; cpm: number; cpc: number; ctr: number;
  };
  daily: { d: string; spend: number; impressions: number; clicks: number }[];
  accounts: { id: string; name: string; currency: string; unit: string;
              last_synced_at: string | null; spend: number }[];
  period: string;
  unit: string | null;
};

type MetaImpact = {
  period: string;
  kpi: {
    spend: number; impressions: number; clicks: number;
    new_signups: number; new_subscriptions: number;
    revenue_pi: number; pi_count: number;
    cac_dropshipper: number; cac_subscripcion: number;
    roas: number; cpc: number;
  };
  daily: { d: string; spend: number; clicks: number; signups: number; revenue: number }[];
  funnel: { step: string; value: number; rate_from_prev: number | null }[];
};

type MetaCampaign = {
  id: string; name: string; objective: string | null;
  status: string; effective_status: string;
  daily_budget: number | null; lifetime_budget: number | null;
  unit: string; account_name: string; currency: string;
  spend: number; impressions: number; clicks: number;
  cpm: number; cpc: number; ctr: number;
};

type BreakdownResp = {
  type: string; period: string; unit: string | null;
  data: { key: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number }[];
};

type HourlyResp = {
  period: string; unit: string | null;
  data: { hour: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number }[];
};

type SameTime = {
  period: string;
  current: { spend: number; clicks: number; impressions: number; signups: number };
  previous: { spend: number; clicks: number; impressions: number; signups: number };
  delta_pct: { spend: number; clicks: number; impressions: number; signups: number };
};

type Attribution = {
  period: string;
  kpi: {
    spend: number; revenue_total: number; revenue_attributed: number;
    rev_attribution_pct: number; pi_count_total: number; pi_count_attributed: number;
    new_signups: number; users_with_revenue: number;
    activation_rate: number; ltv_first_30d: number; roas_attributed: number;
  };
  daily_cohort: { d: string; signups: number; rev_first_30d: number }[];
};

type CohortRet = {
  period: string;
  cohort_size: number;
  active_now: number;
  activation_pct: number;
  retention_30d: { cohort: number; active: number; pct: number };
  retention_60d: { cohort: number; active: number; pct: number };
  retention_90d: { cohort: number; active: number; pct: number };
};

type TopProducts = {
  period: string;
  items: { sku: string; title: string | null; image: string | null; qty: number; revenue: number }[];
};

type TodayVsYesterday = {
  today: { date: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number };
  yesterday: { date: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number };
  delta_pct: { spend: number; impressions: number; clicks: number };
  note: string;
};

type SpendPaceItem = {
  id: string; name: string | null; account_name: string | null; currency: string | null;
  status: string | null;
  daily_budget: number; spend_today: number; spend_yesterday: number;
  expected_now: number; pace_pct: number; expected_pct: number; delta_pct: number;
};

type MktUnidropRelationship = {
  period: string;
  weeks: {
    week_start: string;
    spend: number; clicks: number;
    signups: number; subs: number; active_now: number; users_paid: number; rev_30d: number;
    activation_pct: number; sub_rate_pct: number; retention_pct: number;
    ltv_first_30d: number; cac_signup: number; cac_sub: number;
    click_to_signup_pct: number;
  }[];
  summary: {
    weeks_count: number;
    signups: number; subs: number; active_now: number; users_paid: number;
    rev_30d: number; spend: number;
    avg_cac_signup: number; avg_cac_sub: number; avg_ltv_30d: number;
    avg_activation_pct: number; avg_sub_rate_pct: number; avg_retention_pct: number;
    roas_30d: number;
  };
};

type TopAdsResp = {
  items: {
    id: string; name: string; adset_id: string | null; campaign_id: string | null;
    status: string | null; effective_status: string | null;
    creative_summary: string | null; preview_url: string | null;
    spend: number; impressions: number; clicks: number;
  }[];
  count: number;
};

type TopAdsetsResp = {
  items: {
    id: string; name: string; campaign_id: string | null; status: string | null;
    effective_status: string | null; daily_budget: number | null; lifetime_budget: number | null;
    optimization_goal: string | null; billing_event: string | null;
    targeting_summary: string | null;
    spend: number; impressions: number; clicks: number;
  }[];
  count: number;
};

type SyncRunStatus = "pending" | "running" | "done" | "error";
type SyncRunKind = "sync_all" | "sync_breakdowns";
type SyncAllSummary = {
  since: string; until: string;
  accounts: { id: string; name: string; unit: string;
              campaigns: number; adsets: number; ads: number; insights: number;
              error: string | null }[];
};
type SyncBreakdownsSummary = {
  since: string; until: string; breakdowns: string[];
  accounts: { id: string; name: string; rows: Record<string, number>; error: string | null }[];
};
type SyncRun = {
  id: number;
  kind: SyncRunKind;
  status: SyncRunStatus;
  historical_days: number | null;
  started_by_email: string | null;
  started_at: string;
  finished_at: string | null;
  summary: SyncAllSummary | SyncBreakdownsSummary | null;
  error: string | null;
};

const PERIOD_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "12 meses" },
];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MetaAdsPage() {
  const me = getUser();
  const isAdmin = !!me?.is_admin || me?.role === "admin";
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "1y">("30d");
  // Default UNIDROP — por ahora solo esa unidad tiene Meta Ads conectado.
  // Unistore queda placeholder (boton disabled) hasta que se desarrolle.
  const [unit, setUnit] = useState<"unistore" | "unidrop">("unidrop");
  const [cpSort, setCpSort] = useState<{ col: keyof MetaCampaign; dir: "asc" | "desc" }>({ col: "spend", dir: "desc" });
  const [cpStatus, setCpStatus] = useState("");
  const [cpObjective, setCpObjective] = useState("");
  const [cpSearch, setCpSearch] = useState("");
  const qc = useQueryClient();
  const showCross = !unit || unit === "unidrop";
  const qsBase = `period=${period}${unit ? `&unit=${unit}` : ""}`;

  // Auto-refresh: el cron backend sincroniza data cada 1h. El frontend
  // refetchea cada 5min asi el equipo Marketing ve la data fresca sin recargar.
  const REFRESH_MS = 5 * 60 * 1000;

  const ovQ = useQuery<MetaOverview>({
    queryKey: ["meta-overview", period, unit],
    queryFn: () => api(`/api/marketing/meta/overview?${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const cpQ = useQuery<{ items: MetaCampaign[]; count: number }>({
    queryKey: ["meta-campaigns", period, unit],
    queryFn: () => api(`/api/marketing/meta/campaigns?${qsBase}&limit=200`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const impQ = useQuery<MetaImpact>({
    queryKey: ["meta-impact", period],
    queryFn: () => api(`/api/marketing/meta/unidrop-impact?period=${period}`),
    staleTime: 60_000,
    enabled: showCross,
    refetchInterval: showCross ? REFRESH_MS : false,
  });
  const stQ = useQuery<SameTime>({
    queryKey: ["meta-same-time", period, unit],
    queryFn: () => api(`/api/marketing/meta/same-time?${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const ageQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "age", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=age&${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const genQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "gender", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=gender&${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const platQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "publisher_platform", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=publisher_platform&${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const posQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "platform_position", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=platform_position&${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const devQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "device_platform", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=device_platform&${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const regQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "region", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=region&${qsBase}&limit=15`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const hourQ = useQuery<HourlyResp>({
    queryKey: ["meta-hourly", period, unit],
    queryFn: () => api(`/api/marketing/meta/hourly?${qsBase}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const attrQ = useQuery<Attribution>({
    queryKey: ["meta-attr", period],
    queryFn: () => api(`/api/marketing/meta/sales-attribution?period=${period}`),
    staleTime: 60_000,
    enabled: showCross,
    refetchInterval: showCross ? REFRESH_MS : false,
  });
  const retQ = useQuery<CohortRet>({
    queryKey: ["meta-ret", period],
    queryFn: () => api(`/api/marketing/meta/cohort-retention?period=${period === "7d" ? "30d" : period}`),
    staleTime: 60_000,
    enabled: showCross,
    refetchInterval: showCross ? REFRESH_MS : false,
  });
  const topQ = useQuery<TopProducts>({
    queryKey: ["meta-top-products", period],
    queryFn: () => api(`/api/marketing/meta/top-products?period=${period}&limit=12`),
    staleTime: 60_000,
    enabled: showCross,
    refetchInterval: showCross ? REFRESH_MS : false,
  });

  // Nuevas insights (Top Ads, Top Adsets, Today vs Yesterday, Spend Pace, MKT × UNIDROP)
  const tvyQ = useQuery<TodayVsYesterday>({
    queryKey: ["meta-today-vs-yesterday", unit],
    queryFn: () => api(`/api/marketing/meta/today-vs-yesterday?unit=${unit}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const paceQ = useQuery<{ items: SpendPaceItem[]; count: number }>({
    queryKey: ["meta-spend-pace", unit],
    queryFn: () => api(`/api/marketing/meta/spend-pace?unit=${unit}`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const topAdsQ = useQuery<TopAdsResp>({
    queryKey: ["meta-top-ads", period],
    queryFn: () => api(`/api/marketing/meta/ads?period=${period}&limit=12`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const topAdsetsQ = useQuery<TopAdsetsResp>({
    queryKey: ["meta-top-adsets", period],
    queryFn: () => api(`/api/marketing/meta/adsets?period=${period}&limit=12`),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });
  const mktQ = useQuery<MktUnidropRelationship>({
    queryKey: ["meta-mkt-unidrop", period],
    // Para 7d/30d usamos 90d (necesitamos varias semanas para ver tendencia)
    queryFn: () => api(`/api/marketing/meta/mkt-unidrop-relationship?period=${(period === "7d" || period === "30d") ? "90d" : period}`),
    staleTime: 60_000,
    enabled: showCross,
    refetchInterval: showCross ? REFRESH_MS : false,
  });

  // Sync background-job pattern: POST dispara, retorna run_id, frontend pollea.
  type DispatchResp = { run_id: number; kind: SyncRunKind; reused: boolean };
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const syncMut = useMutation<DispatchResp, Error, number>({
    mutationFn: (historicalDays: number) =>
      api<DispatchResp>(`/api/marketing/meta/sync?historical_days=${historicalDays}`, { method: "POST" }),
    onSuccess: (data) => setActiveRunId(data.run_id),
  });
  const bkSyncMut = useMutation<DispatchResp, Error, number>({
    mutationFn: (historicalDays: number) =>
      api<DispatchResp>(`/api/marketing/meta/sync-breakdowns?historical_days=${historicalDays}`, { method: "POST" }),
    onSuccess: (data) => setActiveRunId(data.run_id),
  });

  // Historial de runs - tambien usado al montar para reenganchar a un run activo
  // si el user recargo la pagina mientras estaba corriendo.
  const runsListQ = useQuery<{ items: SyncRun[] }>({
    queryKey: ["meta-sync-runs"],
    queryFn: () => api(`/api/marketing/meta/sync-runs?limit=10`),
    refetchInterval: activeRunId ? 5_000 : false,
    staleTime: 0,
  });
  useEffect(() => {
    if (activeRunId !== null) return;
    const items = runsListQ.data?.items;
    if (!items?.length) return;
    const active = items.find((r) => r.status === "pending" || r.status === "running");
    if (active) setActiveRunId(active.id);
  }, [runsListQ.data, activeRunId]);

  // Poll del run activo
  const runQ = useQuery<SyncRun>({
    queryKey: ["meta-sync-run", activeRunId],
    queryFn: () => api(`/api/marketing/meta/sync-runs/${activeRunId}`),
    enabled: activeRunId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "pending" || s === "running" ? 3_000 : false;
    },
  });

  // Cuando el run termina OK -> invalidar dashboards y refrescar historial
  useEffect(() => {
    if (runQ.data?.status !== "done") return;
    if (runQ.data.kind === "sync_all") {
      qc.invalidateQueries({ queryKey: ["meta-overview"] });
      qc.invalidateQueries({ queryKey: ["meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["meta-impact"] });
      qc.invalidateQueries({ queryKey: ["meta-same-time"] });
      qc.invalidateQueries({ queryKey: ["meta-attr"] });
      qc.invalidateQueries({ queryKey: ["meta-ret"] });
      qc.invalidateQueries({ queryKey: ["meta-top-products"] });
    } else {
      qc.invalidateQueries({ queryKey: ["meta-bk"] });
      qc.invalidateQueries({ queryKey: ["meta-hourly"] });
    }
    qc.invalidateQueries({ queryKey: ["meta-sync-runs"] });
  }, [runQ.data?.status, runQ.data?.kind, qc]);

  const isSyncing = runQ.data?.status === "pending" || runQ.data?.status === "running";

  const ov = ovQ.data;
  const isEmpty = !ovQ.isLoading && (!ov || ov.kpi.spend === 0);

  // Freshness: timestamp mas reciente de last_synced_at entre las cuentas
  const lastSyncedAt: string | null = (() => {
    const ts = (ov?.accounts ?? [])
      .map(a => a.last_synced_at)
      .filter((x): x is string => !!x)
      .sort();
    return ts.length ? ts[ts.length - 1] : null;
  })();

  return (
    <>
      <Topbar title="Meta Ads · Comando central" subtitle="UNIDROP · auto-sync cada 1h · refresh UI cada 5min" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="marketing" title="HOY · Meta Ads" />
        <Link href="/dashboard/marketing" className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-primary mb-4">
          <ArrowLeft size={14} /> Volver a Marketing
        </Link>

        {/* Filtros + sync */}
        <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
          <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">
            {PERIOD_OPTIONS.map((p) => (
              <button key={p.value} onClick={() => setPeriod(p.value as "7d" | "30d" | "90d" | "1y")}
                className={"px-3 py-1 text-xs font-bold rounded-md transition " + (period === p.value ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">
            <button onClick={() => setUnit("unidrop")}
              className={"px-3 py-1 text-xs font-bold rounded-md transition " + (unit === "unidrop" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
              Unidrop
            </button>
            <button disabled title="Proximamente — Meta Ads para Unistore aun no esta desarrollado"
              className="px-3 py-1 text-xs font-bold rounded-md transition text-text-muted/50 cursor-not-allowed flex items-center gap-1">
              Unistore <span className="text-[8px] uppercase tracking-wider opacity-70">prox.</span>
            </button>
          </div>
          <FreshnessPill lastSyncedAt={lastSyncedAt} isSyncing={isSyncing} />
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <button onClick={() => syncMut.mutate(30)} disabled={isSyncing || syncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5 disabled:opacity-50">
                <RefreshCw size={12} className={isSyncing && runQ.data?.kind === "sync_all" ? "animate-spin" : ""} /> Sync 30d
              </button>
              <button onClick={() => bkSyncMut.mutate(30)} disabled={isSyncing || bkSyncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-accent/40 text-accent text-xs font-semibold hover:bg-accent/5 disabled:opacity-50">
                <RefreshCw size={12} className={isSyncing && runQ.data?.kind === "sync_breakdowns" ? "animate-spin" : ""} /> Sync breakdowns
              </button>
              <button onClick={() => { if (confirm("Pull histórico 12m. Tarda ~5-10 min. ¿Continuar?")) syncMut.mutate(365); }}
                disabled={isSyncing || syncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50">
                <RefreshCw size={12} /> Backfill 12m
              </button>
            </div>
          )}
        </div>

        {/* Dispatch error (raro - solo si la POST inicial fallo, no el sync mismo) */}
        {(syncMut.isError || bkSyncMut.isError) && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs mb-4">
            No se pudo disparar el sync: {((syncMut.error || bkSyncMut.error) as Error)?.message}
          </div>
        )}

        {/* Estado del run activo / ultimo run */}
        <SyncRunCard run={runQ.data} onDismiss={() => setActiveRunId(null)} />

        {/* Historial */}
        {isAdmin && (runsListQ.data?.items.length ?? 0) > 0 && (
          <div className="mb-4">
            <button onClick={() => setHistoryOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text font-semibold">
              <History size={12} />
              Historial de sync ({runsListQ.data!.items.length})
              {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {historyOpen && (
              <div className="mt-2 bg-surface border border-border rounded-lg p-2 space-y-1 max-h-72 overflow-y-auto">
                {runsListQ.data!.items.map(r => (
                  <SyncRunRow key={r.id} run={r} active={r.id === activeRunId}
                    onSelect={() => setActiveRunId(r.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && !ovQ.isLoading && (
          <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-6 text-center">
            <AlertTriangle size={32} className="text-amber-600 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-amber-900 mb-1">Sin datos de Meta Ads todavía</h3>
            <p className="text-xs text-amber-800/80 mb-4">
              Hacé click en <strong>"Backfill 12m"</strong> para traer histórico inicial.
            </p>
          </div>
        )}

        {!isEmpty && ov && (
          <div className="space-y-5">
            {/* ── Section 1: Pulso ── */}
            <Section title="Pulso" icon={Activity} subtitle="KPIs hero + variación vs periodo previo equivalente">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                <KpiHero icon={DollarSign} label="Inversión" value={formatCurrency(ov.kpi.spend)} hint={`${formatNumber(ov.kpi.active_campaigns)} campañas activas`} delta={stQ.data?.delta_pct.spend} />
                <KpiHero icon={Eye} label="Impresiones" value={formatNumber(ov.kpi.impressions)} hint={`Alcance ${formatNumber(ov.kpi.reach)}`} delta={stQ.data?.delta_pct.impressions} />
                <KpiHero icon={MousePointerClick} label="Clicks" value={formatNumber(ov.kpi.clicks)} hint={`CTR ${ov.kpi.ctr.toFixed(2)}%`} delta={stQ.data?.delta_pct.clicks} />
                <KpiHero icon={Target} label="CPC" value={formatCurrency(ov.kpi.cpc)} hint="Costo por click" />
                <KpiHero icon={TrendingUp} label="CPM" value={formatCurrency(ov.kpi.cpm)} hint="Costo por mil impresiones" />
              </div>
            </Section>

            {/* ── Section 1b: Hoy vs Ayer ── */}
            {tvyQ.data && (
              <Section title="Hoy vs Ayer" icon={Clock} subtitle={`${tvyQ.data.today.date} (parcial · Meta restate ~3d) vs ${tvyQ.data.yesterday.date} (cerrado)`}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <TodayVsYesterdayBox label="Inversión"
                    today={formatCurrency(tvyQ.data.today.spend)} yesterday={formatCurrency(tvyQ.data.yesterday.spend)}
                    delta={tvyQ.data.delta_pct.spend} invertDelta={false} />
                  <TodayVsYesterdayBox label="Impresiones"
                    today={formatNumber(tvyQ.data.today.impressions)} yesterday={formatNumber(tvyQ.data.yesterday.impressions)}
                    delta={tvyQ.data.delta_pct.impressions} invertDelta={false} />
                  <TodayVsYesterdayBox label="Clicks"
                    today={formatNumber(tvyQ.data.today.clicks)} yesterday={formatNumber(tvyQ.data.yesterday.clicks)}
                    delta={tvyQ.data.delta_pct.clicks} invertDelta={false} />
                  <TodayVsYesterdayBox label="CTR"
                    today={`${tvyQ.data.today.ctr.toFixed(2)}%`} yesterday={`${tvyQ.data.yesterday.ctr.toFixed(2)}%`} />
                  <TodayVsYesterdayBox label="CPC"
                    today={formatCurrency(tvyQ.data.today.cpc)} yesterday={formatCurrency(tvyQ.data.yesterday.cpc)} />
                </div>
              </Section>
            )}

            {/* ── Section 2: Impacto Unidrop (cross) ── */}
            {showCross && impQ.data && (
              <Section title="Impacto en UNIDROP" icon={Zap} subtitle="Spend × signups · suscripciones · revenue PaymentIntent · funnel"
                accent>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                  <KpiBoxCross icon={UserPlus} accent="emerald" label="Nuevos signups"
                    value={formatNumber(impQ.data.kpi.new_signups)}
                    hint={impQ.data.kpi.cac_dropshipper > 0 ? `CAC ${formatCurrency(impQ.data.kpi.cac_dropshipper)}/dropshipper` : "Sin CAC"} />
                  <KpiBoxCross icon={Repeat} accent="primary" label="Suscripciones nuevas"
                    value={formatNumber(impQ.data.kpi.new_subscriptions)}
                    hint={impQ.data.kpi.cac_subscripcion > 0 ? `CAC ${formatCurrency(impQ.data.kpi.cac_subscripcion)}/sub` : "Sin CAC"} />
                  <KpiBoxCross icon={DollarSign} accent="emerald" label="Revenue PaymentIntent"
                    value={formatCurrency(impQ.data.kpi.revenue_pi)}
                    hint={`${formatNumber(impQ.data.kpi.pi_count)} pagos PROCESSED`} />
                  <KpiBoxCross icon={TrendingUp} accent="amber" label="ROAS (gross)"
                    value={impQ.data.kpi.roas > 0 ? `${impQ.data.kpi.roas.toFixed(2)}x` : "—"}
                    hint={impQ.data.kpi.spend > 0 ? `${formatCurrency(impQ.data.kpi.revenue_pi)} / ${formatCurrency(impQ.data.kpi.spend)}` : "Sin spend"} />
                  <KpiBoxCross icon={Users} accent="primary" label="Conv click→signup"
                    value={impQ.data.kpi.clicks > 0 ? `${(impQ.data.kpi.new_signups / impQ.data.kpi.clicks * 100).toFixed(2)}%` : "—"}
                    hint={`${formatNumber(impQ.data.kpi.clicks)} → ${formatNumber(impQ.data.kpi.new_signups)}`} />
                </div>

                {/* Funnel */}
                <div className="bg-surface border border-border rounded-lg p-3 mb-4">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-3">Funnel de adquisición</div>
                  <div className="space-y-1.5">
                    {(() => {
                      const maxV = Math.max(1, ...impQ.data.funnel.map((s) => s.value));
                      return impQ.data.funnel.map((s, i) => (
                        <div key={s.step} className="flex items-center gap-3">
                          <div className="w-44 text-xs flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="font-semibold text-text">{s.step}</span>
                          </div>
                          <div className="flex-1 h-6 bg-soft rounded relative overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-primary/70 to-accent/70" style={{ width: `${(s.value / maxV) * 100}%` }} />
                            <div className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-bold tabular-nums text-text">{formatNumber(s.value)}</div>
                          </div>
                          <div className="w-20 text-right text-[10px] text-text-muted tabular-nums shrink-0">
                            {s.rate_from_prev !== null && s.rate_from_prev > 0 ? `${s.rate_from_prev.toFixed(2)}%` : ""}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* Visual overlay chart + KPI trends + dropshipper drill-down */}
                {impQ.data.daily.length > 0 && (
                  <div className="bg-surface border border-border rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-3">
                      Overlay diario · {impQ.data.daily.length} días
                    </div>
                    <MetaImpactChart
                      daily={impQ.data.daily}
                      campaigns={cpQ.data?.items ?? []}
                      period={period}
                    />
                  </div>
                )}
              </Section>
            )}

            {/* ── Section 3: Atribución de ventas (cross) ── */}
            {showCross && attrQ.data && (
              <Section title="Atribución de ventas" icon={ArrowUpRight} subtitle="Revenue del cohort firmado en el periodo + LTV inicial + activation rate">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                  <MiniStat label="Revenue total periodo" value={formatCurrency(attrQ.data.kpi.revenue_total)} hint={`${formatNumber(attrQ.data.kpi.pi_count_total)} pagos`} />
                  <MiniStat label="Revenue cohort" value={formatCurrency(attrQ.data.kpi.revenue_attributed)} hint={`${formatNumber(attrQ.data.kpi.pi_count_attributed)} pagos`} accent="emerald" />
                  <MiniStat label="% Atribución" value={`${attrQ.data.kpi.rev_attribution_pct.toFixed(1)}%`} hint="del revenue total" accent="primary" />
                  <MiniStat label="Activation rate" value={`${attrQ.data.kpi.activation_rate.toFixed(1)}%`}
                    hint={`${formatNumber(attrQ.data.kpi.users_with_revenue)} de ${formatNumber(attrQ.data.kpi.new_signups)} pagaron`}
                    accent="amber" />
                  <MiniStat label="LTV 30d (cohort)" value={formatCurrency(attrQ.data.kpi.ltv_first_30d)}
                    hint={`ROAS atribuido ${attrQ.data.kpi.roas_attributed.toFixed(2)}x`}
                    accent="emerald" />
                </div>
                <div className="text-[10px] text-text-muted">
                  Cohort = users creados en el periodo. Revenue = PaymentIntent PROCESSED en sus primeros 30 días. Atribución temporal (ventana de creación).
                </div>
              </Section>
            )}

            {/* ── Section 4: Retention cohort (cross) ── */}
            {showCross && retQ.data && (
              <Section title="Retention del cohort" icon={Users} subtitle="% del cohort firmado que sigue con subscription_status='active'">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <RetCard label="Cohort total" value={formatNumber(retQ.data.cohort_size)} pct={null} hint={`${formatNumber(retQ.data.active_now)} activos hoy (${retQ.data.activation_pct.toFixed(1)}%)`} />
                  <RetCard label="Retention 30d" value={`${retQ.data.retention_30d.pct.toFixed(1)}%`} pct={retQ.data.retention_30d.pct}
                    hint={`${formatNumber(retQ.data.retention_30d.active)} / ${formatNumber(retQ.data.retention_30d.cohort)}`} />
                  <RetCard label="Retention 60d" value={`${retQ.data.retention_60d.pct.toFixed(1)}%`} pct={retQ.data.retention_60d.pct}
                    hint={`${formatNumber(retQ.data.retention_60d.active)} / ${formatNumber(retQ.data.retention_60d.cohort)}`} />
                  <RetCard label="Retention 90d" value={`${retQ.data.retention_90d.pct.toFixed(1)}%`} pct={retQ.data.retention_90d.pct}
                    hint={`${formatNumber(retQ.data.retention_90d.active)} / ${formatNumber(retQ.data.retention_90d.cohort)}`} />
                </div>
              </Section>
            )}

            {/* ── Section 4b: MKT × UNIDROP — calidad del cohort semana a semana ── */}
            {showCross && mktQ.data && mktQ.data.weeks.length > 0 && (
              <Section title="MKT × UNIDROP · Calidad del cohort semana a semana"
                icon={Activity}
                subtitle={`${mktQ.data.weeks.length} semanas · ¿esta mejorando la calidad de lo adquirido?`}
                accent>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <MiniStat label="ROAS 30d (cohort)"
                    value={mktQ.data.summary.roas_30d > 0 ? `${mktQ.data.summary.roas_30d.toFixed(2)}x` : "—"}
                    hint={`${formatCurrency(mktQ.data.summary.rev_30d)} / ${formatCurrency(mktQ.data.summary.spend)}`}
                    accent="emerald" />
                  <MiniStat label="LTV 30d promedio"
                    value={formatCurrency(mktQ.data.summary.avg_ltv_30d)}
                    hint={`CAC signup ${formatCurrency(mktQ.data.summary.avg_cac_signup)}`}
                    accent="primary" />
                  <MiniStat label="Activation rate"
                    value={`${mktQ.data.summary.avg_activation_pct.toFixed(1)}%`}
                    hint={`${formatNumber(mktQ.data.summary.users_paid)} de ${formatNumber(mktQ.data.summary.signups)} pagaron`}
                    accent="amber" />
                  <MiniStat label="Retention to today"
                    value={`${mktQ.data.summary.avg_retention_pct.toFixed(1)}%`}
                    hint={`${formatNumber(mktQ.data.summary.active_now)} activos / ${formatNumber(mktQ.data.summary.signups)} cohort`}
                    accent="primary" />
                </div>
                <CohortWeeklyTable weeks={mktQ.data.weeks} />
              </Section>
            )}

            {/* ── Section 5: Top productos atribuidos (cross) ── */}
            {showCross && topQ.data && topQ.data.items.length > 0 && (
              <Section title="Top productos atribuidos al cohort" icon={ShoppingBag} subtitle="SKUs (ML + TN) vendidos por dropshippers firmados en el periodo · top 12 por revenue">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topQ.data.items.map((p) => (
                    <Link key={p.sku} href={`/dashboard/productos/${encodeURIComponent(p.sku)}`}
                      className="group bg-surface border border-border rounded-lg p-2 hover:border-primary/40 hover:shadow-md transition">
                      <div className="aspect-square bg-soft rounded mb-2 overflow-hidden">
                        {p.image
                          ? <img src={p.image} alt={p.title ?? p.sku} className="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />
                          : <div className="w-full h-full flex items-center justify-center text-text-muted text-[10px]">Sin foto</div>}
                      </div>
                      <div className="text-[9px] font-mono text-text-muted truncate">{p.sku}</div>
                      <div className="text-[11px] font-semibold text-text truncate">{p.title || "—"}</div>
                      <div className="text-[10px] mt-1 flex items-center justify-between">
                        <span className="tabular-nums text-text-muted">{p.qty} ud</span>
                        <span className="tabular-nums font-bold text-text">{formatCurrency(p.revenue)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Section 5b: Top Ads (creativos) ── */}
            {(topAdsQ.data?.items.length ?? 0) > 0 && (
              <Section title="Top Ads (creativos)" icon={Eye} subtitle={`${topAdsQ.data!.items.length} ads ordenados por spend en el periodo · que creativo funciona mejor`}>
                <TopAdsGrid items={topAdsQ.data!.items} />
              </Section>
            )}

            {/* ── Section 5c: Top Adsets ── */}
            {(topAdsetsQ.data?.items.length ?? 0) > 0 && (
              <Section title="Top Adsets" icon={Layers} subtitle={`${topAdsetsQ.data!.items.length} adsets · targeting + optimization goal + performance`}>
                <TopAdsetsTable items={topAdsetsQ.data!.items} />
              </Section>
            )}

            {/* ── Section 6: Audiencia (age + gender) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Audiencia · Edad" icon={Users} subtitle="Spend, clicks y CTR por rango etario">
                <BreakdownTable data={ageQ.data?.data ?? []} label="Edad" />
              </Section>
              <Section title="Audiencia · Género" icon={Users} subtitle="Distribución por género">
                <BreakdownTable data={genQ.data?.data ?? []} label="Género" />
              </Section>
            </div>

            {/* ── Section 7: Placement (publisher + position) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Plataforma" icon={Layers} subtitle="Facebook / Instagram / Audience Network / Messenger">
                <BreakdownTable data={platQ.data?.data ?? []} label="Plataforma" />
              </Section>
              <Section title="Posición" icon={Layers} subtitle="Feed / Stories / Reels / Marketplace …">
                <BreakdownTable data={posQ.data?.data ?? []} label="Posición" />
              </Section>
            </div>

            {/* ── Section 8: Device + Region ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Dispositivo" icon={Smartphone} subtitle="Mobile / Desktop">
                <BreakdownTable data={devQ.data?.data ?? []} label="Device" />
              </Section>
              <Section title="Top regiones (geo)" icon={MapPin} subtitle="Provincias / regiones que más impresiones reciben">
                <BreakdownTable data={regQ.data?.data ?? []} label="Región" maxRows={15} />
              </Section>
            </div>

            {/* ── Section 9: Hora del día ── */}
            {(hourQ.data?.data?.length ?? 0) > 0 && (
              <Section title="Hora del día" icon={Clock} subtitle="Cuándo se gasta vs cuándo convierte mejor (TZ cuenta publicitaria)">
                <HourlyChart data={hourQ.data!.data} />
              </Section>
            )}

            {/* ── Section 10: Daily spend ── */}
            {ov.daily.length > 0 && (
              <Section title="Inversión diaria" icon={DollarSign} subtitle={`${ov.daily.length} días con data`}>
                <div className="space-y-1">
                  {(() => {
                    const maxSpend = Math.max(1, ...ov.daily.map((d) => d.spend));
                    return ov.daily.slice(-30).map((d) => (
                      <div key={d.d} className="flex items-center gap-2">
                        <div className="w-16 text-[10px] text-text-muted font-mono shrink-0">{d.d.slice(5)}</div>
                        <div className="flex-1 h-5 bg-soft rounded relative overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${(d.spend / maxSpend) * 100}%` }} />
                        </div>
                        <div className="w-28 text-right text-[11px] font-bold tabular-nums shrink-0">{formatCurrency(d.spend)}</div>
                        <div className="w-20 text-right text-[10px] text-text-muted shrink-0">{formatNumber(d.clicks)} clk</div>
                      </div>
                    ));
                  })()}
                </div>
              </Section>
            )}

            {/* ── Section 10b: Spend pace por campaña activa ── */}
            {(paceQ.data?.items.length ?? 0) > 0 && (
              <Section title="Spend pace · campañas activas" icon={Target}
                subtitle={`Spend de hoy vs pace esperado (lineal por hora AR) · ${paceQ.data!.items.length} activas con daily_budget`}>
                <SpendPaceTable items={paceQ.data!.items} />
              </Section>
            )}

            {/* ── Section 11: Cuentas ── */}
            {ov.accounts.length > 0 && (
              <Section title="Cuentas publicitarias" icon={Layers}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ov.accounts.map((a) => (
                    <div key={a.id} className="bg-soft/40 border border-border rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-primary/10 text-primary border border-primary/20">{a.unit}</span>
                        <span className="text-[10px] text-text-muted font-mono">{a.id}</span>
                      </div>
                      <div className="text-sm font-bold text-text truncate">{a.name}</div>
                      <div className="text-lg font-extrabold text-text tabular-nums mt-1">{formatCurrency(a.spend)}</div>
                      <div className="text-[10px] text-text-muted">
                        {a.currency} · sync {a.last_synced_at ? fmtArDateTime(a.last_synced_at) : "nunca"}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Section 12: Campañas ── */}
            {(() => {
              const allCampaigns = cpQ.data?.items ?? [];
              const uniqueStatuses = Array.from(new Set(allCampaigns.map(c => (c.effective_status || c.status).toUpperCase()))).filter(Boolean);
              const uniqueObjectives = Array.from(new Set(allCampaigns.map(c => c.objective?.replace(/^OUTCOME_/, "") || ""))).filter(Boolean);
              const filtered = allCampaigns
                .filter(c => !cpStatus || (c.effective_status || c.status).toUpperCase() === cpStatus)
                .filter(c => !cpObjective || (c.objective?.replace(/^OUTCOME_/, "") || "") === cpObjective)
                .filter(c => !cpSearch || c.name.toLowerCase().includes(cpSearch.toLowerCase()))
                .sort((a, b) => {
                  const va = typeof a[cpSort.col] === "number" ? (a[cpSort.col] as number) : 0;
                  const vb = typeof b[cpSort.col] === "number" ? (b[cpSort.col] as number) : 0;
                  return cpSort.dir === "desc" ? vb - va : va - vb;
                });
              const totals = filtered.reduce(
                (acc, c) => ({ spend: acc.spend + c.spend, impressions: acc.impressions + c.impressions, clicks: acc.clicks + c.clicks }),
                { spend: 0, impressions: 0, clicks: 0 }
              );
              const tCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
              const tCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
              const tCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
              const sortToggle = (col: keyof MetaCampaign) =>
                setCpSort(s => s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
              const SortArrow = ({ col }: { col: keyof MetaCampaign }) => (
                <span className="ml-0.5 opacity-50">{cpSort.col === col ? (cpSort.dir === "desc" ? "↓" : "↑") : "↕"}</span>
              );
              return (
                <Section title="Campañas" icon={Target}
                  subtitle={`${filtered.length}${filtered.length !== allCampaigns.length ? ` de ${allCampaigns.length}` : ""} campañas · ${formatCurrency(totals.spend)} spend`}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <input type="text" placeholder="Buscar campaña…" value={cpSearch}
                      onChange={e => setCpSearch(e.target.value)}
                      className="px-2 py-1 text-xs border border-border rounded-lg bg-soft focus:outline-none focus:border-primary w-44" />
                    <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">
                      {["", ...uniqueStatuses].map(s => (
                        <button key={s} onClick={() => setCpStatus(s)}
                          className={"px-2 py-0.5 text-[10px] font-bold rounded-md transition " + (cpStatus === s ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                          {s || "Todos"}
                        </button>
                      ))}
                    </div>
                    {uniqueObjectives.length > 0 && (
                      <select value={cpObjective} onChange={e => setCpObjective(e.target.value)}
                        className="px-2 py-1 text-[10px] border border-border rounded-lg bg-soft focus:outline-none focus:border-primary">
                        <option value="">Todos los objetivos</option>
                        {uniqueObjectives.map(o => <option key={o} value={o}>{o.toLowerCase()}</option>)}
                      </select>
                    )}
                    {(cpSearch || cpStatus || cpObjective) && (
                      <button onClick={() => { setCpSearch(""); setCpStatus(""); setCpObjective(""); }}
                        className="px-2 py-0.5 text-[10px] text-text-muted hover:text-rose-600 border border-border rounded-lg bg-soft">
                        Limpiar
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-[560px] overflow-y-auto -mx-3">
                    <table className="w-full text-xs">
                      <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2">Campaña</th>
                          <th className="text-left px-2 py-2">Estado</th>
                          <th className="text-left px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("objective")}>Objetivo <SortArrow col="objective" /></th>
                          <th className="text-right px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("spend")}>Spend <SortArrow col="spend" /></th>
                          <th className="text-right px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("impressions")}>Impr <SortArrow col="impressions" /></th>
                          <th className="text-right px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("clicks")}>Clicks <SortArrow col="clicks" /></th>
                          <th className="text-right px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("cpm")}>CPM <SortArrow col="cpm" /></th>
                          <th className="text-right px-2 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("cpc")}>CPC <SortArrow col="cpc" /></th>
                          <th className="text-right px-3 py-2 cursor-pointer select-none hover:text-text"
                            onClick={() => sortToggle("ctr")}>CTR <SortArrow col="ctr" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr><td colSpan={9} className="text-center text-text-muted py-8">Sin campañas para los filtros aplicados</td></tr>
                        ) : (
                          <>
                            {filtered.map((c) => (
                              <tr key={c.id} className="border-t border-border hover:bg-soft/40">
                                <td className="px-3 py-2 max-w-[250px]">
                                  <div className="truncate font-semibold text-text" title={c.name}>{c.name}</div>
                                  <div className="text-[10px] text-text-muted">{c.account_name}</div>
                                </td>
                                <td className="px-2 py-2"><CampaignStatusBadge status={c.effective_status || c.status} /></td>
                                <td className="px-2 py-2 text-[10px] text-text-muted">{c.objective?.replace(/^OUTCOME_/, "").toLowerCase() || "—"}</td>
                                <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(c.spend)}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(c.impressions)}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{c.impressions > 0 ? formatCurrency(c.cpm) : "—"}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{c.clicks > 0 ? formatCurrency(c.cpc) : "—"}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{c.impressions > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-border bg-soft/70 font-bold text-text">
                              <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted" colSpan={3}>
                                Total · {filtered.length} campaña{filtered.length !== 1 ? "s" : ""}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(totals.spend)}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(totals.impressions)}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(totals.clicks)}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{tCpm > 0 ? formatCurrency(tCpm) : "—"}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{tCpc > 0 ? formatCurrency(tCpc) : "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{tCtr > 0 ? `${tCtr.toFixed(2)}%` : "—"}</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Section>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function Section({ title, subtitle, icon: Icon, children, accent }: {
  title: string;
  subtitle?: string;
  icon: typeof Eye;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={
      accent
        ? "bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-primary/20 rounded-xl p-4"
        : "bg-surface border border-border rounded-xl p-4"
    }>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon size={14} /></div>
        <div>
          <h2 className="text-sm font-bold text-text">{title}</h2>
          {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function KpiHero({ icon: Icon, label, value, hint, delta }: {
  icon: typeof Eye; label: string; value: string; hint: string; delta?: number;
}) {
  const showDelta = delta !== undefined && Number.isFinite(delta);
  const up = showDelta && (delta ?? 0) >= 0;
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-md">
          <Icon size={14} />
        </div>
      </div>
      <div className="text-xl font-extrabold text-text tabular-nums truncate">{value}</div>
      <div className="text-[10px] text-text-muted mt-1 flex items-center gap-1.5">
        {showDelta && (
          <span className={"inline-flex items-center gap-0.5 font-bold tabular-nums " + (up ? "text-emerald-600" : "text-rose-600")}>
            {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {Math.abs(delta!).toFixed(1)}%
          </span>
        )}
        <span className="truncate">{hint}</span>
      </div>
    </div>
  );
}

function KpiBoxCross({ icon: Icon, label, value, hint, accent }: {
  icon: typeof Eye; label: string; value: string; hint: string;
  accent: "primary" | "emerald" | "amber";
}) {
  const accents: Record<"primary" | "emerald" | "amber", string> = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
  };
  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="flex items-start justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-7 h-7 rounded-md bg-gradient-to-br ${accents[accent]} text-white flex items-center justify-center shadow-sm`}>
          <Icon size={12} />
        </div>
      </div>
      <div className="text-lg font-extrabold text-text tabular-nums truncate">{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 truncate">{hint}</div>
    </div>
  );
}

function MiniStat({ label, value, hint, accent }: {
  label: string; value: string; hint: string; accent?: "primary" | "emerald" | "amber";
}) {
  const accentCls = accent === "emerald" ? "text-emerald-600" : accent === "primary" ? "text-primary" : accent === "amber" ? "text-amber-600" : "text-text";
  return (
    <div className="bg-soft/40 border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums truncate ${accentCls}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 truncate">{hint}</div>
    </div>
  );
}

function RetCard({ label, value, hint, pct }: {
  label: string; value: string; hint: string; pct: number | null;
}) {
  const tone = pct === null ? "text-text" : pct >= 60 ? "text-emerald-600" : pct >= 30 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>
      {pct !== null && (
        <div className="mt-2 h-1.5 bg-soft rounded overflow-hidden">
          <div className={"h-full " + (pct >= 60 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-500" : "bg-rose-500")}
            style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ data, label, maxRows = 10 }: {
  data: BreakdownResp["data"];
  label: string;
  maxRows?: number;
}) {
  if (!data || data.length === 0) {
    return <div className="text-xs text-text-muted py-4 text-center">Sin breakdown sincronizado. Usá "Sync breakdowns" arriba.</div>;
  }
  const top = data.slice(0, maxRows);
  const maxSpend = Math.max(1, ...top.map((r) => r.spend));
  return (
    <table className="w-full text-xs">
      <thead className="text-text-muted text-[10px] uppercase tracking-wider">
        <tr className="border-b border-border">
          <th className="text-left py-1 pr-2">{label}</th>
          <th className="text-right py-1 px-2">Spend</th>
          <th className="text-right py-1 px-2">Clicks</th>
          <th className="text-right py-1 pl-2">CTR</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.key} className="border-b border-border/60">
            <td className="py-1.5 pr-2">
              <div className="flex items-center gap-2">
                <span className="text-text font-semibold w-24 truncate">{r.key || "—"}</span>
                <div className="flex-1 h-1.5 bg-soft rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${(r.spend / maxSpend) * 100}%` }} />
                </div>
              </div>
            </td>
            <td className="py-1.5 px-2 text-right tabular-nums font-bold">{formatCurrency(r.spend)}</td>
            <td className="py-1.5 px-2 text-right tabular-nums">{formatNumber(r.clicks)}</td>
            <td className="py-1.5 pl-2 text-right tabular-nums">{r.ctr > 0 ? `${r.ctr.toFixed(2)}%` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HourlyChart({ data }: { data: HourlyResp["data"] }) {
  // Mostrar 24 horas (0-23). Si data viene como "00:00 - 01:00" tomamos hora inicial.
  const byHour = new Map<number, { spend: number; clicks: number; ctr: number; cpc: number }>();
  for (const r of data) {
    const m = r.hour.match(/^(\d{1,2})/);
    if (!m) continue;
    const h = parseInt(m[1], 10);
    const e = byHour.get(h) ?? { spend: 0, clicks: 0, ctr: 0, cpc: 0 };
    e.spend += r.spend;
    e.clicks += r.clicks;
    byHour.set(h, e);
  }
  const hours = Array.from({ length: 24 }, (_, h) => ({
    h,
    spend: byHour.get(h)?.spend ?? 0,
    clicks: byHour.get(h)?.clicks ?? 0,
  }));
  const maxSpend = Math.max(1, ...hours.map((x) => x.spend));
  const maxClicks = Math.max(1, ...hours.map((x) => x.clicks));
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-text-muted mb-1">
        <Legend color="bg-primary" label="Spend" /> · <Legend color="bg-emerald-500" label="Clicks" />
      </div>
      {hours.map(({ h, spend, clicks }) => (
        <div key={h} className="flex items-center gap-2">
          <div className="w-8 text-[10px] text-text-muted font-mono shrink-0">{String(h).padStart(2, "0")}h</div>
          <div className="flex-1 grid grid-cols-2 gap-1">
            <div className="h-3.5 bg-soft rounded relative overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(spend / maxSpend) * 100}%` }} />
            </div>
            <div className="h-3.5 bg-soft rounded relative overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${(clicks / maxClicks) * 100}%` }} />
            </div>
          </div>
          <div className="w-40 text-right text-[10px] text-text-muted shrink-0 tabular-nums">
            {formatCurrency(spend)} · {formatNumber(clicks)} clk
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${color} inline-block`} /> {label}</span>;
}

function FreshnessPill({ lastSyncedAt, isSyncing }: { lastSyncedAt: string | null; isSyncing: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!lastSyncedAt) {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50" /> Sin sync aun
      </span>
    );
  }
  const ageMs = now - new Date(lastSyncedAt).getTime();
  const ageMin = Math.max(0, Math.floor(ageMs / 60_000));
  const tone = ageMin <= 70 ? "emerald" : ageMin <= 180 ? "amber" : "rose";
  const dotCls = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  const txtCls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  const label = ageMin < 1 ? "hace menos de 1 min"
    : ageMin < 60 ? `hace ${ageMin} min`
    : `hace ${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
  return (
    <span className={`ml-2 inline-flex items-center gap-1.5 text-[10px] font-semibold ${txtCls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls} ${isSyncing ? "animate-pulse" : ""}`} />
      Última sync {label} · auto cada 1h
    </span>
  );
}

function TodayVsYesterdayBox({ label, today, yesterday, delta, invertDelta }: {
  label: string; today: string; yesterday: string; delta?: number; invertDelta?: boolean;
}) {
  const hasDelta = delta !== undefined && Number.isFinite(delta);
  const up = hasDelta && (delta ?? 0) >= 0;
  const isGood = invertDelta ? !up : up;
  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-lg font-extrabold tabular-nums text-text">{today}</div>
        {hasDelta && (
          <span className={"text-[10px] font-bold tabular-nums inline-flex items-center " + (isGood ? "text-emerald-600" : "text-rose-600")}>
            {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {Math.abs(delta!).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">vs ayer: {yesterday}</div>
    </div>
  );
}

function TopAdsGrid({ items }: { items: TopAdsResp["items"] }) {
  if (!items?.length) return null;
  const maxSpend = Math.max(1, ...items.map(i => i.spend));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((ad) => (
        <div key={ad.id} className="bg-surface border border-border rounded-lg p-3 hover:border-primary/40 transition flex flex-col">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CampaignStatusBadge status={ad.effective_status || ad.status || "—"} />
            <span className="text-[9px] text-text-muted font-mono">{ad.id}</span>
          </div>
          <div className="font-semibold text-text text-xs truncate" title={ad.name}>{ad.name}</div>
          {ad.creative_summary && (
            <div className="text-[10px] text-text-muted mt-1 line-clamp-2" title={ad.creative_summary}>{ad.creative_summary}</div>
          )}
          <div className="mt-2 h-1.5 bg-soft rounded overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${(ad.spend / maxSpend) * 100}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] tabular-nums">
            <div>
              <div className="text-text-muted">Spend</div>
              <div className="font-bold text-text">{formatCurrency(ad.spend)}</div>
            </div>
            <div>
              <div className="text-text-muted">CTR</div>
              <div className="font-bold text-text">{ad.impressions > 0 ? `${(ad.clicks / ad.impressions * 100).toFixed(2)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-text-muted">CPC</div>
              <div className="font-bold text-text">{ad.clicks > 0 ? formatCurrency(ad.spend / ad.clicks) : "—"}</div>
            </div>
          </div>
          {ad.preview_url && (
            <a href={ad.preview_url} target="_blank" rel="noreferrer"
              className="mt-2 text-[10px] text-primary hover:underline inline-flex items-center gap-1">
              Ver preview en Meta <ArrowUpRight size={10} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function TopAdsetsTable({ items }: { items: TopAdsetsResp["items"] }) {
  if (!items?.length) return null;
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-xs">
        <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Adset</th>
            <th className="text-left px-2 py-2">Estado</th>
            <th className="text-left px-2 py-2">Targeting</th>
            <th className="text-left px-2 py-2">Goal · Billing</th>
            <th className="text-right px-2 py-2">Daily budget</th>
            <th className="text-right px-2 py-2">Spend</th>
            <th className="text-right px-2 py-2">Impr</th>
            <th className="text-right px-2 py-2">Clicks</th>
            <th className="text-right px-2 py-2">CTR</th>
            <th className="text-right px-3 py-2">CPC</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-border hover:bg-soft/40">
              <td className="px-3 py-2 max-w-[260px] truncate font-semibold text-text" title={s.name}>{s.name}</td>
              <td className="px-2 py-2"><CampaignStatusBadge status={s.effective_status || s.status || "—"} /></td>
              <td className="px-2 py-2 text-[10px] text-text-muted max-w-[200px] truncate" title={s.targeting_summary ?? ""}>{s.targeting_summary || "—"}</td>
              <td className="px-2 py-2 text-[10px] text-text-muted">
                {(s.optimization_goal || "—").toLowerCase()}<br />
                <span className="text-[9px]">{(s.billing_event || "").toLowerCase()}</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{s.daily_budget ? formatCurrency(s.daily_budget) : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(s.spend)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.impressions)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.clicks)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{s.impressions > 0 ? `${(s.clicks / s.impressions * 100).toFixed(2)}%` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.clicks > 0 ? formatCurrency(s.spend / s.clicks) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpendPaceTable({ items }: { items: SpendPaceItem[] }) {
  if (!items?.length) return <div className="text-xs text-text-muted py-4 text-center">Sin campañas activas con daily_budget</div>;
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-xs">
        <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Campaña</th>
            <th className="text-right px-2 py-2">Daily budget</th>
            <th className="text-right px-2 py-2">Spend hoy</th>
            <th className="text-right px-2 py-2">Pace esperado</th>
            <th className="text-left px-3 py-2">% día consumido · esperado</th>
            <th className="text-right px-3 py-2">Δ vs pace</th>
            <th className="text-right px-3 py-2">Ayer</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const tone = Math.abs(c.delta_pct) <= 15 ? "emerald" : Math.abs(c.delta_pct) <= 35 ? "amber" : "rose";
            const cls = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
            const barCls = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
            const sign = c.delta_pct > 0 ? "+" : "";
            return (
              <tr key={c.id} className="border-t border-border hover:bg-soft/40">
                <td className="px-3 py-2 max-w-[260px] truncate font-semibold text-text" title={c.name ?? ""}>{c.name ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(c.daily_budget)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(c.spend_today)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-text-muted">{formatCurrency(c.expected_now)}</td>
                <td className="px-3 py-2 min-w-[180px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative h-2 bg-soft rounded overflow-hidden">
                      {/* expected marker */}
                      <div className="absolute top-0 left-0 h-full bg-zinc-300/70" style={{ width: `${Math.min(100, c.expected_pct)}%` }} />
                      <div className={"absolute top-0 left-0 h-full " + barCls} style={{ width: `${Math.min(100, c.pace_pct)}%`, opacity: 0.85 }} />
                    </div>
                    <span className={"text-[10px] tabular-nums font-bold " + cls}>{c.pace_pct.toFixed(0)}%</span>
                    <span className="text-[9px] tabular-nums text-text-muted">esp {c.expected_pct.toFixed(0)}%</span>
                  </div>
                </td>
                <td className={"px-3 py-2 text-right tabular-nums font-bold " + cls}>{sign}{c.delta_pct.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-muted">{formatCurrency(c.spend_yesterday)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-text-muted mt-2 px-3">
        Pace lineal: a las 12:00 AR se espera consumir 50% del daily_budget. Δ {">"} 35% = overspend / underdelivery atencion.
      </div>
    </div>
  );
}

function CohortWeeklyTable({ weeks }: { weeks: MktUnidropRelationship["weeks"] }) {
  if (!weeks?.length) return null;
  const maxLtv = Math.max(1, ...weeks.map(w => w.ltv_first_30d));
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-xs">
        <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Semana</th>
            <th className="text-right px-2 py-2">Spend</th>
            <th className="text-right px-2 py-2">Clicks</th>
            <th className="text-right px-2 py-2">Signups</th>
            <th className="text-right px-2 py-2">Subs</th>
            <th className="text-right px-2 py-2">CAC signup</th>
            <th className="text-right px-2 py-2">CAC sub</th>
            <th className="text-right px-2 py-2">Activation%</th>
            <th className="text-right px-2 py-2">LTV 30d</th>
            <th className="text-right px-3 py-2">Retention now</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week_start} className="border-t border-border hover:bg-soft/40">
              <td className="px-3 py-2 font-semibold text-text font-mono tabular-nums">{w.week_start}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(w.spend)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(w.clicks)}</td>
              <td className="px-2 py-2 text-right tabular-nums font-bold">{formatNumber(w.signups)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(w.subs)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{w.cac_signup > 0 ? formatCurrency(w.cac_signup) : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{w.cac_sub > 0 ? formatCurrency(w.cac_sub) : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{w.activation_pct.toFixed(1)}%</td>
              <td className="px-2 py-2 text-right">
                <div className="flex items-center gap-2 justify-end">
                  <div className="w-16 h-1.5 bg-soft rounded overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500"
                      style={{ width: `${(w.ltv_first_30d / maxLtv) * 100}%` }} />
                  </div>
                  <span className="tabular-nums font-bold text-text w-16 text-right">{formatCurrency(w.ltv_first_30d)}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span className={w.retention_pct >= 60 ? "text-emerald-600" : w.retention_pct >= 30 ? "text-amber-600" : "text-rose-600"}>
                  {w.retention_pct.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-text-muted mt-2 px-3">
        Cohort = users con createdAt en la semana. LTV 30d = revenue PI PROCESSED en primeros 30d / cohort_size.
        Retention now = % con subscription_status=&apos;active&apos; HOY. Comparar tendencia entre semanas para detectar deterioro de calidad.
      </div>
    </div>
  );
}

function SyncRunCard({ run, onDismiss }: { run: SyncRun | undefined; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const isLive = run?.status === "pending" || run?.status === "running";
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [isLive]);

  if (!run) return null;

  const startedMs = new Date(run.started_at).getTime();
  const endedMs = run.finished_at ? new Date(run.finished_at).getTime() : now;
  const elapsedSec = Math.max(0, Math.round((endedMs - startedMs) / 1000));
  const mm = Math.floor(elapsedSec / 60);
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  const kindLabel = run.kind === "sync_all" ? "Sync core (campaigns + insights)" : "Sync breakdowns";

  if (run.status === "pending" || run.status === "running") {
    return (
      <div className="bg-primary/5 border border-primary/30 rounded-lg px-3 py-2.5 text-xs mb-4 flex items-center gap-3">
        <RefreshCw size={14} className="animate-spin text-primary shrink-0" />
        <div className="flex-1">
          <div className="font-bold text-text">
            {kindLabel} en progreso · {run.historical_days ?? "?"}d
          </div>
          <div className="text-[10px] text-text-muted">
            Run #{run.id} · {run.status === "pending" ? "esperando arranque" : "corriendo"} · {elapsed} transcurridos
            {run.started_by_email ? ` · ${run.started_by_email}` : ""}
          </div>
        </div>
        <span className="text-[10px] text-text-muted tabular-nums">refresh 3s</span>
      </div>
    );
  }

  if (run.status === "error") {
    return (
      <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2.5 text-xs mb-4 flex items-start gap-2">
        <XCircle size={14} className="shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-bold">
            {kindLabel} falló · Run #{run.id} · {elapsed}
          </div>
          <div className="text-[10px] mt-0.5 break-words">{run.error || "Error desconocido"}</div>
        </div>
        <button onClick={onDismiss} className="text-rose-500 hover:text-rose-700 text-[11px]">cerrar</button>
      </div>
    );
  }

  // done
  const sum = run.summary;
  return (
    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2.5 text-xs mb-4 flex items-start gap-2">
      <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-bold">
          {kindLabel} OK · Run #{run.id} · {elapsed}
        </div>
        <div className="text-[10px] mt-0.5">
          {sum && "accounts" in sum && Array.isArray(sum.accounts) ? (
            run.kind === "sync_all" ? (
              (sum as SyncAllSummary).accounts.map(a => (
                <span key={a.id} className="inline-block mr-2">
                  {a.name}: {a.campaigns} camp · {a.ads} ads · {a.insights} insights
                  {a.error ? <span className="text-rose-600"> ⚠ {a.error.slice(0, 60)}</span> : ""}
                </span>
              ))
            ) : (
              (sum as SyncBreakdownsSummary).accounts.map(a => (
                <span key={a.id} className="inline-block mr-2">
                  {a.name}: {Object.entries(a.rows).map(([k, v]) => `${k}=${v}`).join(" · ")}
                  {a.error ? <span className="text-rose-600"> ⚠</span> : ""}
                </span>
              ))
            )
          ) : <span>Sin detalle</span>}
        </div>
      </div>
      <button onClick={onDismiss} className="text-emerald-600 hover:text-emerald-800 text-[11px]">cerrar</button>
    </div>
  );
}

function SyncRunRow({ run, active, onSelect }: { run: SyncRun; active: boolean; onSelect: () => void }) {
  const startedMs = new Date(run.started_at).getTime();
  const endedMs = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
  const elapsedSec = Math.max(0, Math.round((endedMs - startedMs) / 1000));
  const mm = Math.floor(elapsedSec / 60);
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const elapsed = mm > 0 ? `${mm}m${ss}s` : `${ss}s`;
  const icon = run.status === "done" ? <CheckCircle2 size={11} className="text-emerald-600" />
    : run.status === "error" ? <XCircle size={11} className="text-rose-600" />
    : <RefreshCw size={11} className="text-primary animate-spin" />;
  return (
    <button onClick={onSelect}
      className={"w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] hover:bg-soft/60 transition text-left " + (active ? "bg-primary/5" : "")}>
      {icon}
      <span className="font-mono text-text-muted w-10 shrink-0">#{run.id}</span>
      <span className="font-semibold text-text w-32 shrink-0 truncate">
        {run.kind === "sync_all" ? "core" : "breakdowns"} · {run.historical_days ?? "?"}d
      </span>
      <span className="text-text-muted flex-1 truncate">{fmtArDateTime(run.started_at)}</span>
      <span className="text-text-muted tabular-nums shrink-0">{elapsed}</span>
      {run.started_by_email && <span className="text-text-muted truncate max-w-[140px] shrink-0">{run.started_by_email}</span>}
    </button>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s.includes("active") ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s.includes("paused") ? "bg-amber-50 text-amber-700 border-amber-200"
    : s.includes("delet") || s.includes("archiv") ? "bg-zinc-50 text-zinc-500 border-zinc-200"
    : "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>{status}</span>;
}
