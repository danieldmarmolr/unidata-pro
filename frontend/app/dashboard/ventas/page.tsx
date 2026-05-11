"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { RevenueChart } from "@/components/revenue-chart";
import { DonutChart } from "@/components/donut-chart";
import { HBarChart } from "@/components/bar-chart";
import { DailyRevenueChart } from "@/components/sparkline";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { TopProductsTable } from "@/components/top-products";
import { CategoryTable } from "@/components/generic-table";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { SalesOverview } from "@/lib/types";

type Channel = "all" | "tn" | "ml";
type Unit = "unistore" | "unidrop";

type Drill =
 | { kind: "product"; productId: string; name: string }
 | { kind: "province"; province: string }
 | { kind: "user"; userId: number; name: string };

export default function VentasPage() {
 const period = useGlobalFilters((s) => s.period);
 const customFrom = useGlobalFilters((s) => s.customFrom);
 const customTo = useGlobalFilters((s) => s.customTo);
 const _qs = periodToQuery(period, customFrom, customTo);
 const router = useRouter();
 const [unit, setUnit] = useState<Unit>("unistore");
 const [channel, setChannel] = useState<Channel>("all");
 const [drill, setDrill] = useState<Drill | null>(null);

 const { data, isLoading, isFetching, error } = useQuery<SalesOverview & { top_users?: { category: string; value: number; extra?: Record<string, number | string | null> | null }[] }>({
 queryKey: ["dashboards", "sales", unit, period, customFrom, customTo, channel],
 queryFn: () =>
 api(`/api/dashboards/sales/${unit}?${_qs}&channel=${channel}`),
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
 title={`Ventas ${unit === "unistore" ? "Unistore" : "Unidrop"}`}
 subtitle={
 unit === "unistore"
 ? "Tienda Nube + Mercado Libre · revenue, ordenes, top productos, geografia"
 : "Operadores Unidrop · TN + ML procesados a traves de la plataforma"
 }
 />
      <div className="px-8 pt-6"><TodayPanel compact={period !== "today"} /></div>
      
 <div className="flex-1 px-8 py-6 overflow-y-auto">
 <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
 <div className="flex items-center gap-3 flex-wrap">
 <Segmented<Unit>
 value={unit}
 onChange={setUnit}
 options={[
 { value: "unistore", label: "Unistore" },
 { value: "unidrop", label: "Unidrop" },
 ]}
 />
 <Segmented<Channel>
 value={channel}
 onChange={setChannel}
 options={[
 { value: "all", label: "TN + ML" },
 { value: "tn", label: "Tienda Nube" },
 { value: "ml", label: "Mercado Libre" },
 ]}
 />
 </div>
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
 data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, channel, unit })} />)
 )}
 </div>

 {/* Daily revenue + Payment status donut */}
 <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
 <div className="xl:col-span-2">
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 ) : (
 <InteractiveMetricChart
 points={data.daily_revenue as any[]}
 metrics={[{ key: "value", label: "Revenue diario", kind: "currency", color: "#7a3eae" }]}
 defaultPrimary="value"
 caption={`Revenue diario · ultimos ${period}`}
 subtitle="Suma de TN (paid) + ML (paid/confirmed/shipped/delivered)"
 height={320}
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
 <CategoryTable
 caption="Top 10 provincias por revenue (TN)"
 subtitle="Click en una fila para ver el detalle de las ordenes"
 data={data.top_provinces}
 formatter="currency"
 extraColumns={[{ key: "orders", label: "Ord", format: "number" }]}
 onRowClick={(r) => setDrill({ kind: "province", province: r.category })}
 />
 )}
 </div>

 {/* Region AR + Horario (solo Unistore) */}
 {unit === "unistore" && data && (
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 <CategoryTable
 caption="Distribucion por region"
 subtitle="AMBA · Buenos Aires · Centro · NOA · NEA · Cuyo · Patagonia"
 data={data.by_region ?? []}
 formatter="currency"
 extraColumns={[{ key: "orders", label: "Ord", format: "number" }]}
 />
 <CategoryTable
 caption="Analisis horario"
 subtitle="Cuando compran tus customers - en orders pagas"
 data={data.by_hour ?? []}
 formatter="number"
 extraColumns={[
 { key: "ticket_avg", label: "Ticket avg", format: "currency" },
 { key: "revenue", label: "Revenue", format: "currency" },
 ]}
 />
 </div>
 )}

 {/* Markup */}
 {unit === "unistore" && data && (
 <div className="mb-6">
 {!data.cost_data_available && (
 <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
 ⚠ <strong>Costo no disponible:</strong> el campo <code>OrderItem.cost</code> esta
 vacio en los 455k registros. Sin costo no se calcula markup. Cuando se integre el
 costo (probablemente desde Digip o Contabilium) los datos aparecen automaticamente.
 </div>
 )}
 <CategoryTable
 caption={data.cost_data_available ? "Top productos con markup" : "Top productos por revenue (sin markup)"}
 subtitle="En el periodo - solo orders pagas"
 data={data.top_markup ?? []}
 formatter="currency"
 extraColumns={[
 { key: "sku", label: "SKU", format: "raw" },
 { key: "units", label: "Units", format: "number" },
 { key: "revenue", label: "Revenue", format: "currency" },
 { key: "costo", label: "Costo", format: "currency" },
 { key: "markup_pct", label: "Markup %", format: "raw" },
 ]}
 showProgress={false}
 onRowClick={(r) => {
 const sku = r.extra?.sku;
 if (typeof sku === "string" && sku) {
 router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
 }
 }}
 />
 </div>
 )}

 {/* Top products (Unistore) o Top users (Unidrop) */}
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
 ) : unit === "unistore" ? (
 <TopProductsTable
 data={data.top_products ?? []}
 onRowClick={(p) => {
 if (unit === "unistore" && p.sku) {
 router.push(`/dashboard/productos/${encodeURIComponent(p.sku)}`);
 } else if (p.product_id) {
 setDrill({ kind: "product", productId: p.product_id, name: p.name });
 }
 }}
 />
 ) : (
 <CategoryTable
 caption="Top 15 usuarios Unidrop por revenue"
 subtitle="Operadores que mas vendieron en el periodo · click para historial"
 data={data.top_users ?? []}
 formatter="currency"
 extraColumns={[{ key: "orders", label: "Ord", format: "number" }]}
 onRowClick={(r) => {
 const id = r.extra?.user_id;
 if (typeof id === "number" && id > 0) {
 setDrill({ kind: "user", userId: id, name: r.category });
 }
 }}
 />
 )}
 </div>

 {drill?.kind === "product" && (
 <DrillDownModal
 title={`Detalle de "${drill.name}"`}
 subtitle={`Ordenes con este producto en los ultimos ${period}`}
 endpoint={`/api/drilldowns/products/${encodeURIComponent(drill.productId)}/orders?${_qs}`}
 filename={`producto_${drill.productId}_orders.csv`}
 onClose={() => setDrill(null)}
 />
 )}
 {drill?.kind === "province" && (
 <DrillDownModal
 title={`Ordenes en ${drill.province}`}
 subtitle={`Pagadas en los ultimos ${period}`}
 endpoint={`/api/drilldowns/provinces/${encodeURIComponent(drill.province)}/orders?${_qs}`}
 filename={`provincia_${drill.province}_orders.csv`}
 onClose={() => setDrill(null)}
 />
 )}
 {drill?.kind === "user" && (
 <DrillDownModal
 title={`Historial de ${drill.name}`}
 subtitle="Ordenes Unidrop del usuario"
 endpoint={`/api/drilldowns/customers/${drill.userId}/orders`}
 filename={`user_${drill.userId}_orders.csv`}
 onClose={() => setDrill(null)}
 />
 )}
 </>
 );
}
