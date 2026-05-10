"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { DailyRevenueChart } from "@/components/sparkline";
import { OrderDetailModal } from "@/components/order-detail-modal";
import { api } from "@/lib/api";
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

 <div className="mb-6">
 {isLoading || !data ? (
 <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
 ) : (
 <DailyRevenueChart
 points={data.monthly_trend}
 caption="Revenue mensual del customer"
 subtitle="Ordenes pagas · click en una orden abajo para expandir items"
 height={320}
 />
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
 {/* Ordenes con expandible */}
 <div className="bg-surface border border-border rounded-xl p-5">
 <div className="text-sm font-bold text-text mb-1">Ordenes (ultimas 50)</div>
 <div className="text-xs text-text-muted mb-3">Click en una fila para ver los items · click en ↗ abre el detalle TN-style</div>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
 <th className="px-3 py-2">#</th>
 <th className="px-3 py-2">Numero</th>
 <th className="px-3 py-2">Fecha</th>
 <th className="px-3 py-2">Estado del pedido</th>
 <th className="px-3 py-2 text-right">Total</th>
 <th className="px-3 py-2 text-center"></th>
 </tr>
 </thead>
 <tbody>
 {data.orders.map((o, i) => (
 <ExpandableOrderRow
 key={i}
 order={o}
 idx={i + 1}
 onOpenDetail={setOrderDetailId}
 />
 ))}
 {data.orders.length === 0 && (
 <tr><td colSpan={8} className="py-8 text-center text-text-muted text-sm">Sin ordenes.</td></tr>
 )}
 </tbody>
 </table>
 </div>
 </div>

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
      Lifetime ${data.lifetime.toLocaleString("es-AR")}
     </div>
     <div className="text-xs text-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      <span><strong>{data.paid_orders}</strong> órdenes pagadas</span>
      <span>Ticket prom: <strong>${data.avg_ticket.toLocaleString("es-AR")}</strong></span>
      <span>Orden máx: <strong>${data.max_order.toLocaleString("es-AR")}</strong></span>
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
