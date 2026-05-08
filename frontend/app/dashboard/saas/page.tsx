"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { Funnel } from "@/components/funnel";
import { DonutChart } from "@/components/donut-chart";
import { MultiLineChart } from "@/components/multi-line-chart";
import { CategoryTable } from "@/components/generic-table";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
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
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [segment, setSegment] = useState<Segment>("all");
  const [chartDrill, setChartDrill] = useState<{ endpoint: string; title: string; filename: string } | null>(null);

  const { data, isLoading, isFetching, error } = useQuery<SaaSResp>({
    queryKey: ["dashboards", "saas", "unidrop", period, customFrom, customTo, segment],
    queryFn: () =>
      api(`/api/dashboards/saas/unidrop?${_qs}&segment=${segment}`),
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
            <Segmented<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { value: "all", label: "Todos" },
                { value: "b2b", label: "B2B (Juridica)" },
                { value: "b2c", label: "B2C (Fisica)" },
              ]}
            />
          }
        />
        <TodayPanel compact={period !== "today"} unit="unidrop" />

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
            data.cards.map((c) => {
              const lc = c.label.toLowerCase();
              let drill = undefined as undefined | { endpoint: string; title?: string; subtitle?: string; filename?: string };
              if (lc.includes("usuarios totales")) drill = { endpoint: `/api/drilldowns/saas/users-all?segment=${segment}`, title: "Usuarios totales", filename: `usuarios_${segment}.csv` };
              else if (lc.includes("suscripciones activas")) drill = { endpoint: `/api/drilldowns/saas/users-active?segment=${segment}`, title: "Suscripciones activas", filename: `subs_activas_${segment}.csv` };
              else if (lc.includes("nuevos usuarios")) drill = { endpoint: `/api/drilldowns/saas/users-new?${_qs}&segment=${segment}`, title: `Nuevos usuarios (${period})`, filename: `nuevos_${period}_${segment}.csv` };
              else if (lc.includes("churn")) drill = { endpoint: `/api/drilldowns/saas/users-churned?${_qs}&segment=${segment}`, title: "Usuarios en churn", subtitle: "Suscripciones que vencieron en el periodo", filename: `churn_${period}_${segment}.csv` };
              else if (lc.includes("vencer")) drill = { endpoint: `/api/drilldowns/saas/users-expiring?days=7&segment=${segment}`, title: "Suscripciones a vencer en 7 dias", filename: `vencer_7d_${segment}.csv` };
              else if (lc.includes("tiendas")) drill = { endpoint: `/api/drilldowns/saas/tn-credentials`, title: "Tiendas TN conectadas", filename: `tiendas_tn.csv` };
              return <KpiCard key={c.label} data={c} drill={drill} />;
            })
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[360px] animate-pulse" />
          ) : (
            <Funnel
              caption="Funnel de activacion"
              subtitle="De signup a primera venta · click en una etapa para drill"
              steps={data.funnel.map((f) => ({ category: f.category, value: f.value }))}
              onStepClick={(s) => {
                const lc = s.category.toLowerCase();
                let endpoint = `/api/drilldowns/saas/users-all?segment=${segment}`;
                let title = `Etapa: ${s.category}`;
                if (lc.includes("sign-up") || lc.includes("signup")) endpoint = `/api/drilldowns/saas/users-all?segment=${segment}`;
                else if (lc.includes("conecta tn")) endpoint = `/api/drilldowns/saas/tn-credentials`;
                else if (lc.includes("conecta ml")) endpoint = `/api/drilldowns/saas/users-active?segment=${segment}`;
                setChartDrill({ endpoint, title, filename: `funnel_${lc.replace(/\W+/g,'_')}.csv` });
              }}
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
                onSliceClick={(d) => {
                  const seg = d.name.toUpperCase().includes("FISIC") ? "b2c" : d.name.toUpperCase().includes("JURIDIC") ? "b2b" : segment;
                  setChartDrill({
                    endpoint: `/api/drilldowns/saas/users-all?segment=${seg}`,
                    title: `Usuarios ${d.name}`,
                    filename: `users_${seg}.csv`,
                  });
                }}
              />
              <DonutChart
                caption="Estados de suscripcion"
                data={data.subscription_status.map((p) => ({ name: p.category, value: p.value }))}
                onSliceClick={(d) => {
                  const lc = d.name.toLowerCase();
                  let endpoint = `/api/drilldowns/saas/users-active?segment=${segment}`;
                  if (lc === "expired") endpoint = `/api/drilldowns/saas/users-churned?period=12m&segment=${segment}`;
                  else if (lc === "inactive") endpoint = `/api/drilldowns/saas/users-all?segment=${segment}`;
                  setChartDrill({
                    endpoint,
                    title: `Suscripciones ${d.name}`,
                    filename: `subs_${lc}.csv`,
                  });
                }}
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

      {chartDrill && (
        <DrillDownModal
          title={chartDrill.title}
          subtitle="Click ESC o fuera del modal para cerrar"
          endpoint={chartDrill.endpoint}
          filename={chartDrill.filename}
          onClose={() => setChartDrill(null)}
        />
      )}
    </>
  );
}
