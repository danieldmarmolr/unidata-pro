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
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type Unit = "unistore" | "unidrop";

type FinResp = {
  unit?: string;
  period: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  top_conceptos?: CategoryValue[];
  estados_so?: CategoryValue[];
  invoice_status?: CategoryValue[];
  by_integration?: CategoryValue[];
  by_tipo?: CategoryValue[];
  generated_at: string;
};

export default function FinanzasPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit] = useState<Unit>("unistore");

  const { data, isLoading, isFetching, error } = useQuery<FinResp>({
    queryKey: ["dashboards", "finanzas", unit, period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/finanzas/${unit}?${_qs}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title={`Finanzas · ${unit === "unistore" ? "Unistore" : "Unidrop"}`}
        subtitle={
          unit === "unistore"
            ? "Facturacion Contabilium · cobranzas · cruce con ventas operativas TN+ML"
            : "ContabilliumInvoice (dev) · cobranzas Talo · cruce con ventas operativas"
        }
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <Segmented<Unit>
              value={unit}
              onChange={setUnit}
              options={[
                { value: "unistore", label: "Unistore" },
                { value: "unidrop", label: "Unidrop" },
              ]}
            />
          }
        />
        <TodayPanel compact={period !== "today"} unit={unit} />

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
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period })} />)
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
          ) : unit === "unistore" ? (
            <HBarChart
              data={(data.top_conceptos ?? []).map((p) => ({ name: p.category, value: p.value, extra: p.extra }))}
              caption="Top conceptos facturados"
              formatter="currency"
            />
          ) : (
            <CategoryTable
              caption="Facturacion por tipo de comprobante"
              subtitle="ContabilliumInvoice.tipoFc"
              data={data.by_tipo ?? []}
              formatter="currency"
              extraColumns={[{ key: "cantidad", label: "Cant", format: "number" }]}
            />
          )}
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : unit === "unistore" ? (
            <CategoryTable
              caption="Facturacion por integracion"
              subtitle="TN, ML, otras"
              data={data.by_integration ?? []}
              formatter="currency"
              extraColumns={[{ key: "orders", label: "Ord", format: "number" }]}
            />
          ) : (
            <DonutChart
              caption="Estados sales orders (dev)"
              data={(data.estados_so ?? []).map((p) => ({ name: p.category, value: p.value }))}
            />
          )}
        </div>

        {unit === "unistore" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
            ) : (
              <DonutChart
                caption="Estados sales orders"
                data={(data.estados_so ?? []).map((p) => ({ name: p.category, value: p.value }))}
              />
            )}
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
            ) : (
              <DonutChart
                caption="Estado de facturacion"
                data={(data.invoice_status ?? []).map((p) => ({ name: p.category, value: p.value }))}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
