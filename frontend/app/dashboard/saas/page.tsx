"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { Funnel } from "@/components/funnel";
import { DonutChart } from "@/components/donut-chart";
import { MultiLineChart } from "@/components/multi-line-chart";
import { CategoryTable } from "@/components/generic-table";
import { DashboardHeader } from "@/components/dashboard-header";
import { PeriodSegmented, Segmented, type Period } from "@/components/segmented";
import { api } from "@/lib/api";
import type { KpiCard as KpiCardT, TimeSeries, CategoryValue } from "@/lib/types";

type Segment = "all" | "b2b" | "b2c";

type SaaSResp = {
  period: string;
  segment: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  funnel: CategoryValue[];
  persona_distribution: CategoryValue[];
  subscription_status: CategoryValue[];
  top_users: CategoryValue[];
  generated_at: string;
};

export default function SaaSPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [segment, setSegment] = useState<Segment>("all");

  const { data, isLoading, isFetching, error } = useQuery<SaaSResp>({
    queryKey: ["dashboards", "saas", "unidrop", period, segment],
    queryFn: () =>
      api(`/api/dashboards/saas/unidrop?period=${period}&segment=${segment}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="SaaS Metrics · Unidrop"
        subtitle="Salud del negocio: usuarios, suscripciones, churn, funnel de activacion"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <>
              <PeriodSegmented value={period} onChange={setPeriod} />
              <Segmented<Segment>
                value={segment}
                onChange={setSegment}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "b2b", label: "B2B (Juridica)" },
                  { value: "b2c", label: "B2C (Fisica)" },
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
            <div className="bg-surface border border-border rounded-xl p-5 h-[360px] animate-pulse" />
          ) : (
            <Funnel
              caption="Funnel de activacion"
              subtitle="De signup a primera venta a traves de la plataforma"
              steps={data.funnel.map((f) => ({ category: f.category, value: f.value }))}
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[360px] animate-pulse" />
          ) : (
            <MultiLineChart
              series={data.trends}
              caption="Tendencia 12 meses"
              subtitle="Signups · Suscripciones nuevas · Churn"
              formatter="number"
            />
          )}
        </div>

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
                caption="Distribucion personeria"
                data={data.persona_distribution.map((p) => ({ name: p.category, value: p.value }))}
              />
              <DonutChart
                caption="Estados de suscripcion"
                data={data.subscription_status.map((p) => ({ name: p.category, value: p.value }))}
              />
              <CategoryTable
                caption="Top usuarios por volumen procesado"
                subtitle="Revenue de sus tiendas TN conectadas"
                data={data.top_users.slice(0, 8)}
                formatter="currency"
                extraColumns={[
                  { key: "orders", label: "Ord", format: "number" },
                  { key: "persona", label: "Tipo", format: "raw" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
