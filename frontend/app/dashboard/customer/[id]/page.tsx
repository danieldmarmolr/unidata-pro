"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { DailyRevenueChart } from "@/components/sparkline";
import { InteractiveMetricChart, type MetricDef } from "@/components/interactive-metric-chart";
import { OrderDetailModal } from "@/components/order-detail-modal";
import { api } from "@/lib/api";
import { useTableSort, SortHeader } from "@/lib/use-table-sort";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ArrowLeft, Mail, MapPin, Smartphone, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { OrderStatusPipeline } from "@/components/order-status-pipeline";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeriesPoint } from "@/lib/types";

type Detail = {
 customer_info: {
 id: number;
 name: string;
 email: string;
 phone: string;
 total_spent: number;
 province: string;
 city: string;
 type: string;
 first_interaction: string | null;
 active: boolean | null;
 accepts_marketing: boolean | null;
 } | null;
 cards: KpiCardT[];
 orders: CategoryValue[];
 top_products: CategoryValue[];
 monthly_trend: TimeSeriesPoint[];
 generated_at: string;
};

type OrderItem = {
 id: number;
 name: string;
 sku: string;
 quantity: number;
 price: number;
 subtotal: number;
 imagen?: string | null;
};

function waLink(phone: string): string | null {
 const d = (phone || "").replace(/\D/g, "");
 if (!d) return null;
 if (d.startsWith("549")) return `https://wa.me/${d}`;
 if (d.startsWith("54")) return `https://wa.me/549${d.slice(2)}`;
 if (d.startsWith("0")) return `https://wa.me/549${d.slice(1)}`;
 if (d.length === 10) return `https://wa.me/549${d}`;
 return `https://wa.me/${d}`;
}

const STATUS_BADGE: Record<string, string> = {
 open: "bg-blue-50 text-blue-700 border-blue-200",
 closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
 cancelled: "bg-zinc-100 text-zinc-700 border-zinc-300",
 paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
 pending: "bg-amber-50 text-amber-800 border-amber-200",
 voided: "bg-zinc-100 text-zinc-700 border-zinc-300",
 refunded: "bg-amber-50 text-amber-800 border-amber-200",
 delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
 shipped: "bg-blue-50 text-blue-700 border-blue-200",
 unpacked: "bg-amber-50 text-amber-800 border-amber-200",
 unshipped: "bg-amber-50 text-amber-800 border-amber-200",
};

function StatusPill({ value }: { value: string }) {
 if (!value) return <span className="text-text-muted text-xs">—</span>;
 return (
 <span className={"inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold " + (STATUS_BADGE[value] ?? "bg-soft text-text-muted border-border")}>
 {value}
 </span>
 );
}

function ExpandableOrderRow({ order, idx, onOpenDetail }: { order: CategoryValue; idx: number; onOpenDetail: (id: number) => void }) {
 const [open, setOpen] = useState(false);
 const e = order.extra ?? {};
 const orderId = Number(e.id ?? 0);

 const { data: items, isLoading } = useQuery<{ rows: any[][]; columns: string[] }>({
 queryKey: ["order-items", orderId],
 queryFn: () => api(`/api/drilldowns/orders/${orderId}/items`),
 enabled: open && !!orderId,
 staleTime: 5 * 60_000,
 });

 const orderDetail = useQuery<{ items: OrderItem[] }>({
 queryKey: ["order-items-with-img", orderId],
 queryFn: () => api(`/api/drilldowns/orders/${orderId}/detail`),
 enabled: open && !!orderId,
 staleTime: 5 * 60_000,
 });

 return (
 <>
 <tr
 className={"border-t border-border hover:bg-soft transition cursor-pointer " + (open ? "bg-soft" : "")}
 onClick={() => setOpen((v) => !v)}
 >
 <td className="px-3 py-2 align-middle text-text-muted text-xs">{idx}</td>
 <td className="px-3 py-2 align-middle">
 <div className="flex items-center gap-2 font-mono font-semibold text-primary">
 {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
 #{order.category}
 </div>
 </td>
 <td className="px-3 py-2 align-middle text-xs text-text-muted">{e.fecha ?? "—"}</td>
 <td className="px-3 py-2 align-middle">
  <OrderStatusPipeline
    payment={e.payment}
    shipping={e.shipping}
    orderStatus={e.status}
    packed={e.empaquetada}
    canal={e.canal}
    compact
  />
 </td>
 <td className="px-3 py-2 align-middle text-right font-bold tabular-nums">{formatCurrency(order.value)}</td>
 <td className="px-3 py-2 align-middle text-center">
 <button
 onClick={(ev) => { ev.stopPropagation(); onOpenDetail(orderId); }}
 className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary"
 title="Abrir detalle completo"
 >
 <ExternalLink size={12} />
 </button>
 </td>
 </tr>
 {open && (
 <tr>
 <td colSpan={8} className="bg-bg border-t border-border p-0">
 <div className="px-12 py-4">
 {isLoading || orderDetail.isLoading ? (
 <div className="text-text-muted text-sm py-4">Cargando items...</div>
 ) : orderDetail.data?.items && orderDetail.data.items.length > 0 ? (
 <>
 <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
 Producto · Unidades · Precio unitario · Total
 </div>
 <div className="space-y-1">
 {orderDetail.data.items.map((it) => (
 <a
 key={it.id}
 href={it.sku ? `/dashboard/productos/${encodeURIComponent(it.sku)}` : "#"}
 target={it.sku ? "_blank" : undefined}
 rel="noopener noreferrer"
 className="grid grid-cols-[48px_1fr_60px_100px_100px] gap-3 items-center px-2 py-2 rounded hover:bg-soft transition"
 >
 <div className="w-12 h-12 rounded border border-border bg-soft overflow-hidden flex items-center justify-center">
 {it.imagen ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={it.imagen} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
 ) : <span className="text-[9px] text-text-muted">sin img</span>}
 </div>
 <div className="min-w-0">
 <div className="text-xs font-semibold text-primary truncate">{it.name}</div>
 {it.sku && <div className="text-[10px] text-text-muted font-mono">SKU {it.sku}</div>}
 </div>
 <div className="text-xs text-text text-right tabular-nums">{it.quantity}x</div>
 <div className="text-xs text-text-muted text-right tabular-nums">{formatCurrency(it.price)}</div>
 <div className="text-xs font-semibold text-text text-right tabular-nums">{formatCurrency(it.subtotal)}</div>
 </a>
 ))}
 </div>
 </>
 ) : (
 <div className="text-text-muted text-sm py-4">Sin items disponibles.</div>
 )}
 </div>
 </td>
 </tr>
 )}
 </>
 );
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
 const { id } = use(params);
 const router = useRouter();
 const [orderDetailId, setOrderDetailId] = useState<number | null>(null);

 const { data, isLoading, error } = useQuery<Detail>({
 queryKey: ["customer-detail", id],
 queryFn: () => api(`/api/dashboards/customers/${id}`),
 staleTime: 60_000,
 });

 const wa = data?.customer_info?.phone ? waLink(data.customer_info.phone) : null;

 return (
 <>
 <Topbar
 title={data?.customer_info?.name ?? `Cliente #${id}`}
 subtitle="Vista 360 · Cliente final Unistore (Tienda Nube) · NO es dropshipper Unidrop"
 />
 <div className="flex-1 px-8 py-6 overflow-y-auto">
 <div className="mb-4">
 <button
 onClick={() => router.back()}
 className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text transition"
 >
 <ArrowLeft size={14} /> Volver
 </button>
 </div>

 {error && (
 <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
 Error: {(error as Error).message}
 </div>
 )}

 {/* Card VIP destacada cuando aplica */}
 <VipStatusCard customerId={Number(id)} />

 {data?.customer_info && (
 <div className="bg-surface border border-border rounded-xl p-5 mb-6">
 <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm items-center">
 {data.customer_info.email && (
 <a href={`mailto:${data.customer_info.email}`} className="inline-flex items-center gap-2 text-primary hover:underline">
 <Mail size={14} /> {data.customer_info.email}
 </a>
 )}
 {wa ? (
 <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-emerald-600 hover:underline">
 <Smartphone size={14} /> {data.customer_info.phone}
 <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">WA</span>
 </a>
 ) : data.customer_info.phone ? (
 <span className="inline-flex items-center gap-2 text-text-muted">
 <Smartphone size={14} /> {data.customer_info.phone}
 </span>
 ) : null}
 {(data.customer_info.province || data.customer_info.city) && (
 <div className="inline-flex items-center gap-2 text-text-muted">
 <MapPin size={14} />
 <span className="text-text">
 {[data.customer_info.city, data.customer_info.province].filter(Boolean).join(", ")}
 </span>
 </div>
 )}
 {data.customer_info.first_interaction && (
 <div className="text-text-muted">
 Cliente desde <span className="text-text">{data.customer_info.first_interaction.slice(0, 10)}</span>
 </div>
 )}
 <div className="text-text-muted">
 Marketing: <span className="text-text">{data.customer_info.accepts_marketing ? "si" : "no"}</span>
 </div>
 </div>
 </div>
 )}

 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
 {isLoading || !data
 ? Array.from({ length: 6 }).map((_, i) => (
 <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
 ))
 : data.cards.map((c) => {
 // limpiar referencias al 
 const cleanCard: KpiCardT = { ...c, hint: (c.hint ?? "").replace(/\s*/gi, "").replace(/Segun lifecycle.*/i, "Segun ciclo de vida") };
 return <KpiCard key={c.label} data={cleanCard} />;
 })}
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-6">
 <div>
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 ) : (
 <InteractiveMetricChart
 points={data.monthly_trend as any[]}
 metrics={[
   { key: "revenue", label: "Revenue", kind: "currency", color: "#7a3eae" },
   { key: "ordenes_pagas", label: "Órdenes pagas", kind: "number", color: "#10b981" },
   { key: "units", label: "Unidades", kind: "number", color: "#0ea5e9" },
   { key: "skus_distintos", label: "SKUs distintos", kind: "number", color: "#f59e0b" },
   { key: "ticket_promedio", label: "Ticket promedio", kind: "currency", color: "#ec4899" },
   { key: "ordenes_canceladas", label: "Cancelaciones", kind: "number", color: "#ef4444" },
 ] satisfies MetricDef[]}
 defaultPrimary="revenue"
 defaultSecondary="ordenes_pagas"
 caption="Evolución mensual"
 subtitle="Elegí qué métrica ver como barras (eje izq) y opcionalmente otra como línea (eje der)"
 height={260}
 />
 )}
 </div>
 <CustomerJourneyPanel customerId={Number(id)} />
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
 {isLoading || !data ? (
 <>
 <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
 <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
 </>
 ) : (
 <>
 {/* Ordenes con expandible + filtros */}
 <CustomerOrdersTable orders={data.orders} onOpenDetail={setOrderDetailId} />

 {/* Top productos comprados con thumbs */}
 <div className="bg-surface border border-border rounded-xl p-5">
 <div className="text-sm font-bold text-text mb-1">Top productos comprados</div>
 <div className="text-xs text-text-muted mb-3">Click para ver el SKU 360</div>
 <div className="space-y-1">
 {data.top_products.map((p, i) => {
 const e = p.extra ?? {};
 const sku = String(e.sku ?? "");
 const img = String(e.imagen ?? "");
 return (
 <a
 key={i}
 href={sku ? `/dashboard/productos/${encodeURIComponent(sku)}` : "#"}
 target={sku ? "_blank" : undefined}
 rel="noopener noreferrer"
 className="grid grid-cols-[40px_40px_1fr_60px_70px_110px] gap-3 items-center px-2 py-2 rounded-lg hover:bg-soft transition"
 >
 <div className="text-text-muted text-xs font-mono text-right">{i + 1}</div>
 <div className="w-9 h-9 rounded border border-border bg-soft overflow-hidden flex items-center justify-center">
 {img ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={img} alt={p.category} className="w-full h-full object-cover" loading="lazy" />
 ) : <span className="text-[8px] text-text-muted">—</span>}
 </div>
 <div className="min-w-0">
 <div className="text-xs font-semibold text-text truncate">{p.category}</div>
 {sku && <div className="text-[10px] text-text-muted font-mono">{sku}</div>}
 </div>
 <div className="text-xs text-text-muted text-right tabular-nums">
 {formatNumber(Number(e.units ?? 0))} u.
 </div>
 <div className="text-xs text-text-muted text-right tabular-nums">
 {formatNumber(Number(e.orders ?? 0))} ord
 </div>
 <div className="text-xs font-bold text-text text-right tabular-nums">{formatCurrency(p.value)}</div>
 </a>
 );
 })}
 </div>
 </div>
 </>
 )}
 </div>
 </div>

 <OrderDetailModal orderId={orderDetailId} onClose={() => setOrderDetailId(null)} />
 </>
 );
}

// VIP status card mostrada arriba del perfil cuando el cliente cumple alguna regla VIP
type VipStatus = {
 is_vip: boolean;
 tier: "gold" | "silver" | "bronze" | null;
 reasons: string[];
 lifetime: number;
 max_order: number;
 paid_orders: number;
 avg_ticket: number;
};

function VipStatusCard({ customerId }: { customerId: number }) {
 const { data } = useQuery<VipStatus>({
  queryKey: ["customer-vip", customerId],
  queryFn: () => api(`/api/dashboards/customers/${customerId}/vip-status`),
  staleTime: 5 * 60_000,
 });
 if (!data || !data.is_vip || !data.tier) return null;
 const tierMeta = {
  gold: { icon: "👑", label: "VIP Gold", bg: "from-yellow-100 via-amber-100 to-yellow-50", border: "border-amber-400", color: "text-amber-900" },
  silver: { icon: "💎", label: "VIP Silver", bg: "from-slate-100 via-zinc-100 to-slate-50", border: "border-slate-400", color: "text-slate-800" },
  bronze: { icon: "⭐", label: "VIP Bronze", bg: "from-orange-100 via-amber-100 to-orange-50", border: "border-amber-400", color: "text-amber-900" },
 }[data.tier];
 return (
  <div className={`bg-gradient-to-r ${tierMeta.bg} border-2 ${tierMeta.border} rounded-2xl p-5 mb-6 shadow-md`}>
   <div className="flex items-center gap-4 flex-wrap">
    <div className="text-5xl flex-shrink-0">{tierMeta.icon}</div>
    <div className="flex-1 min-w-0">
     <div className={`text-xs font-bold uppercase tracking-wider ${tierMeta.color}`}>Cliente {tierMeta.label}</div>
     <div className="text-2xl font-extrabold text-text mt-0.5">
      Ticket promedio ${data.avg_ticket.toLocaleString("es-AR")}
     </div>
     <div className="text-xs text-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      <span><strong>{data.paid_orders}</strong> {data.paid_orders === 1 ? "compra" : "compras"} pagadas</span>
      <span>Orden máx: <strong>${data.max_order.toLocaleString("es-AR")}</strong></span>
      <span>Lifetime: <strong>${data.lifetime.toLocaleString("es-AR")}</strong></span>
     </div>
     {data.reasons.length > 0 && (
      <div className="text-[11px] text-text-muted mt-2">
       <span className="font-bold">Razón VIP:</span> {data.reasons.join(" · ")}
      </div>
     )}
    </div>
   </div>
  </div>
 );
}

// ============================================================
// CustomerJourneyPanel — storytelling al costado del chart mensual.
// Muestra:
//   - Timeline de eventos (1ra compra, 2da, gap entre cada una)
//   - Cadencia personal con promedio ponderado (0.6 ult + 0.3 ant + 0.1 pre-ant)
//   - Estado: en ritmo / atrasado / muy atrasado vs SU patron (no vs promedio)
// ============================================================
type JourneyEvent = {
  order_id: number;
  number: string;
  label: string;
  date: string;
  total: number;
  units: number;
  gap_days: number | null;
  cumulative_revenue: number;
  cumulative_units: number;
  stage?: string;
  gap_expected?: number | null;
  gap_ratio?: number;
  gap_health?: "en_ritmo" | "en_riesgo" | "churn_pendiente" | "churn_confirmado" | null;
  gap_health_label?: string | null;
  transition_narrative?: string | null;
  churn_break?: boolean;
  churn_ratio?: number;
};
type WeightedItem = { weight: number; gap_days: number; label: string };
type CustomerJourney = {
  customer_id: number;
  events: JourneyEvent[];
  gaps: number[];
  avg_gap_days_simple: number | null;
  expected_gap_days: number | null;
  expected_next_date: string | null;
  weighted_breakdown: WeightedItem[];
  days_since_last: number | null;
  total_paid_orders: number;
  total_revenue: number;
  total_units: number;
  ticket_avg: number;
  status:
    | "sin_compras" | "primera_compra"
    | "nuevo" | "segunda_compra" | "conv_recurrente" | "recurrente"
    | "en_riesgo" | "churn_pendiente" | "churn_confirmado" | "recuperado"
    // Legacy compat (responses pre-deploy)
    | "en_ritmo" | "atrasado" | "muy_atrasado";
  status_label: string;
  cs_action?: string;
  narrative: string;
};

function CustomerJourneyPanel({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery<CustomerJourney>({
    queryKey: ["customer-journey", customerId],
    queryFn: () => api(`/api/dashboards/customers/${customerId}/journey`),
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data) {
    return <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />;
  }

  const statusColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    sin_compras:       { bg: "bg-zinc-50",    border: "border-zinc-300",    text: "text-zinc-700",    dot: "bg-zinc-400"   },
    primera_compra:    { bg: "bg-blue-50",    border: "border-blue-300",    text: "text-blue-800",    dot: "bg-blue-500"   },
    nuevo:             { bg: "bg-blue-50",    border: "border-blue-300",    text: "text-blue-800",    dot: "bg-blue-500"   },
    segunda_compra:    { bg: "bg-cyan-50",    border: "border-cyan-300",    text: "text-cyan-900",    dot: "bg-cyan-500"   },
    conv_recurrente:   { bg: "bg-violet-50",  border: "border-violet-300",  text: "text-violet-900",  dot: "bg-violet-500" },
    recurrente:        { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800", dot: "bg-emerald-500" },
    en_riesgo:         { bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-900",   dot: "bg-amber-500"  },
    churn_pendiente:   { bg: "bg-orange-50",  border: "border-orange-400",  text: "text-orange-900",  dot: "bg-orange-600" },
    churn_confirmado:  { bg: "bg-red-50",     border: "border-red-300",     text: "text-red-900",     dot: "bg-red-600"    },
    recuperado:        { bg: "bg-teal-50",    border: "border-teal-300",    text: "text-teal-900",    dot: "bg-teal-500"   },
    // legacy
    en_ritmo:          { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800", dot: "bg-emerald-500" },
    atrasado:          { bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-900",   dot: "bg-amber-500"  },
    muy_atrasado:      { bg: "bg-red-50",     border: "border-red-300",     text: "text-red-900",     dot: "bg-red-600"    },
  };
  const sc = statusColors[data.status] || statusColors.sin_compras;

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex flex-col h-full max-h-[640px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-bold text-text">Su historia con nosotros</div>
          <div className="text-[10px] text-text-muted">Cadencia personal, no promedio</div>
        </div>
        <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${sc.bg} ${sc.border} ${sc.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
          {data.status_label}
        </div>
      </div>

      {/* Bloque cadencia */}
      {data.expected_gap_days != null && (
        <div className={`${sc.bg} ${sc.border} border rounded-lg p-3 mb-3 text-xs leading-relaxed`}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-text-muted text-[10px] uppercase font-bold tracking-wider">Cadencia personal</span>
            <span className={`font-extrabold ${sc.text}`}>~{data.expected_gap_days} d</span>
          </div>
          {data.weighted_breakdown.length > 0 && (
            <div className="text-[10px] text-text-muted">
              {data.weighted_breakdown.map((w, i) => (
                <span key={i}>
                  {i > 0 && " + "}
                  <span className="font-mono">{w.weight}×{w.gap_days}d</span>
                </span>
              ))}
              {data.avg_gap_days_simple != null && (
                <span className="ml-2 text-text-muted">(prom. simple {data.avg_gap_days_simple}d)</span>
              )}
            </div>
          )}
          <div className="mt-1.5 text-[11px] text-text">
            Hace <strong>{data.days_since_last}d</strong> de su última.
            {data.expected_next_date && (
              <> Próxima estimada <strong>{data.expected_next_date}</strong>.</>
            )}
          </div>
        </div>
      )}

      {/* Narrativa */}
      <div className="text-[11px] text-text leading-relaxed mb-2 italic">
        {data.narrative}
      </div>

      {/* Accion CS sugerida */}
      {data.cs_action && (
        <div className={`${sc.bg} ${sc.border} border rounded-lg p-2 mb-3`}>
          <div className="text-[9px] uppercase tracking-wider font-bold text-text-muted">Acción CS sugerida</div>
          <div className={`text-[11px] font-semibold ${sc.text}`}>{data.cs_action}</div>
        </div>
      )}

      {/* Timeline vertical — most-recent-first */}
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2 flex items-center gap-1.5">
        <span>Timeline</span>
        <span className="text-text-muted/60 normal-case font-normal">(más reciente → primera)</span>
        <span className="ml-auto font-normal normal-case">
          {data.total_paid_orders} compras · ${data.total_revenue.toLocaleString("es-AR")}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        {data.events.map((e, idx) => {
          const isLast = idx === data.events.length - 1;
          return (
            <JourneyEventCard key={e.order_id} event={e} isLast={isLast} />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// JourneyEventCard — card por evento + barra vertical de gap coloreada
// ============================================================
const STAGE_COLOR_MAP: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  "Nuevo":               { bg: "bg-blue-50",    border: "border-blue-300",    text: "text-blue-900",    dot: "bg-blue-500"   },
  "Segunda compra":      { bg: "bg-cyan-50",    border: "border-cyan-300",    text: "text-cyan-900",    dot: "bg-cyan-500"   },
  "Conv. a Recurrente":  { bg: "bg-violet-50",  border: "border-violet-300",  text: "text-violet-900",  dot: "bg-violet-500" },
  "Recurrente":          { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", dot: "bg-emerald-500" },
};

const GAP_HEALTH_MAP: Record<string, { color: string; bar: string; label: string }> = {
  en_ritmo:         { color: "text-emerald-700", bar: "bg-emerald-400", label: "En ritmo"           },
  en_riesgo:        { color: "text-amber-800",   bar: "bg-amber-400",   label: "En riesgo"          },
  churn_pendiente:  { color: "text-orange-800",  bar: "bg-orange-500",  label: "Churn pendiente"    },
  churn_confirmado: { color: "text-red-800",     bar: "bg-red-600",     label: "Churn confirmado"   },
};

function JourneyEventCard({ event: e, isLast }: { event: JourneyEvent; isLast: boolean }) {
  const stageMeta = STAGE_COLOR_MAP[e.stage || ""] || STAGE_COLOR_MAP["Nuevo"];
  const gh = e.gap_health ? GAP_HEALTH_MAP[e.gap_health] : null;
  // Barra de gap proporcional pero capada a 80px
  const barHeight = e.gap_days != null
    ? Math.min(80, 12 + Math.max(0, e.gap_days) * 0.6)
    : 0;

  return (
    <div className="relative">
      {/* Card del evento */}
      <div className={`rounded-lg border ${stageMeta.border} ${stageMeta.bg} p-2 mb-0`}>
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${stageMeta.dot}`} />
            <span className="text-xs font-bold text-text">{e.label}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${stageMeta.text} ${stageMeta.bg} border ${stageMeta.border}`}>
              {e.stage || "—"}
            </span>
          </div>
          <span className="text-[10px] text-text-muted font-mono">#{e.number}</span>
        </div>
        <div className="text-[10px] text-text-muted ml-3.5">
          {e.date} · <strong className="text-text">$ {e.total.toLocaleString("es-AR")}</strong> · {e.units}u
        </div>
        {e.transition_narrative && idx0FirstPurchase(e) && (
          <div className={`text-[10px] mt-1 ml-3.5 italic ${gh?.color ?? "text-text-muted"}`}>
            {e.transition_narrative}
          </div>
        )}
      </div>

      {/* Barra vertical del gap hacia el siguiente evento (en orden DESC, el "anterior" en la lista) */}
      {!isLast && e.gap_days != null && (
        <div className="flex items-stretch gap-2 ml-2 my-0.5">
          <div
            className={`w-1 rounded-full ${gh?.bar ?? "bg-zinc-300"}`}
            style={{ height: barHeight }}
          />
          <div className="flex-1 flex items-center text-[10px]">
            <div className="flex flex-col gap-0.5">
              <span className={`font-bold ${gh?.color ?? "text-text-muted"}`}>
                {gh?.label ?? "—"} · {e.gap_days}d
              </span>
              {e.gap_expected != null && (
                <span className="text-text-muted">
                  esperado ~{e.gap_expected}d · {e.gap_ratio ? `${e.gap_ratio.toFixed(1)}× cadencia` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// helper — primera compra no muestra narrativa de transicion (no hay gap previo)
function idx0FirstPurchase(_e: JourneyEvent): boolean {
  return true; // always render narrative if backend devolvio una (la 1ra compra trae texto de welcome)
}

// ============================================================
// CustomerOrdersTable — tabla de ordenes con filtros por pago + estado pedido
// ============================================================
function CustomerOrdersTable({
  orders, onOpenDetail,
}: {
  orders: CategoryValue[];
  onOpenDetail: (id: number) => void;
}) {
  const [payFilter, setPayFilter] = useState<"all" | "paid" | "pending" | "voided" | "refunded">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed" | "cancelled">("all");

  // Conteos
  const counts = orders.reduce(
    (acc, o) => {
      const pay = String(o.extra?.payment ?? "").toLowerCase();
      const st = String(o.extra?.status ?? "").toLowerCase();
      acc.byPay[pay] = (acc.byPay[pay] ?? 0) + 1;
      acc.byStatus[st] = (acc.byStatus[st] ?? 0) + 1;
      return acc;
    },
    { byPay: {} as Record<string, number>, byStatus: {} as Record<string, number> },
  );

  const filtered = orders.filter((o) => {
    const pay = String(o.extra?.payment ?? "").toLowerCase();
    const st = String(o.extra?.status ?? "").toLowerCase();
    if (payFilter !== "all" && pay !== payFilter) return false;
    if (statusFilter !== "all" && st !== statusFilter) return false;
    return true;
  });
  // Aplanar para sort: extraer fields del extra a top-level
  const flat = filtered.map((o) => ({
    ...o,
    _numero: String(o.category ?? ""),
    _fecha: String(o.extra?.fecha ?? ""),
    _total: Number(o.value ?? 0),
    _payment: String(o.extra?.payment ?? ""),
    _status: String(o.extra?.status ?? ""),
  }));
  const sortRows = useTableSort<typeof flat[number]>(flat, "_fecha", "desc");

  const pillBase = "px-2 py-0.5 text-[10px] font-bold rounded-md transition";
  const pillActive = "bg-surface shadow text-text";
  const pillIdle = "text-text-muted hover:text-text";

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div>
          <div className="text-sm font-bold text-text">Ordenes (ultimas 50)</div>
          <div className="text-xs text-text-muted">
            Click una fila para ver items · click en ↗ abre el detalle TN-style · mostrando {filtered.length} / {orders.length}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Pago:</span>
        <div className="inline-flex bg-soft rounded-md p-0.5 border border-border">
          <button className={`${pillBase} ${payFilter === "all" ? pillActive : pillIdle}`} onClick={() => setPayFilter("all")}>
            Todos ({orders.length})
          </button>
          <button className={`${pillBase} ${payFilter === "paid" ? pillActive : pillIdle}`} onClick={() => setPayFilter("paid")}>
            Pagadas ({counts.byPay["paid"] ?? 0})
          </button>
          <button className={`${pillBase} ${payFilter === "pending" ? pillActive : pillIdle}`} onClick={() => setPayFilter("pending")}>
            Pendientes ({counts.byPay["pending"] ?? 0})
          </button>
          {(counts.byPay["voided"] ?? 0) > 0 && (
            <button className={`${pillBase} ${payFilter === "voided" ? pillActive : pillIdle}`} onClick={() => setPayFilter("voided")}>
              Voided ({counts.byPay["voided"]})
            </button>
          )}
          {(counts.byPay["refunded"] ?? 0) > 0 && (
            <button className={`${pillBase} ${payFilter === "refunded" ? pillActive : pillIdle}`} onClick={() => setPayFilter("refunded")}>
              Refunded ({counts.byPay["refunded"]})
            </button>
          )}
        </div>

        <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold ml-2">Estado:</span>
        <div className="inline-flex bg-soft rounded-md p-0.5 border border-border">
          <button className={`${pillBase} ${statusFilter === "all" ? pillActive : pillIdle}`} onClick={() => setStatusFilter("all")}>
            Todos
          </button>
          <button className={`${pillBase} ${statusFilter === "open" ? pillActive : pillIdle}`} onClick={() => setStatusFilter("open")}>
            Abierta ({counts.byStatus["open"] ?? 0})
          </button>
          <button className={`${pillBase} ${statusFilter === "closed" ? pillActive : pillIdle}`} onClick={() => setStatusFilter("closed")}>
            Cerrada ({counts.byStatus["closed"] ?? 0})
          </button>
          {(counts.byStatus["cancelled"] ?? 0) > 0 && (
            <button className={`${pillBase} ${statusFilter === "cancelled" ? pillActive : pillIdle}`} onClick={() => setStatusFilter("cancelled")}>
              Cancelada ({counts.byStatus["cancelled"]})
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2"><SortHeader col="_numero" label="Numero" sortBy={sortRows.sortBy} sortDir={sortRows.sortDir} onToggle={sortRows.toggle} /></th>
              <th className="px-3 py-2"><SortHeader col="_fecha" label="Fecha" sortBy={sortRows.sortBy} sortDir={sortRows.sortDir} onToggle={sortRows.toggle} /></th>
              <th className="px-3 py-2"><SortHeader col="_status" label="Estado del pedido" sortBy={sortRows.sortBy} sortDir={sortRows.sortDir} onToggle={sortRows.toggle} /></th>
              <th className="px-3 py-2 text-right"><SortHeader col="_total" label="Total" sortBy={sortRows.sortBy} sortDir={sortRows.sortDir} onToggle={sortRows.toggle} /></th>
              <th className="px-3 py-2 text-center"></th>
            </tr>
          </thead>
          <tbody>
            {sortRows.rows.map((o, i) => (
              <ExpandableOrderRow
                key={`${o.extra?.id ?? i}`}
                order={o}
                idx={i + 1}
                onOpenDetail={onOpenDetail}
              />
            ))}
            {sortRows.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-text-muted text-sm">
                  {orders.length === 0 ? "Sin ordenes." : "No hay ordenes con esos filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
