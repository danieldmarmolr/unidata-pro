"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import {
  ArrowLeft, DollarSign, Eye, MousePointerClick, Target, TrendingUp,
  RefreshCw, Megaphone, ChevronRight, ChevronDown, ExternalLink, AlertTriangle,
} from "lucide-react";

type MetaOverview = {
  kpi: {
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    active_campaigns: number;
    cpm: number;
    cpc: number;
    ctr: number;
  };
  daily: { d: string; spend: number; impressions: number; clicks: number }[];
  accounts: {
    id: string; name: string; currency: string; unit: string;
    last_synced_at: string | null; spend: number;
  }[];
  period: string;
  unit: string | null;
};

type MetaCampaign = {
  id: string;
  name: string;
  objective: string | null;
  status: string;
  effective_status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  unit: string;
  account_name: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
  ctr: number;
};

const PERIOD_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "12 meses" },
];

export default function MetaAdsPage() {
  const me = getUser();
  const isAdmin = !!me?.is_admin || me?.role === "admin";
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "1y">("30d");
  const [unit, setUnit] = useState<"" | "unistore" | "unidrop" | "unidev">("");
  const qc = useQueryClient();

  const ovQ = useQuery<MetaOverview>({
    queryKey: ["meta-overview", period, unit],
    queryFn: () => api(`/api/marketing/meta/overview?period=${period}${unit ? `&unit=${unit}` : ""}`),
    staleTime: 60_000,
  });
  const cpQ = useQuery<{ items: MetaCampaign[]; count: number }>({
    queryKey: ["meta-campaigns", period, unit],
    queryFn: () => api(`/api/marketing/meta/campaigns?period=${period}${unit ? `&unit=${unit}` : ""}&limit=200`),
    staleTime: 60_000,
  });

  type SyncResult = { ok: boolean; accounts?: { id: string; name: string; campaigns: number; ads: number; insights: number; error: string | null }[] };
  const syncMut = useMutation<SyncResult, Error, number>({
    mutationFn: (historicalDays: number) =>
      api<SyncResult>(`/api/marketing/meta/sync?historical_days=${historicalDays}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta-overview"] });
      qc.invalidateQueries({ queryKey: ["meta-campaigns"] });
    },
  });

  const ov = ovQ.data;
  const isEmpty = !ovQ.isLoading && (!ov || ov.kpi.spend === 0);

  return (
    <>
      <Topbar title="Meta Ads" subtitle="Spend + impressions + clicks · Facebook Marketing API" />
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
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => syncMut.mutate(30)}
                disabled={syncMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5 disabled:opacity-50">
                <RefreshCw size={12} className={syncMut.isPending ? "animate-spin" : ""} /> Sync ahora
              </button>
              <button
                onClick={() => {
                  if (confirm("Pull histórico de 12 meses. Puede tardar ~5-10 min. ¿Continuar?")) {
                    syncMut.mutate(365);
                  }
                }}
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

        {/* Empty state */}
        {isEmpty && !ovQ.isLoading && (
          <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-6 text-center">
            <AlertTriangle size={32} className="text-amber-600 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-amber-900 mb-1">Sin datos de Meta Ads todavía</h3>
            <p className="text-xs text-amber-800/80 mb-4">
              Si esta es la primera vez, hacé click en <strong>"Backfill 12m"</strong> arriba para traer histórico.
              Después el cron diario se encarga del refresh.
            </p>
            {isAdmin && (
              <button
                onClick={() => syncMut.mutate(365)}
                disabled={syncMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold shadow disabled:opacity-50">
                <RefreshCw size={12} className={syncMut.isPending ? "animate-spin" : ""} />
                {syncMut.isPending ? "Sincronizando..." : "Hacer backfill 12 meses"}
              </button>
            )}
          </div>
        )}

        {!isEmpty && ov && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
              <KpiCard icon={DollarSign} label="Inversión" value={formatCurrency(ov.kpi.spend)} hint={`${formatNumber(ov.kpi.active_campaigns)} campañas activas`} />
              <KpiCard icon={Eye} label="Impresiones" value={formatNumber(ov.kpi.impressions)} hint={`Alcance ${formatNumber(ov.kpi.reach)}`} />
              <KpiCard icon={MousePointerClick} label="Clicks" value={formatNumber(ov.kpi.clicks)} hint={`CTR ${ov.kpi.ctr.toFixed(2)}%`} />
              <KpiCard icon={Target} label="CPC" value={formatCurrency(ov.kpi.cpc)} hint="Costo por click" />
              <KpiCard icon={TrendingUp} label="CPM" value={formatCurrency(ov.kpi.cpm)} hint="Costo por mil impresiones" />
            </div>

            {/* Daily spend chart */}
            {ov.daily.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-text">Inversión diaria</h3>
                    <p className="text-[11px] text-text-muted">{ov.daily.length} días con data</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {(() => {
                    const maxSpend = Math.max(1, ...ov.daily.map((d) => d.spend));
                    return ov.daily.slice(-30).map((d) => (
                      <div key={d.d} className="flex items-center gap-2">
                        <div className="w-16 text-[10px] text-text-muted font-mono shrink-0">{d.d.slice(5)}</div>
                        <div className="flex-1 h-5 bg-soft rounded relative overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary to-accent"
                            style={{ width: `${(d.spend / maxSpend) * 100}%` }} />
                        </div>
                        <div className="w-28 text-right text-[11px] font-bold tabular-nums shrink-0">{formatCurrency(d.spend)}</div>
                        <div className="w-20 text-right text-[10px] text-text-muted shrink-0">{formatNumber(d.clicks)} clk</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* Cuentas */}
            {ov.accounts.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-4 mb-5">
                <h3 className="text-sm font-bold text-text mb-3">Cuentas publicitarias</h3>
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
              </div>
            )}

            {/* Campañas */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text">Campañas</h3>
                  <p className="text-[11px] text-text-muted">{cpQ.data?.count ?? 0} campañas · ordenadas por inversión</p>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Campaña</th>
                      <th className="text-left px-2 py-2">Estado</th>
                      <th className="text-left px-2 py-2">Objetivo</th>
                      <th className="text-right px-2 py-2">Spend</th>
                      <th className="text-right px-2 py-2">Impresiones</th>
                      <th className="text-right px-2 py-2">Clicks</th>
                      <th className="text-right px-2 py-2">CPM</th>
                      <th className="text-right px-2 py-2">CPC</th>
                      <th className="text-right px-3 py-2">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cpQ.data?.items ?? []).length === 0 ? (
                      <tr><td colSpan={9} className="text-center text-text-muted py-8">Sin campañas con spend en este periodo</td></tr>
                    ) : (
                      (cpQ.data?.items ?? []).map((c) => (
                        <tr key={c.id} className="border-t border-border hover:bg-soft/40">
                          <td className="px-3 py-2 max-w-[250px]">
                            <div className="truncate font-semibold text-text" title={c.name}>{c.name}</div>
                            <div className="text-[10px] text-text-muted">{c.account_name}</div>
                          </td>
                          <td className="px-2 py-2">
                            <CampaignStatusBadge status={c.effective_status || c.status} />
                          </td>
                          <td className="px-2 py-2 text-[10px] text-text-muted">{c.objective?.replace(/^OUTCOME_/, "").toLowerCase() || "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(c.spend)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(c.impressions)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{c.impressions > 0 ? formatCurrency(c.cpm) : "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{c.clicks > 0 ? formatCurrency(c.cpc) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.impressions > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function KpiCard({ icon: Icon, label, value, hint }: { icon: typeof Eye; label: string; value: string; hint: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-md">
          <Icon size={14} />
        </div>
      </div>
      <div className="text-xl font-extrabold text-text tabular-nums truncate">{value}</div>
      <div className="text-[10px] text-text-muted mt-1">{hint}</div>
    </div>
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
