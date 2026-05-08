"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ScanBarcode } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { SkuSearchBox } from "@/components/sku-search-box";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { Funnel } from "@/components/funnel";
import { CategoryTable } from "@/components/generic-table";
import { HBarChart } from "@/components/bar-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { DashboardHeader } from "@/components/dashboard-header";
import { DrillDownModal } from "@/components/drilldown-modal";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type Unit = "unistore" | "unidrop";

type LogResp = {
  unit?: string;
  period: string;
  area?: string;
  cards: KpiCardT[];
  funnel: CategoryValue[];
  lead_time_daily?: TimeSeriesPoint[];
  daily_dispatch?: TimeSeriesPoint[];
  stock_by_area?: CategoryValue[];
  stock_critico?: CategoryValue[];
  ajustes?: CategoryValue[];
  top_provinces?: CategoryValue[];
  stuck_orders: CategoryValue[];
  generated_at: string;
};

export default function LogisticaPage() {
  const router = useRouter();
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit] = useState<Unit>("unistore");
  const [drillOrderId, setDrillOrderId] = useState<number | null>(null);

  const { data, isLoading, isFetching, error } = useQuery<LogResp>({
    queryKey: ["dashboards", "logistica", unit, period, customFrom, customTo],
    queryFn: () =>
      api(
        unit === "unistore"
          ? `/api/dashboards/logistica/unistore?${_qs}&area=all`
          : `/api/dashboards/logistica/unidrop?${_qs}`,
      ),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title={`Logistica · ${unit === "unistore" ? "Unistore" : "Unidrop"}`}
        subtitle={
          unit === "unistore"
            ? "Funnel Order TN -> Pedido Digip -> Despacho · stock por area · pedidos atascados"
            : "Envios OCA + LightData · etiquetas, lead times, atascados"
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

        {/* Buscador SKU / EAN — pensado para scaneo en deposito */}
        {unit === "unistore" && (
          <div className="mb-6 bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
                <ScanBarcode size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-text mb-0.5">Buscar SKU o escanear EAN</div>
                <div className="text-[11px] text-text-muted mb-2">
                  Pega o escanea el codigo de barra del producto fisico — UNIDATA lo
                  resuelve a SKU y abre el detalle (stock, ventas, ubicacion).
                </div>
                <SkuSearchBox
                  unit="unistore"
                  placeholder="Ej: 10IVA21 (SKU) o 1000010800002 (EAN)"
                  onSkuSelected={(sku) =>
                    router.push(`/dashboard/productos/${encodeURIComponent(sku)}`)
                  }
                />
              </div>
            </div>
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
            data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period })} />)
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
          ) : unit === "unistore" ? (
            <DailyRevenueChart
              points={data.lead_time_daily ?? []}
              caption="Lead time Order -> Despacho (60 dias)"
              subtitle="Promedio diario en dias"
            />
          ) : (
            <DailyRevenueChart
              points={data.daily_dispatch ?? []}
              caption="Despachos diarios (60 dias)"
              subtitle="OCA + LightData combinados"
            />
          )}
        </div>

        {unit === "unistore" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <HBarChart
                data={(data.stock_by_area ?? []).map((s) => ({ name: s.category, value: s.value, extra: s.extra }))}
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
                data={data.stock_critico ?? []}
                formatter="number"
                extraColumns={[
                  { key: "desc", label: "Descripcion", format: "raw" },
                  { key: "areas", label: "Areas", format: "number" },
                ]}
                showProgress={false}
              />
            )}
          </div>
        )}

        {unit === "unidrop" && data?.top_provinces && (
          <div className="mb-6">
            <HBarChart
              data={data.top_provinces.map((s) => ({ name: s.category, value: s.value, extra: s.extra }))}
              caption="Top provincias por envios (OCA)"
              formatter="number"
            />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Pedidos atascados (>5 dias)"
              subtitle="Pagados aun en estado abierto - click en una fila para ver items"
              data={data.stuck_orders}
              formatter="currency"
              extraColumns={
                unit === "unistore"
                  ? [
                      { key: "dias_atrasado", label: "Dias", format: "number" },
                      { key: "shipping", label: "Estado envio", format: "raw" },
                    ]
                  : [
                      { key: "dias_atrasado", label: "Dias", format: "number" },
                      { key: "payment", label: "Pago", format: "raw" },
                      { key: "status", label: "Estado", format: "raw" },
                    ]
              }
              showProgress={false}
              onRowClick={(r) => {
                const id = r.extra?.id;
                if (typeof id === "number") setDrillOrderId(id);
              }}
            />
          )}
          {unit === "unistore" && (isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Movimientos de ajuste por motivo"
              subtitle="Top 10 motivos en el periodo"
              data={data.ajustes ?? []}
              formatter="number"
              extraColumns={[
                { key: "altas", label: "+", format: "number" },
                { key: "bajas", label: "-", format: "number" },
              ]}
            />
          ))}
        </div>
      </div>

      {drillOrderId !== null && (
        <DrillDownModal
          title={`Items de la orden #${drillOrderId}`}
          subtitle="Productos incluidos en este pedido"
          endpoint={`/api/drilldowns/orders/${drillOrderId}/items`}
          filename={`orden_${drillOrderId}_items.csv`}
          onClose={() => setDrillOrderId(null)}
        />
      )}
    </>
  );
}
