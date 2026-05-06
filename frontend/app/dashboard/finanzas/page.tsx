"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { DonutChart } from "@/components/donut-chart";
import { MultiLineChart } from "@/components/multi-line-chart";
import { CategoryTable } from "@/components/generic-table";
import { HBarChart } from "@/components/bar-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { PeriodSegmented, type Period } from "@/components/segmented";
import { api } from "@/lib/api";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type FinResp = {
  period: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  top_conceptos: CategoryValue[];
  estados_so: CategoryValue[];
  invoice_status: CategoryValue[];
  by_integration: CategoryValue[];
  generated_at: string;
};

export default function FinanzasPage() {
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading, isFetching, error } = useQuery<FinResp>({
    queryKey: ["dashboards", "finanzas", "unistore", period],
    queryFn: () => api(`/api/dashboards/finanzas/unistore?period=${period}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Finanzas · Unistore"
        subtitle="Facturacion Contabilium · cobranzas · cruce con ventas operativas TN+ML"
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

        <div className="mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <MultiLineChart
              series={data.trends}
              caption="Facturacion vs Ventas operativas (12 meses)"
              subtitle="Si la linea de ventas operativas esta arriba, hay revenue sin facturar"
              formatter="currency"
            />
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <HBarChart
              data={data.top_conceptos.map((p) => ({ name: p.category, value: p.value, extra: p.extra }))}
              caption="Top conceptos facturados"
              formatter="currency"
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Facturacion por integracion"
              subtitle="TN, ML, otras"
              data={data.by_integration}
              formatter="currency"
              extraColumns={[{ key: "orders", label: "Ord", format: "number" }]}
            />
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
          ) : (
            <DonutChart
              caption="Estados sales orders"
              data={data.estados_so.map((p) => ({ name: p.category, value: p.value }))}
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
          ) : (
            <DonutChart
              caption="Estado de facturacion"
              data={data.invoice_status.map((p) => ({ name: p.category, value: p.value }))}
            />
          )}
        </div>
      </div>
    </>
  );
}
