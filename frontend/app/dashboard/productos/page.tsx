"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { SmartSearch } from "@/components/smart-search";
import { KpiChipStrip } from "@/components/kpi-chip-strip";
import { getCardDrill } from "@/lib/kpi-drill";
import { CategoryTable } from "@/components/generic-table";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { SkuMasterTable, type SkuRow } from "@/components/sku-master-table";
import { ProductsTrendCharts, type ProductsUnit } from "@/components/products-trend-charts";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue } from "@/lib/types";

type Channel = "all" | "tn" | "ml";

type ProductsResp = {
  period: string;
  channel: string;
  cards: KpiCardT[];
  top_products: CategoryValue[];
  top_brands: CategoryValue[];
  sin_movimiento: CategoryValue[];
  stock_critico_alerta: CategoryValue[];
  generated_at: string;
};

type MasterTableResp = {
  period: string;
  channel: string;
  skus: SkuRow[];
  summary: {
    total_skus: number;
    total_revenue: number;
    total_ganancia: number;
    skus_clase_a: number;
    skus_clase_b: number;
    skus_clase_c: number;
    skus_growth: number;
    skus_declive: number;
    skus_nuevos_7d: number;
    skus_stockout_risk: number;
    skus_con_costo: number;
  };
  generated_at: string;
};

export default function ProductosPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit] = useState<ProductsUnit>("unistore");
  const [channel, setChannel] = useState<Channel>("all");
  const router = useRouter();
  const isUnistore = unit === "unistore";

  const { data, isLoading, isFetching, error } = useQuery<ProductsResp>({
    queryKey: ["dashboards", "products", period, customFrom, customTo, channel, unit],
    queryFn: () => api(`/api/dashboards/products?${_qs}&channel=${channel}&unit=${unit}`),
    staleTime: 60_000,
  });

  const { data: master, isLoading: masterLoading } = useQuery<MasterTableResp>({
    queryKey: ["dashboards", "products-master", period, customFrom, customTo, channel, unit],
    queryFn: () => api(`/api/dashboards/products/master-table?${_qs}&channel=${channel}&unit=${unit}`),
    staleTime: 60_000,
  });

  const goSku = (r: CategoryValue) => {
    const sku = r.extra?.sku;
    if (typeof sku === "string" && sku) router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
  };

  return (
    <>
      <Topbar
        title="Productos"
        subtitle="Catalogo · ABC × XYZ · lifecycle · DoI · ganancia · 17 dimensiones por SKU"
      />

      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<ProductsUnit>
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "unistore", label: "Unistore" },
                  { value: "unidrop", label: "Unidrop" },
                ]}
              />
              {isUnistore && (
                <Segmented<Channel>
                  value={channel}
                  onChange={setChannel}
                  options={[
                    { value: "all", label: "TN + ML" },
                    { value: "tn", label: "Tienda Nube" },
                    { value: "ml", label: "Mercado Libre" },
                  ]}
                />
              )}
            </div>
          }
        />
        <TodayPanel
          unit={unit}
          context="productos"
          title={`HOY · Productos ${unit === "unidrop" ? "Unidrop" : "Unistore"}`}
        />

        {/* Buscador SKU / EAN con autocomplete + dropdown de matches */}
        <div className="mb-6">
          <SmartSearch mode="skus" unit={unit} variant="hero" />
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        {/* Strip denso de KPIs (cards distintos segun unit) */}
        {isLoading || !data ? (
          <div className="flex flex-wrap gap-2 mb-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-lg h-[68px] w-[140px] animate-pulse" />
            ))}
          </div>
        ) : (
          <KpiChipStrip
            cards={data.cards}
            getDrill={isUnistore ? (label) => getCardDrill(label, { period, channel }) : undefined}
          />
        )}

        {/* Graficos de tendencias con storytelling */}
        <ProductsTrendCharts unit={unit} />

        {/* Tabla maestra por SKU */}
        <div className="mb-6">
          {masterLoading || !master ? (
            <div className="bg-surface border border-border rounded-xl h-[600px] animate-pulse" />
          ) : (
            <SkuMasterTable data={master.skus} summary={master.summary} />
          )}
        </div>

        {/* Tablas operativas: cambian segun unit */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            </>
          ) : isUnistore ? (
            <>
              <CategoryTable
                caption="Stock critico que se sigue vendiendo"
                subtitle="Stock <= 5 y con ventas en 30d. Alerta operativa"
                data={data.stock_critico_alerta}
                formatter="number"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "stock", label: "Stock", format: "number" },
                ]}
                showProgress={false}
                onRowClick={goSku}
              />
              <CategoryTable
                caption="Sin movimiento (>90d) con stock"
                subtitle="Top 20 SKUs en catalogo sin venta hace 90+ dias"
                data={data.sin_movimiento}
                formatter="number"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "stock", label: "Stock", format: "number" },
                ]}
                showProgress={false}
                onRowClick={goSku}
              />
            </>
          ) : (
            <>
              <CategoryTable
                caption="SKUs en aceleracion"
                subtitle="Revenue del periodo > 2x el periodo anterior. Productos despegando."
                data={data.stock_critico_alerta}
                formatter="currency"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "growth_x", label: "Multiplo", format: "raw" },
                ]}
                showProgress={false}
                onRowClick={goSku}
              />
              <CategoryTable
                caption="Sin movimiento (>90d)"
                subtitle="Top 20 SKUs Unidrop vendidos en 12m sin venta hace 90+ dias"
                data={data.sin_movimiento}
                formatter="currency"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "units_12m", label: "Uds 12m", format: "number" },
                ]}
                showProgress={false}
                onRowClick={goSku}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
