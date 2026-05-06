"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { Funnel } from "@/components/funnel";
import { CategoryTable } from "@/components/generic-table";
import { HBarChart } from "@/components/bar-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { DashboardHeader } from "@/components/dashboard-header";
import { PeriodSegmented, type Period } from "@/components/segmented";
import { api } from "@/lib/api";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type LogResp = {
  period: string;
  area: string;
  cards: KpiCardT[];
  funnel: CategoryValue[];
  lead_time_daily: TimeSeriesPoint[];
  stock_by_area: CategoryValue[];
  stock_critico: CategoryValue[];
  ajustes: CategoryValue[];
  stuck_orders: CategoryValue[];
  generated_at: string;
};

export default function LogisticaPage() {
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading, isFetching, error } = useQuery<LogResp>({
    queryKey: ["dashboards", "logistica", "unistore", period],
    queryFn: () => api(`/api/dashboards/logistica/unistore?period=${period}&area=all`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Logistica · Unistore"
        subtitle="Funnel Order TN -> Pedido Digip -> Despacho · stock por area · pedidos atascados"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={<PeriodSegmented value={period} onChange={setPeriod} />}
        />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
            ))
          ) : (
            data.cards.map((c) => <KpiCard key={c.label} data={c} />)
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <Funnel
              caption={`Funnel ultimos ${period}`}
              subtitle="Order pagada TN hasta Fulfillment registrado"
              steps={data.funnel.map((f) => ({ category: f.category, value: f.value }))}
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <DailyRevenueChart
              points={data.lead_time_daily}
              caption="Lead time Order -> Despacho (60 dias)"
              subtitle="Promedio diario en dias"
            />
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <HBarChart
              data={data.stock_by_area.map((s) => ({ name: s.category, value: s.value, extra: s.extra }))}
              caption="Stock por area (unidades totales)"
              formatter="number"
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Productos con stock critico"
              subtitle="<= 5 unidades totales en todas las areas"
              data={data.stock_critico}
              formatter="number"
              extraColumns={[
                { key: "desc", label: "Descripcion", format: "raw" },
                { key: "areas", label: "Areas", format: "number" },
              ]}
              showProgress={false}
            />
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Pedidos atascados (>5 dias)"
              subtitle="Pagados sin fulfillment - top 20 mas viejos"
              data={data.stuck_orders}
              formatter="currency"
              extraColumns={[
                { key: "dias_atrasado", label: "Dias", format: "number" },
                { key: "shipping", label: "Estado envio", format: "raw" },
              ]}
              showProgress={false}
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Movimientos de ajuste por motivo"
              subtitle="Top 10 motivos en el periodo"
              data={data.ajustes}
              formatter="number"
              extraColumns={[
                { key: "altas", label: "+", format: "number" },
                { key: "bajas", label: "-", format: "number" },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );
}
