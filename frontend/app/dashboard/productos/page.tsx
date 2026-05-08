"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ScanBarcode } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { SkuSearchBox } from "@/components/sku-search-box";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { CategoryTable } from "@/components/generic-table";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
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

export default function ProductosPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [channel, setChannel] = useState<Channel>("all");
  const router = useRouter();

  const { data, isLoading, isFetching, error } = useQuery<ProductsResp>({
    queryKey: ["dashboards", "products", period, customFrom, customTo, channel],
    queryFn: () => api(`/api/dashboards/products?${_qs}&channel=${channel}`),
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
        subtitle="Top SKUs cross-canal · stock · sin movimiento · drill por SKU"
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
        <TodayPanel compact={period !== "today"} unit="unistore" />

        {/* Buscador SKU / EAN */}
        <div className="mb-6 bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
              <ScanBarcode size={18} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-text mb-0.5">Buscar SKU o escanear EAN</div>
              <div className="text-[11px] text-text-muted mb-2">
                Tipea SKU o escanea EAN — UNIDATA lo resuelve y abre el detalle del producto.
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

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {isLoading || !data
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
              ))
            : data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, channel })} />)}
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
                caption="Top 20 productos por revenue"
                subtitle="Click en una fila para ver el SKU 360"
                data={data.top_products}
                formatter="currency"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "units", label: "Unid", format: "number" },
                  { key: "orders", label: "Ord", format: "number" },
                  { key: "customers", label: "Clientes", format: "number" },
                ]}
                onRowClick={goSku}
              />
              <CategoryTable
                caption="Top 10 marcas"
                subtitle="Revenue + productos distintos vendidos"
                data={data.top_brands}
                formatter="currency"
                extraColumns={[
                  { key: "productos", label: "Productos", format: "number" },
                  { key: "units", label: "Unid", format: "number" },
                ]}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            </>
          ) : (
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
                  { key: "brand", label: "Marca", format: "raw" },
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
