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
import { DonutChart } from "@/components/donut-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { DrillDownModal } from "@/components/drilldown-modal";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { useUnitFromQuery, type Unit } from "@/lib/use-unit-from-query";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";


type LogResp = {
  unit?: string;
  period: string;
  area?: string;
  source?: string;
  cards: KpiCardT[];
  funnel: CategoryValue[];
  lead_time_daily?: TimeSeriesPoint[];
  lead_time_etapas?: { pedido_to_prep_avg: number | null; prep_to_despacho_avg: number | null };
  daily_dispatch?: TimeSeriesPoint[];
  stock_by_area?: CategoryValue[];
  stock_critico?: CategoryValue[];
  stock_por_contenedor?: CategoryValue[];
  ajustes?: CategoryValue[];
  top_provinces?: CategoryValue[];
  top_localidades?: CategoryValue[];
  by_estado?: CategoryValue[];
  top_skus?: CategoryValue[];
  items_pendientes?: CategoryValue[];
  prep_throughput?: Array<{ date: string; creadas: number; finalizadas: number }>;
  stuck_orders: CategoryValue[];
  generated_at: string;
};

const DIGIP_ESTADO_COLORS: Record<string, string> = {
  pendiente: "#facc15",
  preparacion: "#7a3eae",
  completo: "#22c55e",
  eliminado: "#fb2c36",
};

export default function LogisticaPage() {
  const router = useRouter();
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit, unitLocked] = useUnitFromQuery("unistore");
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
        title={`Centro Logístico · ${unit === "unistore" ? "Unistore" : "Unidrop"}`}
        subtitle={
          unit === "unistore"
            ? "DigiP cerebro · funnel item-level · throughput preparacion · items pendientes · stock por contenedor"
            : "DigiP (digip_dev) cerebro · estados pendiente/preparacion/completo · enriquecido con MELI"
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
              disabled={unitLocked}
              lockedHint={unitLocked ? `Fijado a ${unit}` : undefined}
              options={[
                { value: "unistore", label: "Unistore" },
                { value: "unidrop", label: "Unidrop" },
              ]}
            />
          }
        />
        <TodayPanel
          unit={unit}
          context="logistica"
          title="HOY · Logistica"
        />

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
            <InteractiveMetricChart
              points={(data.lead_time_daily ?? []) as any[]}
              metrics={[{ key: "value", label: "Lead time (días)", kind: "number", color: "#f59e0b" }]}
              defaultPrimary="value"
              caption="Lead time Order -> Despacho (60 dias)"
              subtitle="Promedio diario en dias"
              height={280}
            />
          ) : (
            <InteractiveMetricChart
              points={(data.daily_dispatch ?? []) as any[]}
              metrics={[{ key: "value", label: "Completados", kind: "number", color: "#7a3eae" }]}
              defaultPrimary="value"
              caption="Pedidos completados por dia (60 dias)"
              subtitle="DigiP: estado=completo"
              height={280}
            />
          )}
        </div>

        {unit === "unistore" && (
          <>
            {/* F1: Donut por estado + Lead time desglosado 2 etapas */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
              {isLoading || !data ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse xl:col-span-1" />
              ) : (
                <DonutChart
                  data={(data.by_estado ?? []).map((s) => ({ name: s.category, value: s.value }))}
                  caption="Distribucion por estado (DigiP)"
                  colorMap={DIGIP_ESTADO_COLORS}
                  height={280}
                />
              )}
              {isLoading || !data ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse xl:col-span-2" />
              ) : (
                <div className="bg-surface border border-border rounded-xl p-5 xl:col-span-2">
                  <div className="text-sm font-semibold text-text mb-1">Lead time desglosado</div>
                  <div className="text-[11px] text-text-muted mb-4">
                    Las 2 etapas del proceso DigiP en el periodo
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-bg border border-border rounded-lg p-4">
                      <div className="text-[11px] text-text-muted">Pedido → Preparacion</div>
                      <div className="text-3xl font-bold text-text mt-1">
                        {data.lead_time_etapas?.pedido_to_prep_avg ?? "—"}
                        <span className="text-sm font-normal text-text-muted ml-1">dias</span>
                      </div>
                      <div className="text-[11px] text-text-muted mt-2">
                        Tiempo promedio hasta empezar a preparar
                      </div>
                    </div>
                    <div className="bg-bg border border-border rounded-lg p-4">
                      <div className="text-[11px] text-text-muted">Preparacion → Despacho</div>
                      <div className="text-3xl font-bold text-text mt-1">
                        {data.lead_time_etapas?.prep_to_despacho_avg ?? "—"}
                        <span className="text-sm font-normal text-text-muted ml-1">dias</span>
                      </div>
                      <div className="text-[11px] text-text-muted mt-2">
                        Tiempo desde preparacion lista hasta despacho
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* F2: Throughput preparacion (creadas vs finalizadas) */}
            {data?.prep_throughput && data.prep_throughput.length > 0 && (
              <div className="mb-6">
                <InteractiveMetricChart
                  points={data.prep_throughput as any[]}
                  metrics={[
                    { key: "creadas", label: "Preparaciones creadas", kind: "number", color: "#7a3eae" },
                    { key: "finalizadas", label: "Preparaciones finalizadas", kind: "number", color: "#22c55e" },
                  ]}
                  defaultPrimary="creadas"
                  caption="Throughput de preparacion (60 dias)"
                  subtitle="Comparar creadas vs finalizadas - gap = acumulacion"
                  height={300}
                />
              </div>
            )}

            {/* F1+F2: Stock por area + por contenedor */}
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
                <HBarChart
                  data={(data.stock_por_contenedor ?? []).map((s) => ({ name: s.category, value: s.value, extra: s.extra }))}
                  caption="Stock por contenedor (top 15)"
                  formatter="number"
                />
              )}
            </div>

            {/* F1: Top SKUs pedidos + Items pendientes por SKU */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              {isLoading || !data ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              ) : (
                <CategoryTable
                  caption="Top SKUs pedidos"
                  subtitle="Unidades pedidas en el periodo - click abre el producto 360"
                  data={data.top_skus ?? []}
                  formatter="number"
                  extraColumns={[
                    { key: "desc", label: "Descripcion", format: "raw" },
                    { key: "pedidos", label: "Pedidos", format: "number" },
                  ]}
                  showProgress={false}
                  onRowClick={(r) => {
                    const sku = r.category;
                    if (sku && sku !== "(sin)") {
                      router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
                    }
                  }}
                />
              )}
              {isLoading || !data ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              ) : (
                <CategoryTable
                  caption="Items pendientes (gap pedido - despacho)"
                  subtitle="Unidades pedidas sin despacho efectivo - bottleneck operativo"
                  data={data.items_pendientes ?? []}
                  formatter="number"
                  extraColumns={[
                    { key: "desc", label: "Descripcion", format: "raw" },
                    { key: "uds_pedidas", label: "Pedidas", format: "number" },
                    { key: "uds_despachadas", label: "Desp.", format: "number" },
                  ]}
                  showProgress={false}
                  onRowClick={(r) => {
                    const sku = r.category;
                    if (sku && sku !== "(sin)") {
                      router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
                    }
                  }}
                />
              )}
            </div>

            {/* F1: Top localidades + Stock critico */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              {isLoading || !data ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              ) : (
                <HBarChart
                  data={(data.top_localidades ?? []).map((s) => ({
                    name: s.category,
                    value: s.value,
                    extra: s.extra,
                  }))}
                  caption="Top localidades de despacho"
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
          </>
        )}

        {unit === "unidrop" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <DonutChart
                data={(data.by_estado ?? []).map((s) => ({ name: s.category, value: s.value }))}
                caption="Distribucion por estado (DigiP)"
                colorMap={DIGIP_ESTADO_COLORS}
                height={300}
              />
            )}
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            ) : (
              <HBarChart
                data={(data.top_provinces ?? []).map((s) => ({ name: s.category, value: s.value, extra: s.extra }))}
                caption="Top provincias (clientes_ubicaciones)"
                formatter="number"
              />
            )}
          </div>
        )}

        {unit === "unidrop" && data?.top_skus && data.top_skus.length > 0 && (
          <div className="mb-6">
            <CategoryTable
              caption="Top SKUs preparados"
              subtitle="Unidades pedidas vs unidades satisfechas en el periodo"
              data={data.top_skus}
              formatter="number"
              extraColumns={[
                { key: "desc", label: "Descripcion", format: "raw" },
                { key: "uds_satisfechas", label: "Satisf.", format: "number" },
                { key: "pedidos", label: "Pedidos", format: "number" },
              ]}
              showProgress={false}
            />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          ) : (
            <CategoryTable
              caption="Pedidos atascados (>5 dias)"
              subtitle={
                unit === "unistore"
                  ? "Pagados aun en estado abierto - click en una fila para ver items"
                  : "DigiP: pendiente/preparacion > 5 dias - enriquecido con MELI"
              }
              data={data.stuck_orders}
              formatter="currency"
              extraColumns={
                unit === "unistore"
                  ? [
                      { key: "dias_atrasado", label: "Dias", format: "number" },
                      { key: "shipping", label: "Estado TN", format: "raw" },
                      { key: "digip_estado", label: "Estado DigiP", format: "raw" },
                    ]
                  : [
                      { key: "dias_atrasado", label: "Dias", format: "number" },
                      { key: "estado", label: "Estado DigiP", format: "raw" },
                      { key: "provincia", label: "Provincia", format: "raw" },
                      { key: "ml_status", label: "ML status", format: "raw" },
                    ]
              }
              showProgress={false}
              onRowClick={(r) => {
                const id = r.extra?.id;
                // Unistore: id numerico = TN order id -> abre drilldown
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
