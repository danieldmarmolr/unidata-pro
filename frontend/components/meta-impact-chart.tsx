"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ComposedChart, Bar, Line, Area, LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { api } from "@/lib/api";

type DailyPoint = {
  d: string; spend: number; clicks: number; signups: number; revenue: number;
};

type SignupUser = {
  id: number; nombre: string; email: string; dni: string;
  personeria: string; suscripto: boolean; vence: string | null;
  plan_name: string;
  nickname_meli: string;
  tiene_ml: boolean; ml_orders: number; ml_gmv: number;
  tiene_tn: boolean; tn_orders: number; tn_gmv: number;
  revenue_total: number;
};

type SignupsPerDay = { d: string; count: number; users: SignupUser[] };
type CampaignDailyPoint = { d: string; spend: number; clicks: number; impressions: number };

type Campaign = { id: string; name: string; spend: number; status: string; effective_status: string };

const shortCurrency = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export function MetaImpactChart({
  daily,
  campaigns,
  period,
}: {
  daily: DailyPoint[];
  campaigns: Campaign[];
  period: string;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const signupsDayQ = useQuery<SignupsPerDay[]>({
    queryKey: ["meta-signups-per-day", period],
    queryFn: () => api(`/api/marketing/meta/signups-per-day?period=${period}`),
    staleTime: 120_000,
  });

  const campaignDailyQ = useQuery<CampaignDailyPoint[]>({
    queryKey: ["meta-campaign-daily", selectedCampaignId, period],
    queryFn: () => api(`/api/marketing/meta/campaign-daily?campaign_id=${selectedCampaignId}&period=${period}`),
    enabled: !!selectedCampaignId,
    staleTime: 120_000,
  });

  const cpMap = new Map<string, number>();
  (campaignDailyQ.data ?? []).forEach((r) => cpMap.set(r.d, r.spend));

  const chartData = daily.map((d) => ({
    d: d.d,
    label: d.d.slice(5),
    spend: d.spend,
    revenue: d.revenue,
    signups: d.signups,
    cp_spend: cpMap.get(d.d) ?? undefined,
    cac: d.signups > 0 ? d.spend / d.signups : null,
    roas: d.spend > 0 ? d.revenue / d.spend : null,
    conv: d.clicks > 0 ? (d.signups / d.clicks) * 100 : null,
  }));

  const selectedDayData = (signupsDayQ.data ?? []).find((s) => s.d === selectedDay);
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const activeCampaigns = campaigns.filter(
    (c) => (c.effective_status || c.status).toLowerCase().includes("active") && c.spend > 0
  ).slice(0, 8);

  const handleBarClick = (data: { d?: string; label?: string } | undefined) => {
    if (!data) return;
    const day = data.d ?? null;
    setSelectedDay((prev) => (prev === day ? null : day));
  };

  return (
    <div className="space-y-3">
      {/* Campaign filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold shrink-0">Campaña:</span>
        <button
          onClick={() => setSelectedCampaignId(null)}
          className={"px-2 py-0.5 text-[10px] font-bold rounded-md border transition " +
            (!selectedCampaignId ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text bg-soft")}>
          Todas
        </button>
        {activeCampaigns.map((c) => (
          <button key={c.id}
            onClick={() => setSelectedCampaignId((prev) => prev === c.id ? null : c.id)}
            className={"px-2 py-0.5 text-[10px] font-semibold rounded-md border transition max-w-[180px] truncate " +
              (selectedCampaignId === c.id
                ? "bg-violet-500 text-white border-violet-500"
                : "border-border text-text-muted hover:text-text bg-soft")}
            title={c.name}>
            {c.name.length > 22 ? c.name.slice(0, 22) + "…" : c.name}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-text-muted flex-wrap">
        <Leg color="bg-primary" label="Spend total" />
        {selectedCampaign && <Leg color="bg-violet-400" label={selectedCampaign.name} />}
        <Leg color="bg-amber-500" line label="Revenue" />
        <Leg color="bg-emerald-500" line label="Signups (→)" />
        <span className="ml-auto text-[9px] italic">Click en barra → dropshippers del día</span>
      </div>

      {/* Main chart: spend bars + revenue area + signups line */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 56, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--color-border, #e5e7eb)" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="money" orientation="left" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} tickFormatter={shortCurrency} width={52} />
          <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} width={38} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--color-border, #e5e7eb)" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any): [string, string] => {
              const val = Number(v ?? 0);
              if (name === "spend") return [formatCurrency(val), "Spend total"];
              if (name === "cp_spend") return [formatCurrency(val), selectedCampaign?.name ?? "Campaña"];
              if (name === "revenue") return [formatCurrency(val), "Revenue"];
              if (name === "signups") return [formatNumber(val), "Signups"];
              return [String(v ?? ""), String(name ?? "")];
            }}
            labelFormatter={(l) => `📅 ${l}`}
          />
          <Bar yAxisId="money" dataKey="spend" fill="#7C3AED" opacity={0.8} radius={[2, 2, 0, 0]}
            cursor="pointer" onClick={handleBarClick} />
          {selectedCampaignId && (
            <Bar yAxisId="money" dataKey="cp_spend" fill="#A78BFA" opacity={0.65} radius={[2, 2, 0, 0]} />
          )}
          <Area yAxisId="money" type="monotone" dataKey="revenue" fill="#F59E0B"
            fillOpacity={0.1} stroke="#F59E0B" strokeWidth={1.5} dot={false} />
          <Line yAxisId="count" type="monotone" dataKey="signups" stroke="#10B981"
            strokeWidth={2} dot={{ r: 1.5, fill: "#10B981" }} activeDot={{ r: 4 }} />
          {selectedDay && (
            <ReferenceLine yAxisId="money" x={selectedDay.slice(5)}
              stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="3 3" />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* KPI trends: CAC · ROAS · Conv% */}
      <div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted mb-1">
          <Leg color="bg-rose-500" line label="CAC (izq $)" />
          <Leg color="bg-emerald-500" line label="ROAS (der ×)" />
          <Leg color="bg-indigo-400" line label="Conv% (der)" />
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chartData} margin={{ top: 4, right: 56, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--color-border, #e5e7eb)" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="cac" orientation="left" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} tickFormatter={shortCurrency} width={52} />
            <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 9, fill: "var(--color-text-muted, #9ca3af)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v).toFixed(1)}`} width={38} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--color-border, #e5e7eb)" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any): [string, string] => {
                const val = Number(v ?? 0);
                if (name === "cac") return [formatCurrency(val), "CAC"];
                if (name === "roas") return [`${val.toFixed(2)}x`, "ROAS"];
                if (name === "conv") return [`${val.toFixed(2)}%`, "Conv%"];
                return [String(v ?? ""), String(name ?? "")];
              }}
              labelFormatter={(l) => `📅 ${l}`}
            />
            <Line yAxisId="cac" type="monotone" dataKey="cac" stroke="#EF4444" strokeWidth={1.5} dot={false} connectNulls />
            <Line yAxisId="rate" type="monotone" dataKey="roas" stroke="#10B981" strokeWidth={1.5} dot={false} connectNulls />
            <Line yAxisId="rate" type="monotone" dataKey="conv" stroke="#6366F1" strokeWidth={1.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div className="border border-primary/30 bg-primary/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-text">{selectedDay}</span>
              {signupsDayQ.isLoading ? (
                <span className="text-xs text-text-muted">cargando...</span>
              ) : selectedDayData ? (() => {
                const users = selectedDayData.users;
                const nSub = users.filter(u => u.suscripto).length;
                const nMl = users.filter(u => u.tiene_ml).length;
                const nTn = users.filter(u => u.tiene_tn).length;
                const gmvTotal = users.reduce((s, u) => s + u.ml_gmv + u.tn_gmv, 0);
                const revTotal = users.reduce((s, u) => s + u.revenue_total, 0);
                return (
                  <span className="flex items-center gap-1.5 flex-wrap text-xs text-text-muted">
                    <span className="font-semibold text-text">{users.length}</span> signups
                    {nSub > 0 && <span className="text-emerald-600 font-semibold">· {nSub} activos</span>}
                    {nMl > 0 && <span className="text-yellow-600 font-semibold">· {nMl} ML</span>}
                    {nTn > 0 && <span className="text-cyan-600 font-semibold">· {nTn} TN</span>}
                    {gmvTotal > 0 && <span className="text-amber-600 font-semibold">· GMV {formatCurrency(gmvTotal)}</span>}
                    {revTotal > 0 && <span className="text-violet-600 font-semibold">· Rev {formatCurrency(revTotal)}</span>}
                  </span>
                );
              })() : null}
            </div>
            <button onClick={() => setSelectedDay(null)}
              className="text-text-muted hover:text-rose-500 text-xs font-bold px-2 py-0.5 rounded border border-border hover:border-rose-300">
              ✕
            </button>
          </div>

          {signupsDayQ.isLoading ? (
            <div className="text-xs text-text-muted text-center py-6">Cargando dropshippers...</div>
          ) : !selectedDayData || selectedDayData.users.length === 0 ? (
            <div className="text-xs text-text-muted text-center py-6">Sin signups registrados este día</div>
          ) : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="text-text-muted text-[10px] uppercase tracking-wider sticky top-0 bg-primary/5">
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-3">Dropshipper</th>
                    <th className="text-left py-1.5 px-2">Plan</th>
                    <th className="text-left py-1.5 px-2">Canales</th>
                    <th className="text-right py-1.5 px-2">ML órdenes</th>
                    <th className="text-right py-1.5 px-2">TN órdenes</th>
                    <th className="text-right py-1.5 px-2">GMV total</th>
                    <th className="text-right py-1.5 pl-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayData.users.slice(0, 60).map((u) => (
                    <tr key={u.id} className="border-b border-border/40 hover:bg-primary/5">
                      <td className="py-1.5 pr-3">
                        <Link href={`/dashboard/dropshipper/${u.id}`} className="hover:text-primary">
                          <div className="font-semibold text-text truncate max-w-[160px]">{u.nombre || u.email}</div>
                          <div className="text-[9px] text-text-muted">{u.email}</div>
                        </Link>
                      </td>
                      <td className="py-1.5 px-2">
                        {u.plan_name ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-violet-50 text-violet-700 border-violet-200 truncate max-w-[90px] block">
                            {u.plan_name.length > 12 ? u.plan_name.slice(0, 12) + "…" : u.plan_name}
                          </span>
                        ) : (
                          <span className="text-[9px] text-text-muted/50">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex gap-1">
                          {u.tiene_ml ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-yellow-50 text-yellow-700 border-yellow-200" title={u.nickname_meli || "ML"}>ML</span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-slate-50 text-slate-400 border-slate-200">ML</span>
                          )}
                          {u.tiene_tn ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-cyan-50 text-cyan-700 border-cyan-200">TN</span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-slate-50 text-slate-400 border-slate-200">TN</span>
                          )}
                          <span className={"text-[9px] px-1.5 py-0.5 rounded border font-bold " +
                            (u.suscripto ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-500 border-rose-200")}>
                            {u.suscripto ? "✓" : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {u.ml_orders > 0 ? (
                          <div>
                            <div className="font-semibold text-yellow-700">{u.ml_orders}</div>
                            <div className="text-[9px] text-text-muted">{formatCurrency(u.ml_gmv)}</div>
                          </div>
                        ) : <span className="text-text-muted/50">—</span>}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {u.tn_orders > 0 ? (
                          <div>
                            <div className="font-semibold text-cyan-700">{u.tn_orders}</div>
                            <div className="text-[9px] text-text-muted">{formatCurrency(u.tn_gmv)}</div>
                          </div>
                        ) : <span className="text-text-muted/50">—</span>}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                        {(u.ml_gmv + u.tn_gmv) > 0
                          ? <span className="text-amber-700">{formatCurrency(u.ml_gmv + u.tn_gmv)}</span>
                          : <span className="text-text-muted/50">$0</span>}
                      </td>
                      <td className="py-1.5 pl-2 text-right tabular-nums font-semibold">
                        {u.revenue_total > 0
                          ? <span className="text-emerald-700">{formatCurrency(u.revenue_total)}</span>
                          : <span className="text-text-muted/50">$0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedDayData.users.length > 60 && (
                <div className="text-[10px] text-text-muted text-center pt-2 pb-1">
                  +{selectedDayData.users.length - 60} más
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Leg({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {line
        ? <span className={`w-4 h-0.5 ${color} inline-block rounded`} />
        : <span className={`w-3 h-3 rounded-sm ${color} inline-block`} />}
      {label}
    </span>
  );
}
