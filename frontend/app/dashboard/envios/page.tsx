"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { HBarChart } from "@/components/bar-chart";
import { MultiLineChart } from "@/components/multi-line-chart";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint, TimeSeries } from "@/lib/types";

type Courier = "all" | "oca" | "lightdata";

type EnviosResp = {
  period: string;
  courier: string;
  cards: KpiCardT[];
  daily_oca: TimeSeriesPoint[];
  daily_ld: TimeSeriesPoint[];
  courier_compare: CategoryValue[];
  estados_oca: CategoryValue[];
  estados_ld: CategoryValue[];
  top_provincias: CategoryValue[];
  generated_at: string;
};

export default function EnviosPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [courier, setCourier] = useState<Courier>("all");

  const { data, isLoading, isFetching, error } = useQuery<EnviosResp>({
    queryKey: ["dashboards", "envios", period, customFrom, customTo, courier],
    queryFn: () => api(`/api/dashboards/envios/unidrop?${_qs}&courier=${courier}`),
    staleTime: 60_000,
  });

  const series: TimeSeries[] = [];
  if (data?.daily_oca?.length) series.push({ label: "OCA", points: data.daily_oca });
  if (data?.daily_ld?.length) series.push({ label: "LightData", points: data.daily_ld });

  return (
    <>
      <Topbar
        title="Envios · Unidrop"
        subtitle="OCA vs LightData · volumen, tasa de entrega, costos"
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <>
              <Segmented<Courier>
                value={courier}
                onChange={setCourier}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "oca", label: "OCA" },
                  { value: "lightdata", label: "LightData" },
                ]}
              />
        <TodayPanel unit="unidrop" context="envios" title="HOY · Envios" />
            </>
          }
        />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
            ))
          ) : (
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period })} />)
          )}
        </div>

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse mb-6" />
        ) : (
          <div className="mb-6">
            <InteractiveMetricChart
              points={(() => {
                const map = new Map<string, any>();
                for (const s of (series || [])) {
                  for (const p of (s.points || [])) {
                    const existing = map.get(p.date) ?? { date: p.date };
                    existing[s.label] = p.value;
                    map.set(p.date, existing);
                  }
                }
                return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
              })()}
              metrics={(series || []).map((s, i) => ({
                key: s.label,
                label: s.label,
                kind: "number" as const,
                color: ["#7a3eae", "#10b981", "#3b82f6", "#f59e0b"][i % 4],
              }))}
              defaultPrimary={series?.[0]?.label}
              defaultSecondary={series?.[1]?.label}
              caption="Volumen diario por courier"
              subtitle="Comparativa head-to-head · Cruzá OCA vs LightData para ver si uno crece a costa del otro"
              height={320}
            />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
            </>
          ) : (
            <>
              <DonutChart
                caption="Estados OCA"
                data={data.estados_oca.map((p) => ({ name: p.category, value: p.value }))}
              />
              <DonutChart
                caption="Estados LightData"
                data={data.estados_ld.map((p) => ({ name: p.category, value: p.value }))}
              />
              <CategoryTable
                caption="Comparacion couriers"
                data={data.courier_compare}
                formatter="number"
                extraColumns={[
                  { key: "entregados", label: "Entregados", format: "number" },
                  { key: "costo", label: "Costo total", format: "currency" },
                ]}
                showProgress={false}
              />
            </>
          )}
        </div>

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
        ) : (
          <HBarChart
            data={data.top_provincias.map((p) => ({ name: p.category, value: p.value, extra: p.extra }))}
            caption="Top 10 provincias por envios (OCA)"
            formatter="number"
          />
        )}
      </div>
    </>
  );
}
