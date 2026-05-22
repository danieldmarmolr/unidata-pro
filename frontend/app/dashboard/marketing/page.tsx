"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { MultiLineChart } from "@/components/multi-line-chart";
import { CategoryTable } from "@/components/generic-table";
import { HBarChart } from "@/components/bar-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatNumber } from "@/lib/utils";
import { useUnitFromQuery, type Unit } from "@/lib/use-unit-from-query";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries, TimeSeriesPoint } from "@/lib/types";

type MktUni = {
  cards: KpiCardT[];
  trends: TimeSeries[];
  top_customers: CategoryValue[];
  customer_types: CategoryValue[];
  cohort: { cohort: string; data: Record<string, number> }[];
  top_provinces: CategoryValue[];
  generated_at: string;
};

type MktDrop = {
  cards: KpiCardT[];
  daily_pixel: TimeSeriesPoint[];
  daily_signups: TimeSeriesPoint[];
  generated_at: string;
};

function CohortHeatmap({ data }: { data: { cohort: string; data: Record<string, number> }[] }) {
  if (!data.length) return null;
  const allMonths = Array.from(new Set(data.flatMap((c) => Object.keys(c.data)))).sort();
  const max = Math.max(0, ...data.flatMap((c) => Object.values(c.data)));
  return (
    <div className="bg-surface border border-border rounded-xl p-5 overflow-x-auto">
      <div className="text-sm font-bold text-text mb-2">Cohort retention</div>
      <div className="text-xs text-text-muted mb-3">Cohort = mes de primera orden · valor = customers que volvieron a comprar en ese mes</div>
      <table className="text-xs">
        <thead>
          <tr>
            <th className="text-left pr-3 py-1 sticky left-0 bg-surface text-text-muted">Cohort</th>
            {allMonths.map((m) => (
              <th key={m} className="px-2 py-1 text-center text-text-muted font-normal">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.cohort}>
              <td className="pr-3 py-1 sticky left-0 bg-surface font-bold text-text">{c.cohort}</td>
              {allMonths.map((m) => {
                const v = c.data[m] ?? 0;
                const intensity = max > 0 ? v / max : 0;
                const bg = `rgba(122, 62, 174, ${0.05 + intensity * 0.85})`;
                return (
                  <td key={m} className="px-2 py-1 text-center" style={{ background: bg }}>
                    <span className={intensity > 0.4 ? "text-white font-semibold" : "text-text"}>
                      {v ? formatNumber(v) : "—"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketingPage() {
  const [unit, setUnit, unitLocked] = useUnitFromQuery("unistore");
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [drillCustomer, setDrillCustomer] = useState<{ id: number; name: string } | null>(null);

  const { data: dataUni, isLoading: lUni } = useQuery<MktUni>({
    queryKey: ["dashboards", "mkt", "unistore", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/marketing/unistore?${_qs}`),
    staleTime: 60_000,
    enabled: unit === "unistore",
  });

  const { data: dataDrop, isLoading: lDrop } = useQuery<MktDrop>({
    queryKey: ["dashboards", "mkt", "unidrop", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/marketing/unidrop?${_qs}`),
    staleTime: 60_000,
    enabled: unit === "unidrop",
  });

  const data = unit === "unistore" ? dataUni : dataDrop;
  const isLoading = unit === "unistore" ? lUni : lDrop;

  return (
    <>
      <Topbar
        title="Marketing"
        subtitle="Unistore: customers, LTV, cohort, geo · Unidrop: pixel events, signups, referrals"
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          filters={
            <>
              <Segmented<Unit>
                value={unit}
                onChange={setUnit}
                disabled={unitLocked}
                lockedHint={unitLocked ? `Fijado a ${unit}` : undefined}
                options={[
                  { value: "unistore", label: "Unistore" },
                  { value: "unidrop", label: "Unidrop" },
                ]}
              />
        <TodayPanel unit={unit} context="marketing" title="HOY · Marketing" />
            </>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
            ))
          ) : (
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period })} />)
          )}
        </div>

        {unit === "unistore" && dataUni && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              <MultiLineChart
                series={dataUni.trends}
                caption="Nuevos customers por mes"
                subtitle="Tendencia 12 meses"
                formatter="number"
              />
              <DonutChart
                caption="Tipo de customer"
                data={dataUni.customer_types.map((p) => ({ name: p.category, value: p.value }))}
              />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              <CategoryTable
                caption="Top 15 customers por LTV"
                subtitle="Click en una fila para ver historial de ordenes"
                data={dataUni.top_customers}
                formatter="currency"
                extraColumns={[{ key: "province", label: "Provincia", format: "raw" }]}
                onRowClick={(r) => {
                  const id = r.extra?.customer_id;
                  if (typeof id === "number" && id > 0) {
                    setDrillCustomer({ id, name: r.category });
                  }
                }}
              />
              <HBarChart
                data={dataUni.top_provinces.map((p) => ({ name: p.category, value: p.value, extra: p.extra }))}
                caption="Top provincias por revenue (paid)"
                formatter="currency"
              />
            </div>
            <CohortHeatmap data={dataUni.cohort} />
          </>
        )}

        {unit === "unidrop" && <MetaAdsTeaser />}

        {unit === "unidrop" && dataDrop && (
          <InteractiveMetricChart
            points={(() => {
              const map = new Map<string, any>();
              for (const p of (dataDrop.daily_pixel || [])) {
                map.set(p.date, { date: p.date, eventos_pixel: p.value });
              }
              for (const p of (dataDrop.daily_signups || [])) {
                const existing = map.get(p.date) ?? { date: p.date };
                existing.signups = p.value;
                map.set(p.date, existing);
              }
              return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
            })()}
            metrics={[
              { key: "eventos_pixel", label: "Eventos Pixel", kind: "number", color: "#3b82f6" },
              { key: "signups", label: "Nuevos signups", kind: "number", color: "#10b981" },
            ]}
            defaultPrimary="signups"
            defaultSecondary="eventos_pixel"
            caption="Crecimiento Unidrop (diario)"
            subtitle="Barras + línea: comparar señales de adquisición. Subió pixel pero no signups = pixel no está convirtiendo bien"
            height={320}
          />
        )}
      </div>

      {drillCustomer && (
        <DrillDownModal
          title={`Historial de ${drillCustomer.name}`}
          subtitle="Todas las ordenes registradas"
          endpoint={`/api/drilldowns/customers/${drillCustomer.id}/orders`}
          filename={`customer_${drillCustomer.id}_orders.csv`}
          onClose={() => setDrillCustomer(null)}
        />
      )}
    </>
  );
}

function MetaAdsTeaser() {
  type Impact = {
    kpi: { spend: number; new_signups: number; new_subscriptions: number;
           cac_dropshipper: number; roas: number; revenue_pi: number };
  };
  const { data } = useQuery<Impact>({
    queryKey: ["meta-impact-teaser-30d"],
    queryFn: () => api(`/api/marketing/meta/unidrop-impact?period=30d`),
    staleTime: 120_000,
  });
  const k = data?.kpi;
  return (
    <a href="/dashboard/marketing/meta"
       className="block bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-primary/30 rounded-xl p-4 mb-6 hover:shadow-md transition">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
          <span className="text-base font-extrabold">M</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text">Meta Ads · Pautas Unidrop</h3>
          <p className="text-[11px] text-text-muted">Spend Facebook/Instagram cruzado con signups y revenue · últimos 30 días</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          {k && (
            <>
              <div className="text-right">
                <div className="text-text-muted text-[9px] uppercase tracking-wider">Inversión</div>
                <div className="font-bold tabular-nums">{new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(k.spend)}</div>
              </div>
              <div className="text-right">
                <div className="text-text-muted text-[9px] uppercase tracking-wider">Signups</div>
                <div className="font-bold tabular-nums">{k.new_signups}</div>
              </div>
              <div className="text-right">
                <div className="text-text-muted text-[9px] uppercase tracking-wider">CAC</div>
                <div className="font-bold tabular-nums text-primary">
                  {k.cac_dropshipper > 0 ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(k.cac_dropshipper) : "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-text-muted text-[9px] uppercase tracking-wider">ROAS</div>
                <div className="font-bold tabular-nums text-emerald-600">{k.roas > 0 ? `${k.roas.toFixed(2)}x` : "—"}</div>
              </div>
            </>
          )}
          <span className="text-primary text-xs font-semibold">Ver detalle →</span>
        </div>
      </div>
    </a>
  );
}
