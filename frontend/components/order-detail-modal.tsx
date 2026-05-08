"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink, Mail, Phone, Calendar, Smartphone, Copy, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { fmtArShort } from "@/lib/dates";

type Item = {
  id: number;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  subtotal: number;
  product_id: number | null;
  variantes: string | null;
  imagen: string | null;
};

type Address = {
  name: string;
  phone: string;
  address: string;
  number: string;
  floor: string;
  locality: string;
  zipcode: string;
  city: string;
  province: string;
  country: string;
} | null;

type Customer = {
  id: number;
  name: string;
  email: string;
  phone: string;
  identification: string;
  billing_address: string;
  billing_number: string;
  billing_city: string;
  billing_province: string;
  billing_zipcode: string;
  total_spent: number;
  customer_type: string;
};

type Detail = {
  id: number;
  number: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  created_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  note: string;
  subtotal: number;
  total_shipping: number;
  total_discount: number;
  discount_coupon: number;
  total: number;
  contact_email: string;
  contact_phone: string;
  contact_name: string;
  contact_identification: string;
  gateway: string;
  gateway_name: string;
  payment_due_date: string | null;
  weight: number;
  customer_id: number | null;
  store_id: number | null;
  items: Item[];
  shipping_address: Address;
  customer?: Customer;
  history: { icon: string; label: string; ts: string }[];
  tn_admin_url: string;
  error?: string;
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-zinc-100 text-zinc-700 border-zinc-300",
  refunded: "bg-amber-50 text-amber-800 border-amber-200",
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  voided: "bg-zinc-100 text-zinc-700 border-zinc-300",
  abandoned: "bg-zinc-100 text-zinc-500 border-zinc-200",
  shipped: "bg-blue-50 text-blue-700 border-blue-200",
  unpacked: "bg-amber-50 text-amber-800 border-amber-200",
  unshipped: "bg-amber-50 text-amber-800 border-amber-200",
  fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return fmtArShort(s);
}

function waLink(phone: string): string | null {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("549")) return `https://wa.me/${d}`;
  if (d.startsWith("54")) return `https://wa.me/549${d.slice(2)}`;
  if (d.startsWith("0")) return `https://wa.me/549${d.slice(1)}`;
  if (d.length === 10) return `https://wa.me/549${d}`;
  return `https://wa.me/${d}`;
}

export function OrderDetailModal({
  orderId,
  onClose,
}: {
  orderId: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (orderId) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [onClose, orderId]);

  const { data, isLoading, error } = useQuery<Detail>({
    queryKey: ["order-detail", orderId],
    queryFn: () => api(`/api/drilldowns/orders/${orderId}/detail`),
    enabled: !!orderId,
    staleTime: 60_000,
  });

  if (!orderId) return null;

  const isCancelled = data?.status === "cancelled";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 animate-in fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {isLoading && (
          <div className="p-12 text-center text-text-muted text-sm">Cargando detalle de pedido...</div>
        )}
        {error && (
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm">
              Error: {(error as Error).message}
            </div>
          </div>
        )}
        {data && data.error && (
          <div className="p-12 text-center text-text-muted text-sm">{data.error}</div>
        )}
        {data && !data.error && (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4 flex-wrap bg-surface">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-extrabold text-text">#{data.number || data.id}</h2>
                  {isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-300">
                      ⊘ Venta cancelada
                    </span>
                  )}
                  {!isCancelled && (
                    <span className={"inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border " + (STATUS_BADGE[data.status] ?? "bg-soft text-text-muted border-border")}>
                      {data.status}
                    </span>
                  )}
                </div>
                {data.created_at && (
                  <div className="flex items-center gap-1 text-xs text-text-muted mt-1">
                    <Calendar size={11} /> {fmtDate(data.created_at)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={data.tn_admin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:border-primary hover:text-primary text-xs font-semibold transition"
                >
                  <ExternalLink size={12} /> Abrir en Tienda Nube
                </a>
                <button
                  onClick={() => navigator.clipboard?.writeText(data.tn_admin_url)}
                  title="Copiar link TN"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary transition"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={onClose}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:bg-soft transition"
                  aria-label="Cerrar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body 2 col */}
            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-6">
                {/* IZQUIERDA: Detalle de la venta */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-bold text-text">Detalle de la venta</div>
                      <div className="text-xs text-text-muted">{data.items.length} {data.items.length === 1 ? "item" : "items"}</div>
                    </div>
                    <div className="space-y-3">
                      {data.items.map((it) => (
                        <a
                          key={it.id}
                          href={it.sku ? `/dashboard/productos/${encodeURIComponent(it.sku)}` : "#"}
                          target={it.sku ? "_blank" : undefined}
                          rel="noopener noreferrer"
                          className="flex items-start gap-3 p-3 -mx-3 rounded-lg hover:bg-soft transition"
                        >
                          <div className="shrink-0 w-16 h-16 rounded-lg bg-soft border border-border overflow-hidden flex items-center justify-center">
                            {it.imagen ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.imagen} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="text-text-muted text-[10px]">sin img</div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-primary truncate">{it.name}</div>
                            {it.sku && <div className="text-[11px] text-text-muted font-mono">SKU {it.sku}</div>}
                            <div className="text-xs text-text-muted mt-0.5">{it.quantity}x {formatCurrency(it.price)}</div>
                          </div>
                          <div className="text-sm font-bold text-text tabular-nums">{formatCurrency(it.subtotal)}</div>
                        </a>
                      ))}
                    </div>
                    {data.shipping_address && (
                      <div className="mt-4 pt-4 border-t border-border text-sm">
                        <div className="font-semibold text-text mb-1">📍 Entrega</div>
                        <div className="text-text-muted text-xs space-y-0.5">
                          {data.shipping_address.name && <div>A nombre de: <span className="text-text">{data.shipping_address.name}</span></div>}
                          <div>{data.shipping_address.address} {data.shipping_address.number} {data.shipping_address.floor}</div>
                          <div>{data.shipping_address.locality} {data.shipping_address.city ? `· ${data.shipping_address.city}` : ""}</div>
                          <div>{data.shipping_address.province} {data.shipping_address.zipcode ? `· CP ${data.shipping_address.zipcode}` : ""}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pago */}
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-bold text-text">Pago</div>
                      <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border " + (STATUS_BADGE[data.payment_status] ?? "bg-soft text-text-muted border-border")}>
                        {data.payment_status || "—"}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-muted">Subtotal ({data.items.reduce((s,i)=>s+i.quantity,0)} unidades)</span>
                        <span className="tabular-nums">{formatCurrency(data.subtotal)}</span>
                      </div>
                      {data.total_shipping > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Envio</span>
                          <span className="tabular-nums">{formatCurrency(data.total_shipping)}</span>
                        </div>
                      )}
                      {data.total_discount > 0 && (
                        <div className="flex justify-between text-error">
                          <span>Descuentos</span>
                          <span className="tabular-nums">−{formatCurrency(data.total_discount)}</span>
                        </div>
                      )}
                      {data.discount_coupon > 0 && (
                        <div className="flex justify-between text-error">
                          <span>Cupon</span>
                          <span className="tabular-nums">−{formatCurrency(data.discount_coupon)}</span>
                        </div>
                      )}
                      <div className="border-t border-border my-2" />
                      <div className="flex justify-between font-bold text-base">
                        <span>Total</span>
                        <span className="tabular-nums">{formatCurrency(data.total)}</span>
                      </div>
                      {data.gateway_name && (
                        <div className="text-xs text-text-muted pt-2">
                          Medio de pago: <span className="text-text">{data.gateway_name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* DERECHA: Mas informacion */}
                <div className="space-y-4">
                  {/* Cliente */}
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="text-sm font-bold text-text mb-3">Datos del cliente</div>
                    <div className="space-y-2 text-sm">
                      {(data.contact_name || data.customer?.name) && (
                        <div className="font-semibold text-primary">
                          {data.customer ? (
                            <a href={`/dashboard/customer/${data.customer.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {data.customer.name || data.contact_name}
                            </a>
                          ) : data.contact_name}
                        </div>
                      )}
                      {data.contact_email && (
                        <a href={`mailto:${data.contact_email}`} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                          <Mail size={11} /> {data.contact_email}
                        </a>
                      )}
                      {data.contact_phone && (() => {
                        const wa = waLink(data.contact_phone);
                        return wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-emerald-600 hover:underline">
                            <Smartphone size={11} /> {data.contact_phone}
                          </a>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-text-muted">
                            <Phone size={11} /> {data.contact_phone}
                          </div>
                        );
                      })()}
                      {data.contact_identification && (
                        <div className="text-xs text-text-muted">
                          <div className="text-[10px] uppercase tracking-wider font-semibold">DNI/CUIT</div>
                          <div className="font-mono text-text">{data.contact_identification}</div>
                        </div>
                      )}
                      {data.customer && data.customer.total_spent > 0 && (
                        <div className="pt-2 mt-2 border-t border-border text-xs text-text-muted">
                          Gastado lifetime: <span className="font-bold text-text">{formatCurrency(data.customer.total_spent)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Direccion facturacion */}
                  {data.customer && (data.customer.billing_address || data.customer.billing_city) && (
                    <div className="bg-surface border border-border rounded-xl p-5">
                      <div className="text-sm font-bold text-text mb-3">Direccion de facturacion</div>
                      <div className="text-xs text-text-muted space-y-0.5">
                        <div>{data.customer.billing_address} {data.customer.billing_number}</div>
                        <div>{data.customer.billing_city} · CP {data.customer.billing_zipcode}</div>
                        <div>{data.customer.billing_province}</div>
                      </div>
                    </div>
                  )}

                  {/* Historial */}
                  {data.history.length > 0 && (
                    <div className="bg-surface border border-border rounded-xl p-5">
                      <div className="text-sm font-bold text-text mb-3">Historial</div>
                      <div className="space-y-2.5">
                        {data.history.map((h, i) => (
                          <div key={i} className="flex items-start gap-2.5 text-xs">
                            <div className="text-base shrink-0 leading-tight">{h.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-text">{h.label}</div>
                              <div className="text-[10px] text-text-muted">{fmtDate(h.ts)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.note && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                      <div className="text-xs uppercase tracking-wider font-bold text-amber-800 mb-1">Nota del cliente</div>
                      <div className="text-xs text-amber-900">{data.note}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-border bg-soft text-[11px] text-text-muted flex items-center justify-between">
              <span>ID: {data.id}{data.store_id ? ` · Store ${data.store_id}` : ""}</span>
              <span>Click ESC o fuera del modal para cerrar</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
