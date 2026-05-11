"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { DailyRevenueChart } from "@/components/sparkline";
import { MultiLineChart } from "@/components/multi-line-chart";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { OrderDetailModal } from "@/components/order-detail-modal";
import { ExpandableOrderRow, type OrderRowData } from "@/components/expandable-order-row";
import { SmartSearch } from "@/components/smart-search";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type Unit = "unistore" | "unidrop";
type Channel = "all" | "tn" | "ml";

type CsResp = {
 unit: string;
 period: string;
 channel: string;
 cards: KpiCardT[];
 cancel_trend: TimeSeriesPoint[];
 volume_trend: TimeSeriesPoint[];
 cancel_reasons: CategoryValue[];
 cancel_by_province?: CategoryValue[];
 top_users_cancel?: CategoryValue[];
 recent_cancellations: CategoryValue[];
 cohort_retention?: CategoryValue[];
 customer_status_dist?: CategoryValue[];
 rfm_segments?: CategoryValue[];
 rfm_top?: CategoryValue[];
 top_customers_revenue?: CategoryValue[];
 acquisition_trend?: TimeSeriesPoint[];
 repurchase_distribution?: CategoryValue[];
 generated_at: string;
};

export default function CustomerSuccessPage() {
 const period = useGlobalFilters((s) => s.period);
 const customFrom = useGlobalFilters((s) => s.customFrom);
 const customTo = useGlobalFilters((s) => s.customTo);
 const _qs = periodToQuery(period, customFrom, customTo);
 const router = useRouter();
 const [unit, setUnit] = useState<Unit>("unistore");
 const [channel, setChannel] = useState<Channel>("all");
 const [drillCustomerId, setDrillCustomerId] = useState<{ id: number; name: string } | null>(null);
 const [drillOrderId, setDrillOrderId] = useState<number | null>(null);
 // Drilldown contextual de CS (estados de cliente y segmentos RFM)
 const [csDrill, setCsDrill] = useState<{ endpoint: string; title: string; subtitle: string; filename: string } | null>(null);

 const { data, isLoading, isFetching, error } = useQuery<CsResp>({
 queryKey: ["dashboards", "cs", unit, period, customFrom, customTo, channel],
 queryFn: () => api(`/api/dashboards/cs/${unit}?${_qs}&channel=${channel}`),
 staleTime: 60_000,
 });

 return (
 <>
 <Topbar
 title="Customer Success"
 subtitle="Cancelaciones, refunds, repeat purchase, customers en riesgo · Unistore + Unidrop"
 />
      
 <div className="flex-1 px-8 py-6 overflow-y-auto">
 <DashboardHeader
 generatedAt={data?.generated_at}
 isFetching={isFetching}
 filters={
 <>
 <Segmented<Unit>
 value={unit}
 onChange={setUnit}
 options={[
 { value: "unistore", label: "Unistore" },
 { value: "unidrop", label: "Unidrop" },
 ]}
 />
        <TodayPanel
          compact={period !== "today"}
          unit={unit}
          context="cs"
          title="Comparador HOY · Customer Success"
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
 </>
 }
 />

 {error && (
 <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
 Error: {(error as Error).message}
 </div>
 )}

 {/* Buscador rapido de cliente arriba del dashboard - el flow tipico de
     CS es 'tengo un caso de un cliente, buscar su perfil para entender
     el contexto antes de responder'. */}
 {unit === "unistore" && (
   <div className="mb-6">
     <SmartSearch mode="customers" unit="unistore" variant="hero" />
   </div>
 )}

 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
 {isLoading || !data ? (
 Array.from({ length: 6 }).map((_, i) => (
 <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
 ))
 ) : (
 data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, channel, unit })} />)
 )}
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
 <div className="xl:col-span-2">
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 ) : (
 <InteractiveMetricChart
 points={(() => {
   const map = new Map<string, any>();
   for (const p of (data.cancel_trend || [])) {
     map.set(p.date, { date: p.date, cancelaciones: p.value });
   }
   for (const p of (data.volume_trend || [])) {
     const existing = map.get(p.date) ?? { date: p.date };
     existing.volumen = p.value;
     map.set(p.date, existing);
   }
   return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
 })()}
 metrics={[
   { key: "cancelaciones", label: "Cancelaciones", kind: "number", color: "#ef4444" },
   { key: "volumen", label: "Volumen ventas", kind: "currency", color: "#10b981" },
 ]}
 defaultPrimary="cancelaciones"
 defaultSecondary="volumen"
 caption="Tendencia mensual · Cancelaciones vs Volumen (12m)"
 subtitle="Cruzar ambas: si las cancelaciones crecen junto al volumen es esperable; si crecen sin que crezca el volumen es alerta"
 height={320}
 />
 )}
 </div>
 <div>
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 ) : (
 <DonutChart
 caption="Motivos de cancelacion"
 data={data.cancel_reasons.map((p) => ({ name: p.category, value: p.value }))}
 />
 )}
 </div>
 </div>

 {/* VIP section (solo Unistore) */}
 {unit === "unistore" && <VipCsSection onDrill={setCsDrill} />}

 {/* -aligned: estados cliente + RFM (solo Unistore) */}
 {unit === "unistore" && data && (
 <>
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 <CategoryTable
 caption="Estados de cliente"
 subtitle="Click una fila para ver los customers de ese estado"
 data={data.customer_status_dist ?? []}
 formatter="number"
 extraColumns={[
 { key: "ticket_promedio", label: "Ticket avg", format: "currency" },
 { key: "revenue_total", label: "Revenue total", format: "currency" },
 ]}
 showProgress
 onRowClick={(r) => {
 const status = r.category;
 setCsDrill({
 endpoint: `/api/drilldowns/cs/customers-by-status?status=${encodeURIComponent(status)}`,
 title: `Customers en estado: ${status}`,
 subtitle: "Click en un cliente para abrir su perfil 360",
 filename: `cs_estado_${status.toLowerCase().replace(/\W+/g, "_")}.csv`,
 });
 }}
 />
 <CategoryTable
 caption="Segmentacion RFM"
 subtitle="Click una fila para ver los customers de ese segmento"
 data={data.rfm_segments ?? []}
 formatter="number"
 extraColumns={[
 { key: "revenue", label: "Revenue total", format: "currency" },
 ]}
 showProgress
 onRowClick={(r) => {
 const seg = r.category;
 setCsDrill({
 endpoint: `/api/drilldowns/cs/customers-by-rfm?segment=${encodeURIComponent(seg)}`,
 title: `Customers RFM: ${seg}`,
 subtitle: "Click en un cliente para abrir su perfil 360",
 filename: `cs_rfm_${seg.toLowerCase().replace(/\W+/g, "_")}.csv`,
 });
 }}
 />
 </div>
 <div className="mb-6">
 <CategoryTable
 caption="Top 20 Champions (RFM 4-5 en R, F y M)"
 subtitle="Click en una fila para abrir el customer 360"
 data={data.rfm_top ?? []}
 formatter="currency"
 extraColumns={[
 { key: "frequency", label: "Frec", format: "number" },
 { key: "recency_days", label: "Recency d", format: "number" },
 { key: "rfm_code", label: "RFM", format: "raw" },
 ]}
 showProgress={false}
 onRowClick={(r) => {
 const cid = r.extra?.customer_id;
 if (typeof cid === "number" && cid > 0) {
 router.push(`/dashboard/customer/${cid}`);
 }
 }}
 />
 </div>
 </>
 )}

 {unit === "unistore" && (
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 {isLoading || !data ? (
 <>
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 </>
 ) : (
 <>
 <CategoryTable
 caption="Top 10 provincias con mas cancelaciones"
 subtitle="Click en una fila para ver las ordenes paid de esa provincia"
 data={data.cancel_by_province ?? []}
 formatter="number"
 extraColumns={[{ key: "monto_perdido", label: "Monto perdido", format: "currency" }]}
 />
 <CategoryTable
 caption="Cohort retention (nuevos compradores)"
 subtitle="d30/d60/d90 = % que vuelve a comprar dentro de N dias"
 data={data.cohort_retention ?? []}
 formatter="number"
 extraColumns={[
 { key: "d30_pct", label: "d30 %", format: "number" },
 { key: "d60_pct", label: "d60 %", format: "number" },
 { key: "d90_pct", label: "d90 %", format: "number" },
 ]}
 showProgress={false}
 />
 </>
 )}
 </div>
 )}

 {unit === "unidrop" && data && (
 <>
 {/* CS-360: customer health */}
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 <CategoryTable
 caption="Estados de cliente"
 subtitle="Nuevo · 2da compra · Convertido a Recurrente · Recurrente"
 data={data.customer_status_dist ?? []}
 formatter="number"
 extraColumns={[
 { key: "ticket_promedio", label: "Ticket avg", format: "currency" },
 { key: "revenue_total", label: "Revenue total", format: "currency" },
 ]}
 showProgress
 />
 <CategoryTable
 caption="Distribucion de recompra"
 subtitle="# de compras por customer · concentracion en 1 sola es señal de bajo engagement"
 data={data.repurchase_distribution ?? []}
 formatter="number"
 showProgress
 />
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 <CategoryTable
 caption="Top 15 customers por revenue"
 subtitle="Los mejores - cuidarlos"
 data={data.top_customers_revenue ?? []}
 formatter="currency"
 extraColumns={[
 { key: "orders", label: "Ord", format: "number" },
 { key: "ultima_compra", label: "Ultima", format: "raw" },
 { key: "provincia", label: "Provincia", format: "raw" },
 ]}
 />
 <CategoryTable
 caption="Top 15 usuarios con mas cancelaciones"
 subtitle="Click para historial completo · clientes problematicos"
 data={data.top_users_cancel ?? []}
 formatter="number"
 extraColumns={[{ key: "monto", label: "Monto", format: "currency" }]}
 onRowClick={(r) => {
 const id = r.extra?.user_id;
 if (typeof id === "number" && id > 0) {
 setDrillCustomerId({ id, name: r.category });
 }
 }}
 />
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
 {data.acquisition_trend && data.acquisition_trend.length > 0 && (
 <InteractiveMetricChart
 points={data.acquisition_trend as any[]}
 metrics={[{ key: "value", label: "Nuevos customers", kind: "number", color: "#7a3eae" }]}
 defaultPrimary="value"
 caption="Adquisicion mensual (12m)"
 subtitle="Nuevos customers (primera compra) por mes"
 height={280}
 />
 )}
 {data.cancel_by_province && data.cancel_by_province.length > 0 && (
 <CategoryTable
 caption="Top 10 provincias con mas cancelaciones"
 subtitle="Donde mas se pierde - oportunidad de ajuste de operacion"
 data={data.cancel_by_province}
 formatter="number"
 extraColumns={[{ key: "monto_perdido", label: "Monto perdido", format: "currency" }]}
 />
 )}
 </div>
 </>
 )}

 <div className="grid grid-cols-1 gap-4">
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
 ) : (
 <div className="bg-surface border border-border rounded-xl p-5">
 <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
 <div>
 <div className="text-sm font-bold text-text">Cancelaciones recientes (top 20)</div>
 <div className="text-xs text-text-muted mt-0.5">
 {unit === "unistore"
 ? "Click en una fila para ver items de la orden"
 : "Si dice STAFF=si, fue intervencion de Unidrop. Click en cliente para 360"}
 </div>
 </div>
 <div className="flex items-center gap-2 text-[10px]">
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-error border border-red-200">
 <span className="w-1.5 h-1.5 rounded-full bg-error" /> staff
 </span>
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
 <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> pending
 </span>
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> paid
 </span>
 </div>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
 <th className="px-3 py-2 w-8">#</th>
 <th className="px-3 py-2">Numero / Cliente</th>
 <th className="px-3 py-2">Fecha</th>
 <th className="px-3 py-2">Estado del pedido</th>
 <th className="px-3 py-2 text-right">Total</th>
 <th className="px-3 py-2 w-10"></th>
 </tr>
 </thead>
 <tbody>
 {data.recent_cancellations.map((r, i) => {
 const e = r.extra ?? {};
 const dias = Number(e.dias_hace ?? 0);
 const isStaff = e.by_staff === "si";
 const id = Number(e.id ?? 0);
 // Para Unistore (TN orders) usamos el formato canonico ExpandableOrderRow.
 // Para Unidrop seguimos con render simple porque las cancelaciones MELI/TN
 // dropshipper no tienen /api/drilldowns/orders/{id}/detail (esa ruta es TN
 // Unistore).
 if (unit === "unistore" && id > 0) {
 const subtitleParts = [r.category];
 if (e.razon) subtitleParts.push(`Razón: ${e.razon}`);
 if (e.provincia) subtitleParts.push(String(e.provincia));
 if (dias) subtitleParts.push(`hace ${dias}d`);
 const orderRow: OrderRowData = {
 id,
 numero: String(e.orden ?? e.id ?? id),
 fecha: e.fecha ? String(e.fecha) : null,
 total: Number(r.value || 0),
 payment: e.payment ? String(e.payment) : null,
 shipping: e.shipping ? String(e.shipping) : null,
 status: "cancelled",
 empaquetada: false,
 subtitle: subtitleParts.join(" · "),
 badge: isStaff
 ? { label: "STAFF", cls: "bg-red-50 text-error border-red-200" }
 : null,
 };
 return (
 <ExpandableOrderRow
 key={i}
 order={orderRow}
 idx={i + 1}
 onOpenDetail={(oid) => setDrillOrderId(oid)}
 cols={6}
 />
 );
 }
 // Render simple para Unidrop (sin expand)
 const payment = String(e.payment ?? "");
 const payClass =
 payment === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
 payment === "pending" ? "bg-amber-50 text-amber-800 border-amber-200" :
 "bg-zinc-100 text-zinc-700 border-zinc-300";
 return (
 <tr key={i} className="border-t border-border hover:bg-soft transition">
 <td className="px-3 py-2 text-text-muted text-xs">{i + 1}</td>
 <td className="px-3 py-2">
 <div className="font-mono font-semibold text-primary">#{e.orden ?? e.id}</div>
 <div className="text-[10px] text-text-muted mt-0.5">
 {r.category}{e.razon ? ` · ${e.razon}` : ""}{e.provincia ? ` · ${e.provincia}` : ""}{dias ? ` · hace ${dias}d` : ""}
 </div>
 </td>
 <td className="px-3 py-2 text-xs text-text-muted">{e.fecha ?? "—"}</td>
 <td className="px-3 py-2">
 <div className="flex items-center gap-1.5">
 <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200 font-semibold">Cancelada</span>
 {payment && (
 <span className={"inline-block text-[10px] px-2 py-0.5 rounded-full border " + payClass}>{payment}</span>
 )}
 {isStaff && (
 <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border bg-red-50 text-error border-red-200 font-bold">STAFF</span>
 )}
 </div>
 </td>
 <td className="px-3 py-2 text-right font-bold tabular-nums">$ {Number(r.value).toLocaleString("es-AR")}</td>
 <td className="px-3 py-2" />
 </tr>
 );
 })}
 {!data.recent_cancellations.length && (
 <tr><td colSpan={6} className="py-10 text-center text-text-muted">Sin cancelaciones en el periodo.</td></tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 </div>

 {drillCustomerId && (
 <DrillDownModal
 title={`Historial de ${drillCustomerId.name}`}
 subtitle="Cancelaciones y ordenes (TN/ML del usuario Unidrop)"
 endpoint={`/api/drilldowns/customers/${drillCustomerId.id}/orders`}
 filename={`user_${drillCustomerId.id}_orders.csv`}
 onClose={() => setDrillCustomerId(null)}
 />
 )}
 {csDrill && (
 <DrillDownModal
 title={csDrill.title}
 subtitle={csDrill.subtitle}
 endpoint={csDrill.endpoint}
 filename={csDrill.filename}
 onClose={() => setCsDrill(null)}
 />
 )}
 <OrderDetailModal orderId={drillOrderId} onClose={() => setDrillOrderId(null)} />
 </>
 );
}

// Seccion VIP en Customer Success con cards Gold/Silver/Bronze clickeables.
function VipCsSection({
 onDrill,
}: {
 onDrill: (d: { endpoint: string; title: string; subtitle: string; filename: string }) => void;
}) {
 const { data } = useQuery<{
  total_vips: number;
  tiers: {
   gold: { count: number; lifetime_total: number };
   silver: { count: number; lifetime_total: number };
   bronze: { count: number; lifetime_total: number };
  };
  lifetime_total: number;
 }>({
  queryKey: ["vip-overview"],
  queryFn: () => api("/api/dashboards/customers-vip/overview"),
  staleTime: 5 * 60_000,
 });
 if (!data || data.total_vips === 0) return null;
 const cards = [
  { tier: "all", label: "Total VIPs", count: data.total_vips, lifetime: data.lifetime_total, icon: "★", bg: "from-violet-500 to-fuchsia-600", border: "border-violet-300" },
  { tier: "gold", label: "Gold", count: data.tiers.gold.count, lifetime: data.tiers.gold.lifetime_total, icon: "👑", bg: "from-yellow-400 to-amber-500", border: "border-amber-400" },
  { tier: "silver", label: "Silver", count: data.tiers.silver.count, lifetime: data.tiers.silver.lifetime_total, icon: "💎", bg: "from-slate-400 to-zinc-500", border: "border-slate-400" },
  { tier: "bronze", label: "Bronze", count: data.tiers.bronze.count, lifetime: data.tiers.bronze.lifetime_total, icon: "⭐", bg: "from-orange-400 to-amber-500", border: "border-amber-400" },
 ];
 return (
  <div className="mb-6">
   <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
    <div>
     <h3 className="text-sm font-bold text-text">Clientes VIP — segmentar por tier</h3>
     <p className="text-[11px] text-text-muted">Click cualquier card para abrir el listado completo · CSV/Excel exportable</p>
    </div>
    <a
     href="/dashboard/exports?team=Marketing"
     className="text-[11px] font-semibold text-primary hover:underline"
    >
     Ver en Centro de Exportaciones →
    </a>
   </div>
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {cards.map((c) => (
     <button
      key={c.tier}
      onClick={() => onDrill({
       endpoint: `/api/dashboards/customers-vip?tier=${c.tier}`,
       title: c.tier === "all" ? "Todos los clientes VIP" : `Clientes VIP ${c.label}`,
       subtitle: "Click un cliente para abrir su perfil 360 - exportable a Excel/CSV",
       filename: `vip_${c.tier}.csv`,
      })}
      className={`bg-surface border-2 ${c.border} rounded-xl p-4 hover:shadow-lg transition text-left group`}
     >
      <div className="flex items-start justify-between mb-2">
       <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{c.label}</div>
       <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${c.bg} text-white flex items-center justify-center shadow-md text-base`}>
        {c.icon}
       </div>
      </div>
      <div className="text-2xl font-extrabold text-text tabular-nums">{c.count.toLocaleString("es-AR")}</div>
      <div className="text-[10px] text-text-muted mt-0.5">
       Lifetime: <span className="font-bold text-text">$ {(c.lifetime / 1_000_000).toFixed(1)}M</span>
      </div>
     </button>
    ))}
   </div>
  </div>
 );
}
