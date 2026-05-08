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
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatNumber } from "@/lib/utils";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries, TimeSeriesPoint } from "@/lib/types";

type Unit = "unistore" | "unidrop";

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
  const [unit, setUnit] = useState<Unit>("unistore");
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
                options={[
                  { value: "unistore", label: "Unistore" },
                  { value: "unidrop", label: "Unidrop" },
                ]}
              />
        <TodayPanel compact={period !== "today"} />
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

        {unit === "unidrop" && dataDrop && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <DailyRevenueChart
              points={dataDrop.daily_pixel}
              caption="Eventos Meta Pixel diarios"
              subtitle="Conversion tracking de las tiendas"
            />
            <DailyRevenueChart
              points={dataDrop.daily_signups}
              caption="Nuevos signups diarios"
              subtitle="Crecimiento de la base de usuarios"
            />
          </div>
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
