"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { RevenueChart } from "@/components/revenue-chart";
import { DonutChart } from "@/components/donut-chart";
import { HBarChart } from "@/components/bar-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { TopProductsTable } from "@/components/top-products";
import { PeriodFilter, type Channel, type Period } from "@/components/period-filter";
import { api } from "@/lib/api";
import type { SalesOverview } from "@/lib/types";

export default function VentasPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [channel, setChannel] = useState<Channel>("all");

  const { data, isLoading, isFetching, error } = useQuery<SalesOverview>({
    queryKey: ["dashboards", "sales", "unistore", period, channel],
    queryFn: () =>
      api<SalesOverview>(
        `/api/dashboards/sales/unistore?period=${period}&channel=${channel}`,
      ),
    staleTime: 60_000,
  });

  const provincesData =
    data?.top_provinces.map((p) => ({
      name: p.category,
      value: p.value,
      extra: p.extra,
    })) ?? [];

  const statusData =
    data?.payment_status.map((s) => ({ name: s.category, value: s.value })) ?? [];

  return (
    <>
      <Topbar
        title="Ventas Unistore"
        subtitle="Tienda Nube + Mercado Libre · revenue, ordenes, top productos, geografia"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {/* Filtros */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <PeriodFilter
            period={period}
            channel={channel}
            onPeriodChange={setPeriod}
            onChannelChange={setChannel}
          />
          {data && (
            <div className="text-xs text-text-muted">
              Datos al {new Date(data.generated_at).toLocaleString("es-AR")}
              {isFetching && " · refrescando..."}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse"
              />
            ))
          ) : (
            data.cards.map((c) => <KpiCard key={c.label} data={c} />)
          )}
        </div>

        {/* Daily revenue + Payment status donut */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DailyRevenueChart
                points={data.daily_revenue}
                caption={`Revenue diario · ultimos ${period}`}
                subtitle="Suma de TN (paid) + ML (paid/confirmed/shipped/delivered)"
              />
            )}
          </div>
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DonutChart
                data={statusData}
                caption="Distribucion paymentStatus (TN)"
              />
            )}
          </div>
        </div>

        {/* Tendencia 12m + Provincias */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[360px] animate-pulse" />
          ) : (
            <RevenueChart series={data.revenue_by_channel} height={300} />
          )}

          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[360px] animate-pulse" />
          ) : (
            <HBarChart
              data={provincesData}
              caption="Top 10 provincias por revenue (TN)"
              formatter="currency"
              color="#7a3eae"
            />
          )}
        </div>

        {/* Top products */}
        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        ) : (
          <TopProductsTable data={data.top_products} />
        )}
      </div>
    </>
  );
}
