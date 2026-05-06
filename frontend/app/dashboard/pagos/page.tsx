"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { DailyRevenueChart } from "@/components/sparkline";
import { DashboardHeader } from "@/components/dashboard-header";
import { PeriodSegmented, Segmented, type Period } from "@/components/segmented";
import { api } from "@/lib/api";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type Flow = "all" | "orders" | "subscriptions";

type PagosResp = {
  period: string;
  flow: string;
  cards: KpiCardT[];
  daily_volume: TimeSeriesPoint[];
  status_dist: CategoryValue[];
  top_customers: CategoryValue[];
  generated_at: string;
};

export default function PagosPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [flow, setFlow] = useState<Flow>("all");

  const { data, isLoading, isFetching, error } = useQuery<PagosResp>({
    queryKey: ["dashboards", "pagos", period, flow],
    queryFn: () => api(`/api/dashboards/pagos/unidrop?period=${period}&flow=${flow}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Pagos Talo · Unidrop"
        subtitle="Volumen, tasa de exito, comisiones cobradas"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <>
              <PeriodSegmented value={period} onChange={setPeriod} />
              <Segmented<Flow>
                value={flow}
                onChange={setFlow}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "orders", label: "Ordenes" },
                  { value: "subscriptions", label: "Suscripciones" },
                ]}
              />
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
            data.cards.map((c) => <KpiCard key={c.label} data={c} />)
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DailyRevenueChart
                points={data.daily_volume}
                caption={`Volumen diario procesado · ${period}`}
                subtitle="PaymentTransaction (orders + subscriptions segun filtro)"
              />
            )}
          </div>
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DonutChart
                caption="Distribucion estados"
                data={data.status_dist.map((p) => ({ name: p.category, value: p.value }))}
              />
            )}
          </div>
        </div>

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        ) : (
          <CategoryTable
            caption="Top 15 customers por volumen"
            subtitle="Sumatoria de PaymentTransaction.amount"
            data={data.top_customers}
            formatter="currency"
            extraColumns={[{ key: "transactions", label: "Trans", format: "number" }]}
          />
        )}
      </div>
    </>
  );
}
