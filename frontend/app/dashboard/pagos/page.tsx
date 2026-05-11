"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { DailyRevenueChart } from "@/components/sparkline";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type Channel = "all" | "tn" | "ml";

type PagosResp = {
  period: string;
  channel: string;
  cards: KpiCardT[];
  daily_volume: TimeSeriesPoint[];
  channel_breakdown: CategoryValue[];
  status_dist: CategoryValue[];
  top_customers: CategoryValue[];
  generated_at: string;
};

export default function PagosPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [channel, setChannel] = useState<Channel>("all");
  const [drillAccount, setDrillAccount] = useState<{ id: number; name: string } | null>(null);

  const { data, isLoading, isFetching, error } = useQuery<PagosResp>({
    queryKey: ["dashboards", "pagos", period, customFrom, customTo, channel],
    queryFn: () => api(`/api/dashboards/pagos/unidrop?${_qs}&channel=${channel}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Pagos Talo · Unidrop"
        subtitle="TaloPay procesa pagos de ordenes TN, ordenes MELI y suscripciones · cada PaymentTransaction se clasifica por tipo via su PaymentIntent asociado"
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <Segmented<Channel>
              value={channel}
              onChange={setChannel}
              options={[
                { value: "all", label: "TN + ML" },
                { value: "tn", label: "Tienda Nube" },
                { value: "ml", label: "Mercado Libre" },
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
            ))
          ) : (
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, channel })} />)
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <InteractiveMetricChart
                points={data.daily_volume as any[]}
                metrics={[
                  { key: "value", label: "Volumen procesado", kind: "currency", color: "#7a3eae" },
                ]}
                defaultPrimary="value"
                caption={`Volumen diario procesado · ${period}`}
                subtitle={`PaymentTransaction de ordenes${channel !== "all" ? ` · canal ${channel.toUpperCase()}` : ""}`}
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

        {/* Breakdown TN vs MELI siempre visible */}
        {!isLoading && data && (
          <div className="mb-6">
            <CategoryTable
              caption="Volumen por tipo de pago"
              subtitle="TaloPay procesa ordenes TN, ordenes MELI y suscripciones · breakdown completo del periodo"
              data={data.channel_breakdown}
              formatter="currency"
              extraColumns={[{ key: "transacciones", label: "Trans", format: "number" }]}
              showProgress={true}
            />
          </div>
        )}

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        ) : (
          <CategoryTable
            caption="Top 15 customers por volumen"
            subtitle={`Filtrado por canal: ${channel.toUpperCase()} · click para historial`}
            data={data.top_customers}
            formatter="currency"
            extraColumns={[{ key: "transactions", label: "Trans", format: "number" }]}
            onRowClick={(r) => {
              const id = r.extra?.account_id;
              if (typeof id === "number" && id > 0) {
                setDrillAccount({ id, name: r.category });
              }
            }}
          />
        )}
      </div>

      {drillAccount && (
        <DrillDownModal
          title={`Transacciones de ${drillAccount.name}`}
          subtitle="Historial completo en Talo"
          endpoint={`/api/drilldowns/payment-accounts/${drillAccount.id}/transactions`}
          filename={`account_${drillAccount.id}_txs.csv`}
          onClose={() => setDrillAccount(null)}
        />
      )}
    </>
  );
}
