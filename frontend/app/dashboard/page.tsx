"use client";

import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { RevenueChart } from "@/components/revenue-chart";
import { IntegrationHealthList } from "@/components/integration-health";
import { AlertsPanel } from "@/components/alerts-panel";
import { api } from "@/lib/api";
import type { ExecutiveOverview } from "@/lib/types";

export default function ExecutiveDashboardPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<ExecutiveOverview>({
    queryKey: ["dashboards", "executive"],
    queryFn: () => api<ExecutiveOverview>("/api/dashboards/executive"),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Dashboard gerencial"
        subtitle="Vista consolidada del grupo Unistore - todas las unidades"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error cargando el dashboard: {(error as Error).message}{" "}
            <button onClick={() => refetch()} className="underline ml-2">
              Reintentar
            </button>
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

        {/* Chart + alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            ) : (
              <RevenueChart series={data.revenue_by_channel} />
            )}
          </div>
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            ) : (
              <AlertsPanel alerts={data.top_alerts} />
            )}
          </div>
        </div>

        {/* Integration health */}
        <div className="grid grid-cols-1 gap-4">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[200px] animate-pulse" />
          ) : (
            <IntegrationHealthList items={data.integration_health} />
          )}
        </div>

        {data && (
          <div className="mt-6 text-xs text-text-muted text-right">
            Datos generados:{" "}
            {new Date(data.generated_at).toLocaleString("es-AR")}
            {isFetching && " · refrescando..."}
          </div>
        )}
      </div>
    </>
  );
}
