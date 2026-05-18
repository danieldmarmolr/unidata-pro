"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import {
  ArrowLeft, DollarSign, Eye, MousePointerClick, Target, TrendingUp,
  RefreshCw, AlertTriangle, Users, UserPlus, Repeat, Zap, Clock, MapPin,
  Smartphone, Layers, ArrowUpRight, ArrowDownRight, ShoppingBag, Activity,
} from "lucide-react";

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
  const [unit, setUnit] = useState<"" | "unistore" | "unidrop" | "unidev">("");
  const [cpSort, setCpSort] = useState<{ col: keyof MetaCampaign; dir: "asc" | "desc" }>({ col: "spend", dir: "desc" });
  const [cpStatus, setCpStatus] = useState("");
  const [cpObjective, setCpObjective] = useState("");
  const [cpSearch, setCpSearch] = useState("");
  const qc = useQueryClient();
  const showCross = !unit || unit === "unidrop";
  const qsBase = `period=${period}${unit ? `&unit=${unit}` : ""}`;

  const ovQ = useQuery<MetaOverview>({
    queryKey: ["meta-overview", period, unit],
    queryFn: () => api(`/api/marketing/meta/overview?${qsBase}`),
    staleTime: 60_000,
  });
  const cpQ = useQuery<{ items: MetaCampaign[]; count: number }>({
    queryKey: ["meta-campaigns", period, unit],
    queryFn: () => api(`/api/marketing/meta/campaigns?${qsBase}&limit=200`),
    staleTime: 60_000,
  });
  const impQ = useQuery<MetaImpact>({
    queryKey: ["meta-impact", period],
    queryFn: () => api(`/api/marketing/meta/unidrop-impact?period=${period}`),
    staleTime: 60_000,
    enabled: showCross,
  });
  const stQ = useQuery<SameTime>({
    queryKey: ["meta-same-time", period, unit],
    queryFn: () => api(`/api/marketing/meta/same-time?${qsBase}`),
    staleTime: 60_000,
  });
  const ageQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "age", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=age&${qsBase}`),
    staleTime: 60_000,
  });
  const genQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "gender", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=gender&${qsBase}`),
    staleTime: 60_000,
  });
  const platQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "publisher_platform", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=publisher_platform&${qsBase}`),
    staleTime: 60_000,
  });
  const posQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "platform_position", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=platform_position&${qsBase}`),
    staleTime: 60_000,
  });
  const devQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "device_platform", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=device_platform&${qsBase}`),
    staleTime: 60_000,
  });
  const regQ = useQuery<BreakdownResp>({
    queryKey: ["meta-bk", "region", period, unit],
    queryFn: () => api(`/api/marketing/meta/breakdown?type=region&${qsBase}&limit=15`),
    staleTime: 60_000,
  });
  const hourQ = useQuery<HourlyResp>({
    queryKey: ["meta-hourly", period, unit],
    queryFn: () => api(`/api/marketing/meta/hourly?${qsBase}`),
    staleTime: 60_000,
  });
  const attrQ = useQuery<Attribution>({
    queryKey: ["meta-attr", period],
    queryFn: () => api(`/api/marketing/meta/sales-attribution?period=${period}`),
    staleTime: 60_000,
    enabled: showCross,
  });
  const retQ = useQuery<CohortRet>({
    queryKey: ["meta-ret", period],
    queryFn: () => api(`/api/marketing/meta/cohort-retention?period=${period === "7d" ? "30d" : period}`),
    staleTime: 60_000,
    enabled: showCross,
  });
  const topQ = useQuery<TopProducts>({
    queryKey: ["meta-top-products", period],
    queryFn: () => api(`/api/marketing/meta/top-products?period=${period}&limit=12`),
    staleTime: 60_000,
    enabled: showCross,
  });

  type SyncResult = { ok: boolean; accounts?: { id: string; name: string; campaigns: number; ads: number; insights: number; error: string | null }[] };
  const syncMut = useMutation<SyncResult, Error, number>({
    mutationFn: (historicalDays: number) =>
      api<SyncResult>(`/api/marketing/meta/sync?historical_days=${historicalDays}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta-overview"] });
      qc.invalidateQueries({ queryKey: ["meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["meta-impact"] });
      qc.invalidateQueries({ queryKey: ["meta-same-time"] });
    },
  });
  type BkSyncResult = { ok: boolean; accounts?: { id: string; name: string; rows: Record<string, number>; error: string | null }[] };
  const bkSyncMut = useMutation<BkSyncResult, Error, number>({
    mutationFn: (historicalDays: number) =>
      api<BkSyncResult>(`/api/marketing/meta/sync-breakdowns?historical_days=${historicalDays}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta-bk"] });
      qc.invalidateQueries({ queryKey: ["meta-hourly"] });
    },
  });

  const ov = ovQ.data;
  const isEmpty = !ovQ.isLoading && (!ov || ov.kpi.spend === 0);

  return (
    <>
      <Topbar title="Meta Ads · Comando central" subtitle="Performance, audiencia, atribución y orquestación cross-area" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
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
            {[
              { v: "", l: "Todas" },
              { v: "unistore", l: "Unistore" },
              { v: "unidrop", l: "Unidrop" },
              { v: "unidev", l: "Unidev" },
            ].map((u) => (
              <button key={u.v} onClick={() => setUnit(u.v as "" | "unistore" | "unidrop" | "unidev")}
                className={"px-3 py-1 text-xs font-bold rounded-md transition " + (unit === u.v ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                {u.l}
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <button onClick={() => syncMut.mutate(30)} disabled={syncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5 disabled:opacity-50">
                <RefreshCw size={12} className={syncMut.isPending ? "animate-spin" : ""} /> Sync 30d
              </button>
              <button onClick={() => bkSyncMut.mutate(30)} disabled={bkSyncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-accent/40 text-accent text-xs font-semibold hover:bg-accent/5 disabled:opacity-50">
                <RefreshCw size={12} className={bkSyncMut.isPending ? "animate-spin" : ""} /> Sync breakdowns
              </button>
              <button onClick={() => { if (confirm("Pull histórico 12m. Tarda ~5-10 min. ¿Continuar?")) syncMut.mutate(365); }}
                disabled={syncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50">
                <RefreshCw size={12} /> Backfill 12m
              </button>
            </div>
          )}
        </div>

        {syncMut.isError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs mb-4">
            Sync falló: {(syncMut.error as Error)?.message}
          </div>
        )}
        {syncMut.isSuccess && syncMut.data && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-xs mb-4">
            Sync OK · {syncMut.data.accounts?.map((a) => `${a.campaigns} camp · ${a.ads} ads · ${a.insights} insights`).join(" | ")}
          </div>
        )}
        {bkSyncMut.isSuccess && bkSyncMut.data && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-xs mb-4">
            Breakdowns OK · {bkSyncMut.data.accounts?.map((a) => `${a.name}: ${Object.entries(a.rows).map(([k,v]) => `${k}=${v}`).join(" · ")}`).join(" | ")}
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

                {/* Daily overlay 3-col con valores y KPIs derivados */}
                {impQ.data.daily.length > 0 && (
                  <div className="bg-surface border border-border rounded-lg p-3">
                    <div className="mb-2 flex items-center justify-between flex-wrap gap-1">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Overlay diario · últimos 30 días</div>
                        <p className="text-[10px] text-text-muted">
                          <Legend color="bg-primary" label="Spend" /> · <Legend color="bg-emerald-500" label="Signups" /> · <Legend color="bg-amber-500" label="Revenue" />
                        </p>
                      </div>
                      <div className="text-[9px] text-text-muted flex gap-3">
                        <span className="font-bold text-rose-500">CAC</span>
                        <span className="font-bold text-emerald-600">ROAS</span>
                        <span className="font-bold text-text-muted">Conv%</span>
                      </div>
                    </div>
                    {(() => {
                      const last30 = impQ.data!.daily.slice(-30);
                      const maxSpend = Math.max(1, ...last30.map((d) => d.spend));
                      const maxSign = Math.max(1, ...last30.map((d) => d.signups));
                      const maxRev = Math.max(1, ...last30.map((d) => d.revenue));
                      return (
                        <div className="space-y-0.5">
                          {last30.map((d) => {
                            const cac = d.signups > 0 ? d.spend / d.signups : 0;
                            const roas = d.spend > 0 ? d.revenue / d.spend : 0;
                            const conv = d.clicks > 0 ? (d.signups / d.clicks) * 100 : 0;
                            const spendPct = d.spend / maxSpend;
                            const signPct = maxSign > 0 ? d.signups / maxSign : 0;
                            const revPct = d.revenue / maxRev;
                            return (
                              <div key={d.d} className="flex items-center gap-2">
                                <div className="w-10 text-[9px] text-text-muted font-mono shrink-0">{d.d.slice(5)}</div>
                                <div className="flex-1 grid grid-cols-3 gap-1">
                                  <div className="h-5 bg-soft rounded relative overflow-hidden">
                                    <div className="h-full bg-primary transition-all" style={{ width: `${spendPct * 100}%` }} />
                                    <div className="absolute inset-0 flex items-center px-1">
                                      <span className="text-[9px] font-bold tabular-nums truncate"
                                        style={{ color: spendPct > 0.35 ? "white" : "var(--color-text-muted)" }}>
                                        {formatCurrency(d.spend)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-5 bg-soft rounded relative overflow-hidden">
                                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${signPct * 100}%` }} />
                                    <div className="absolute inset-0 flex items-center px-1">
                                      <span className="text-[9px] font-bold tabular-nums"
                                        style={{ color: signPct > 0.35 ? "white" : "var(--color-text-muted)" }}>
                                        {d.signups} sign
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-5 bg-soft rounded relative overflow-hidden">
                                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${revPct * 100}%` }} />
                                    <div className="absolute inset-0 flex items-center px-1">
                                      <span className="text-[9px] font-bold tabular-nums truncate"
                                        style={{ color: revPct > 0.35 ? "white" : "var(--color-text-muted)" }}>
                                        {formatCurrency(d.revenue)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="w-48 text-right text-[9px] shrink-0 tabular-nums flex gap-1 justify-end items-center">
                                  <span className={cac > 0 ? "text-rose-600 font-semibold" : "text-text-muted"}>
                                    {cac > 0 ? formatCurrency(cac) : "—"}
                                  </span>
                                  <span className="text-border">·</span>
                                  <span className={roas > 0 ? "text-emerald-600 font-semibold" : "text-text-muted"}>
                                    {roas > 0 ? `${roas.toFixed(2)}x` : "—"}
                                  </span>
                                  <span className="text-border">·</span>
                                  <span className="text-text-muted">
                                    {conv > 0 ? `${conv.toFixed(2)}%` : "—"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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

function CampaignStatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s.includes("active") ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s.includes("paused") ? "bg-amber-50 text-amber-700 border-amber-200"
    : s.includes("delet") || s.includes("archiv") ? "bg-zinc-50 text-zinc-500 border-zinc-200"
    : "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>{status}</span>;
}
