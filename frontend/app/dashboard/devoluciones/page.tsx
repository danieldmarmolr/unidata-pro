"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { MultiLineChart } from "@/components/multi-line-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type Modelo = "all" | "unistore" | "unidrop" | "unifull";

type Resp = {
  period: string;
  modelo: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  estados: CategoryValue[];
  resoluciones: CategoryValue[];
  tipos_dev: CategoryValue[];
  top_motivos: CategoryValue[];
  top_skus: CategoryValue[];
  recent: CategoryValue[];
  transferencias_stats: CategoryValue[];
  generated_at: string;
};

export default function DevolucionesPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [modelo, setModelo] = useState<Modelo>("all");

  const { data, isLoading, isFetching, error } = useQuery<Resp>({
    queryKey: ["dashboards", "devoluciones", period, customFrom, customTo, modelo],
    queryFn: () => api(`/api/dashboards/devoluciones?${_qs}&modelo=${modelo}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Devoluciones · Unidev"
        subtitle="RMA del grupo Unistore · gestiona devoluciones, cupones y transferencias"
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <Segmented<Modelo>
              value={modelo}
              onChange={setModelo}
              options={[
                { value: "all", label: "Todas las unidades" },
                { value: "unistore", label: "Unistore" },
                { value: "unidrop", label: "Unidrop (proximo)" },
                { value: "unifull", label: "Unifull (proximo)" },
              ]}
            />
          }
        />
        <TodayPanel compact={period !== "today"} />

        {modelo !== "all" && modelo !== "unistore" && (
          <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
            Hoy todas las devoluciones cuelgan de <code>unistore_order_id</code>. Cuando Unidev empiece a abarcar
            {" "}<strong>{modelo}</strong>, los datos van a aparecer aca automaticamente.
          </div>
        )}
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
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, modelo })} />)
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <MultiLineChart
                series={data.trends}
                caption="Devoluciones mensuales (12m)"
                subtitle="Total vs admitidas"
                formatter="number"
              />
            )}
          </div>
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DonutChart
                caption="Estados"
                data={data.estados.map((p) => ({ name: p.category, value: p.value }))}
              />
            )}
          </div>
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
                caption="Tipo de resolucion"
                data={data.resoluciones.map((p) => ({ name: p.category, value: p.value }))}
              />
              <DonutChart
                caption="Tipo de devolucion"
                data={data.tipos_dev.map((p) => ({ name: p.category, value: p.value }))}
              />
              <CategoryTable
                caption="Estado de transferencias"
                data={data.transferencias_stats}
                formatter="number"
                extraColumns={[{ key: "monto", label: "Monto", format: "currency" }]}
                showProgress={false}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            </>
          ) : (
            <>
              <CategoryTable
                caption="Top motivos de falla"
                subtitle="Suma de cantidad reportada por items"
                data={data.top_motivos}
                formatter="number"
                extraColumns={[{ key: "items", label: "Items", format: "number" }]}
              />
              <CategoryTable
                caption="Top SKUs devueltos"
                subtitle="Por unidades solicitadas"
                data={data.top_skus}
                formatter="number"
                extraColumns={[
                  { key: "items", label: "Casos", format: "number" },
                  { key: "monto", label: "Monto", format: "currency" },
                ]}
              />
            </>
          )}
        </div>

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        ) : (
          <CategoryTable
            caption="Devoluciones recientes (top 25)"
            subtitle="Cabeceras ordenadas por fecha"
            data={data.recent}
            formatter="currency"
            extraColumns={[
              { key: "estado", label: "Estado", format: "raw" },
              { key: "resolucion", label: "Resolucion", format: "raw" },
              { key: "tipo", label: "Tipo", format: "raw" },
              { key: "fecha", label: "Fecha", format: "raw" },
              { key: "dias_abierta", label: "Dias", format: "number" },
            ]}
            showProgress={false}
          />
        )}
      </div>
    </>
  );
}
