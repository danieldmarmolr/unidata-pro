"use client";

import Link from "next/link";
import {
  FileText, Download, ExternalLink, X, Package, DollarSign, Truck,
  Mail, Phone, IdCard, RotateCcw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";

export type OrderItem = {
  sku: string;
  name: string;
  qty: number;
  price: number;
  item_type?: string;
  cost?: number;
  image_url?: string;
};

export type Shipment = {
  carrier: string;
  status: string;
  entregado: string | null;
  costo: number;
  tracking_number?: string;
  tracking_url?: string;
  tracking_qr?: string;
  receiver_name?: string;
  receiver_phone?: string;
  address?: string;
  city?: string;
  province?: string;
  zipcode?: string;
  last_update?: string;
} | null;

export type UnifiedOrder = {
  origen: "ml" | "tn";
  internal_id: number | null;
  external_id: string;
  number: string;
  fecha: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  total: number;
  merch_cost: number;
  shipping_cost: number;
  profit_unidrop: number;
  buyer_name: string;
  billing_city?: string;
  billing_province?: string;
  billing_address?: string;
  billing_zipcode?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_dni?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_zipcode?: string;
  shipping_type: string;
  intent_id: number | null;
  enriched?: boolean;
  items?: OrderItem[];
  shipment?: Shipment;
  returns_count?: number;
  is_combo?: boolean;
  status_detail?: string;
  fecha_closed?: string;
  total_cost?: number;
  shipping_price?: number;
  shipping_carrier?: string;
  label_downloaded?: boolean;
  label_downloaded_at?: string;
  cancel_by_unidrop?: boolean;
  notification_pack?: boolean;
  notification_ship?: boolean;
  tags?: string[];
  buyer_id?: string;
  shipping_id?: string;
  contabilium_client_id?: string;
  shipping_comment?: string;
  shipping_receiver?: string;
  shipping_phone?: string;
  shipping_floor?: string;
  shipping_locality?: string;
  shipping_number?: string;
  tn_number?: string;
  subtotal?: number;
  discount?: number;
  shipping_option?: string;
  gateway?: string;
  gateway_name?: string;
  gateway_link?: string;
  paid_at?: string;
  intent_fecha?: string | null;
  completed_at?: string;
  cancelled_at?: string;
  closed_at?: string;
  manual_packed_at?: string;
  manual_payment_at?: string;
  note?: string;
  owner_note?: string;
  invoice?: {
    id: number | null;
    tipo: string;
    numero: string;
    link: string;
    fecha: string | null;
    total: number;
    cae: string;
    punto_venta: string;
  };
  returns?: {
    status: string;
    reason: string;
    amount_to_refund: number;
    tracking_code: string;
    carrier: string;
    discrepancy_type: string;
    discrepancy_note: string;
    discrepancy_photo: string;
    received_at: string | null;
    created_at: string | null;
  }[];
  has_label?: boolean;
  packed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
};

export function carrierLabel(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("lightdata") || s.includes("flexi")) return "Unifast";
  if (s.includes("oca")) return "OCA";
  return raw;
}

export function ChannelBadge({ origen }: { origen: "ml" | "tn" }) {
  if (origen === "ml") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-[#FFE600] text-[#333] border border-[#E8C800]">
        ML
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-[#23A0DF] text-white border border-[#1580B8]">
      TN
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "paid" || s === "processed" || s === "delivered" || s === "entregado"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "pending" || s === "open" || s === "shipped" || s === "en_camino"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : s === "cancelled" || s === "failed"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>
      {status}
    </span>
  );
}

export function ShippingTypeBadge({ type }: { type: string }) {
  const t = (type || "").toLowerCase();
  const cls =
    t.includes("flex") || t.includes("self") || t.includes("xd")
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : t.includes("full") || t.includes("fulfillment")
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : t.includes("pr") || t.includes("retiro") || t.includes("drop_off")
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-zinc-50 text-zinc-600 border-zinc-200";
  const label = t.includes("flex") || t.includes("self") ? "FLEXI"
    : t.includes("full") ? "FULL"
    : t.includes("retiro") || t.includes("drop_off") ? "PR"
    : type.toUpperCase().slice(0, 10);
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>
      {label}
    </span>
  );
}

export function OrderPipelineDetail({ o }: { o: UnifiedOrder }) {
  const ps = (o.payment_status || o.status || "").toLowerCase();
  const ss = (o.shipping_status || "").toLowerCase();
  const isPaid = ["paid", "processed", "approved"].some((v) => ps.includes(v));
  const isPacked = !!o.packed_at || !!o.label_downloaded;
  const isDelivered = !!o.delivered_at || ["delivered", "entregado"].some((v) => ss.includes(v)) || !!o.shipment?.entregado;
  const isShipped = !!o.shipped_at || ["shipped", "transit", "en_camino"].some((v) => ss.includes(v)) || isDelivered;

  const stepDate = (iso?: string | null) => {
    if (!iso) return null;
    try {
      let s = iso.trim().replace(" ", "T");
      if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
      const d = new Date(s);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
    } catch {
      return null;
    }
  };

  const step = (done: boolean, label: string, icon: string, date?: string | null, gold?: boolean) => (
    <div className="flex flex-col items-center gap-1 min-w-[58px]">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
        done ? `bg-emerald-500 border-emerald-500 ${gold ? "text-amber-300" : "text-white"}` : "bg-zinc-100 text-zinc-400 border-zinc-200"
      }`}>{icon}</div>
      <span className={`text-[10px] leading-none text-center ${done ? "text-emerald-700 font-semibold" : "text-zinc-400"}`}>{label}</span>
      {date && <span className="text-[9px] leading-none text-text-muted tabular-nums">{date}</span>}
    </div>
  );
  const line = (on: boolean) => (
    <div className={`flex-1 h-0.5 mb-6 ${on ? "bg-emerald-400" : "bg-zinc-200"}`} />
  );
  return (
    <div className="flex items-start gap-1.5">
      {step(true, "Creada", "📋", stepDate(o.fecha))}
      {line(isPaid)}
      {step(isPaid || o.origen === "ml", "Pagada", "$", stepDate(o.origen === "ml" ? o.fecha : o.paid_at), o.origen === "ml")}
      {line(isPacked)}
      {step(isPacked, "Empaquetado", "📦", stepDate(o.packed_at || o.label_downloaded_at))}
      {line(isShipped)}
      {step(isShipped, "En camino", "🚚", stepDate(o.shipped_at))}
      {line(isDelivered)}
      {step(isDelivered, "Entregada", "✅", stepDate(o.delivered_at || o.shipment?.entregado || undefined))}
    </div>
  );
}

export function UnifiedOrderModal({
  order,
  onClose,
}: {
  order: UnifiedOrder | null;
  onClose: () => void;
}) {
  if (!order) return null;
  const sumPrice = (order.items ?? []).reduce((s, i) => s + i.price * i.qty, 0);
  const sumCost = (order.items ?? []).reduce((s, i) => s + (i.cost ?? 0) * i.qty, 0);
  const sumProfit = sumPrice - sumCost;
  const merchCost = order.merch_cost > 0 ? order.merch_cost : sumCost;
  const totalPagar = order.invoice?.total && order.invoice.total > 0
    ? order.invoice.total
    : merchCost + order.shipping_cost;
  const profit = order.total - totalPagar;
  const fullAddress = [
    order.shipping_address || order.billing_address,
    order.shipping_city || order.billing_city,
    order.billing_province,
    order.shipping_zipcode || order.billing_zipcode,
  ].filter(Boolean).join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start gap-3 sticky top-0 bg-surface z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ChannelBadge origen={order.origen} />
              <span className="text-lg font-bold text-text font-mono">{order.number || order.external_id || `ID ${order.internal_id ?? '?'}`}</span>
              <OrderStatusBadge status={order.payment_status || order.status} />
              {order.shipping_status && <OrderStatusBadge status={order.shipping_status} />}
              {order.is_combo && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">COMBO</span>}
              {order.shipping_type && <ShippingTypeBadge type={order.shipping_type} />}
              {order.cancel_by_unidrop && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">CANCELADA UNIDROP</span>}
            </div>
            <div className="text-xs text-text-muted mt-1">{fmtArDateTime(order.fecha)}</div>
            {order.tags && order.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-2">
                {order.tags.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-soft text-text-muted border border-border">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {order.invoice?.link && (
              <a href={order.invoice.link} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100"
                 title={`Factura ${order.invoice.tipo} ${order.invoice.numero}`}>
                <FileText size={11} /> Ver Factura
              </a>
            )}
            {order.has_label && (
              <button
                onClick={async () => {
                  const path = order.origen === "ml"
                    ? `/api/dashboards/orders/ml/${encodeURIComponent(order.external_id)}/label`
                    : `/api/dashboards/orders/tn/${encodeURIComponent(String(order.internal_id ?? ''))}/label`;
                  const token = typeof window !== "undefined" ? window.localStorage.getItem("unidata.token") : null;
                  const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://api.unidatacenter.com.ar";
                  try {
                    const res = await fetch(`${apiBase}${path}`, {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!res.ok) {
                      alert(`No se pudo descargar la etiqueta (${res.status})`);
                      return;
                    }
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${order.number || order.external_id}-etiqueta.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (e) {
                    alert("Error descargando etiqueta: " + (e instanceof Error ? e.message : String(e)));
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100">
                <Download size={11} /> Etiqueta
              </button>
            )}
            {(order.number || order.external_id) && (
              <a href={`https://www.unidrop.com.ar/panel/unified-orders?page=1&search=${encodeURIComponent(order.number || order.external_id || '')}`}
                 target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5">
                <ExternalLink size={11} /> Unidrop
              </a>
            )}
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-soft text-text-muted hover:text-text">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Productos */}
          {(order.items?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Package size={12} /> Productos · {order.items!.length} {order.items!.length === 1 ? "línea" : "líneas"}
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Producto</th>
                      <th className="text-center px-2 py-2 w-12">Uds</th>
                      <th className="text-right px-2 py-2 w-24">Costo Ud.</th>
                      <th className="text-right px-2 py-2 w-24">Precio Ud.</th>
                      <th className="text-right px-2 py-2 w-24">Ganancia Ud.</th>
                      <th className="text-right px-2 py-2 w-24">Costo Total</th>
                      <th className="text-right px-2 py-2 w-24">Precio Total</th>
                      <th className="text-right px-3 py-2 w-24">Ganancia Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items!.map((item, ii) => {
                      const isCombo = item.item_type?.toUpperCase() === "COMBO";
                      const ganUd = item.price - (item.cost ?? 0);
                      const costTot = (item.cost ?? 0) * item.qty;
                      const priceTot = item.price * item.qty;
                      const ganTot = priceTot - costTot;
                      return (
                        <tr key={ii} className="border-t border-border align-top">
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              {item.image_url ? (
                                <img src={item.image_url} alt={item.sku} className="w-8 h-8 rounded-md object-cover border border-border flex-shrink-0" loading="lazy" />
                              ) : (
                                <div className="w-8 h-8 rounded-md bg-soft border border-border flex items-center justify-center flex-shrink-0">
                                  <Package size={12} className="text-text-muted" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-text truncate">{item.name || "—"}</span>
                                  {isCombo && <span className="px-1 py-0 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">C</span>}
                                </div>
                                {item.sku ? (
                                  <Link href={`/dashboard/productos/${encodeURIComponent(item.sku)}`}
                                        className="text-[10px] text-primary font-mono hover:underline inline-flex items-center gap-0.5"
                                        title={`Abrir Producto 360 de ${item.sku}`}>
                                    SKU {item.sku} <ExternalLink size={8} />
                                  </Link>
                                ) : <div className="text-[10px] text-text-muted font-mono">SKU —</div>}
                              </div>
                            </div>
                          </td>
                          <td className="text-center px-2 py-2 tabular-nums">{item.qty}</td>
                          <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(item.cost) : "—"}</td>
                          <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(item.price)}</td>
                          <td className="text-right px-2 py-2 tabular-nums text-primary font-semibold">{item.cost ? formatCurrency(ganUd) : "—"}</td>
                          <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(costTot) : "—"}</td>
                          <td className="text-right px-2 py-2 tabular-nums font-semibold">{formatCurrency(priceTot)}</td>
                          <td className="text-right px-3 py-2 tabular-nums text-primary font-bold">{item.cost ? formatCurrency(ganTot) : "—"}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border bg-soft/50 font-bold">
                      <td className="px-3 py-2 text-text-muted text-[10px] uppercase tracking-wider" colSpan={5}>Totales</td>
                      <td className="text-right px-2 py-2 tabular-nums">{sumCost > 0 ? formatCurrency(sumCost) : "—"}</td>
                      <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(sumPrice)}</td>
                      <td className="text-right px-3 py-2 tabular-nums text-primary">{sumCost > 0 ? formatCurrency(sumProfit) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Grid: pago + envío + cliente + pipeline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Pago */}
            <div>
              <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <DollarSign size={12} /> Pago
              </div>
              <div className="bg-soft rounded-lg p-3 space-y-1.5 text-xs">
                {order.subtotal && order.subtotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Subtotal productos</span>
                    <span className="tabular-nums">{formatCurrency(order.subtotal)}</span>
                  </div>
                )}
                {order.discount && order.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Descuento</span>
                    <span className="tabular-nums text-rose-600">−{formatCurrency(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-muted">Costo mercadería</span>
                  <span className="tabular-nums">{merchCost > 0 ? formatCurrency(merchCost) : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Costo envío</span>
                  <span className="tabular-nums">{order.shipping_cost > 0 ? formatCurrency(order.shipping_cost) : "—"}</span>
                </div>
                {order.total_cost && order.total_cost > 0 && (
                  <div className="flex justify-between font-semibold">
                    <span className="text-text-muted">Costo total</span>
                    <span className="tabular-nums">{formatCurrency(order.total_cost)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1.5 mt-1.5 font-bold">
                  <span>Total a pagar (Unidrop)</span>
                  <span className="tabular-nums text-primary">{formatCurrency(totalPagar)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                  <span className="text-text-muted">Ingreso total ({order.origen === "ml" ? "ML" : "TN"})</span>
                  <span className="tabular-nums font-semibold">{formatCurrency(order.total)}</span>
                </div>
                {profit > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Net revenue dropshipper</span>
                    <span className="tabular-nums font-bold text-emerald-600">{formatCurrency(profit)}</span>
                  </div>
                )}
              </div>
              {(order.gateway_name || order.gateway) && (
                <div className="mt-2 px-3 py-2 bg-soft/60 border border-border rounded-lg text-[11px]">
                  <span className="text-text-muted">Gateway: </span>
                  <span className="font-semibold text-text">{order.gateway_name || order.gateway}</span>
                  {order.gateway_link && (
                    <a href={order.gateway_link} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline inline-flex items-center gap-1"><ExternalLink size={9} />Ver pago</a>
                  )}
                </div>
              )}
            </div>

            {/* Envío */}
            <div>
              <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Truck size={12} /> Envío {order.shipping_carrier ? `· ${order.shipping_carrier}` : (order.shipment ? `· ${carrierLabel(order.shipment.carrier)}` : "")}
              </div>
              <div className="bg-soft rounded-lg p-3 space-y-1.5 text-xs">
                {order.shipping_type && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Tipo</span>
                    <ShippingTypeBadge type={order.shipping_type} />
                  </div>
                )}
                {order.shipment?.status && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Estado</span>
                    <span className="font-semibold">{order.shipment.status}</span>
                  </div>
                )}
                {order.shipment?.entregado && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Entregado</span>
                    <span className="text-emerald-700 font-semibold">{order.shipment.entregado.slice(0, 10)}</span>
                  </div>
                )}
                {order.shipment?.tracking_number && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Tracking #</span>
                    <span className="font-mono text-[11px]">{order.shipment.tracking_number}</span>
                  </div>
                )}
                {order.shipment?.tracking_url && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Tracking</span>
                    <a href={order.shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1"><ExternalLink size={9} />Seguir envío</a>
                  </div>
                )}
                {fullAddress && (
                  <div className="pt-1.5 border-t border-border mt-1.5">
                    <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Dirección de entrega</div>
                    <div className="text-text">{fullAddress}</div>
                    {order.shipping_floor && (
                      <div className="text-text-muted text-[10px]">Piso/Depto: {order.shipping_floor}</div>
                    )}
                    {order.shipping_comment && order.shipping_comment !== "." && (
                      <div className="text-text-muted text-[10px] italic mt-1">📝 {order.shipping_comment}</div>
                    )}
                    {(order.shipping_receiver || order.shipment?.receiver_name) && (
                      <div className="text-text-muted text-[10px] mt-1">Recibe: <span className="text-text font-semibold">{order.shipping_receiver || order.shipment?.receiver_name}</span></div>
                    )}
                    {(order.shipping_phone || order.shipment?.receiver_phone) && (
                      <div className="text-text-muted text-[10px]">📞 {order.shipping_phone || order.shipment?.receiver_phone}</div>
                    )}
                  </div>
                )}
                {!fullAddress && !order.shipment && (
                  <div className="text-text-muted italic">Sin info de envío registrada</div>
                )}
              </div>
            </div>

            {/* Datos del cliente */}
            <div>
              <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Datos del cliente</div>
              <div className="bg-soft rounded-lg p-3 space-y-2 text-xs">
                {order.buyer_name ? (
                  <div className="text-sm font-bold text-text">{order.buyer_name}</div>
                ) : <div className="text-text-muted italic">Sin nombre registrado</div>}
                {order.contact_email && (
                  <div className="flex items-center gap-1.5 text-text-muted"><Mail size={11} /> {order.contact_email}</div>
                )}
                {order.contact_phone && (
                  <div className="flex items-center gap-1.5 text-text-muted"><Phone size={11} /> {order.contact_phone}</div>
                )}
                {order.contact_dni && (
                  <div className="flex items-center gap-1.5 text-text-muted"><IdCard size={11} /> DNI/CUIT {order.contact_dni}</div>
                )}
                {order.buyer_id && order.origen === "ml" && (
                  <div className="flex items-center gap-1.5 text-text-muted"><IdCard size={11} /> ML buyer #{order.buyer_id}</div>
                )}
                {order.billing_address && order.shipping_address && order.billing_address !== order.shipping_address && (
                  <div className="pt-1.5 border-t border-border mt-1.5">
                    <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Dirección de facturación</div>
                    <div>{[order.billing_address, order.billing_city, order.billing_province, order.billing_zipcode].filter(Boolean).join(" · ")}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Pipeline + Operativa */}
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Estado del pedido</div>
                <OrderPipelineDetail o={order} />
              </div>
              {(order.label_downloaded || order.notification_pack || order.notification_ship || order.manual_packed_at || order.manual_payment_at) && (
                <div className="bg-soft/60 border border-border rounded-lg p-3 text-[11px] space-y-1">
                  <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Operativa</div>
                  {order.label_downloaded && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Etiqueta descargada</span>
                      <span className="text-emerald-700 font-semibold">{order.label_downloaded_at ? fmtArDateTime(order.label_downloaded_at) : "Sí"}</span>
                    </div>
                  )}
                  {order.notification_pack && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Notif. empaquetado</span>
                      <span className="text-emerald-700 font-semibold">Enviada</span>
                    </div>
                  )}
                  {order.notification_ship && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Notif. envío</span>
                      <span className="text-emerald-700 font-semibold">Enviada</span>
                    </div>
                  )}
                  {order.manual_packed_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Marcada empaquetada</span>
                      <span className="text-text-muted">{fmtArDateTime(order.manual_packed_at)}</span>
                    </div>
                  )}
                  {order.manual_payment_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Marcada pagada</span>
                      <span className="text-text-muted">{fmtArDateTime(order.manual_payment_at)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Timestamps TN */}
          {(order.paid_at || order.completed_at || order.cancelled_at || order.closed_at) && (
            <div className="bg-soft/40 border border-border rounded-lg p-3 text-[11px] grid grid-cols-2 md:grid-cols-4 gap-y-1.5 gap-x-4">
              {order.paid_at && (
                <div><span className="text-text-muted">Pagada:</span> <span className="font-semibold text-emerald-700">{fmtArDateTime(order.paid_at)}</span></div>
              )}
              {order.completed_at && (
                <div><span className="text-text-muted">Completada:</span> <span className="font-semibold">{fmtArDateTime(order.completed_at)}</span></div>
              )}
              {order.closed_at && (
                <div><span className="text-text-muted">Cerrada:</span> <span className="font-semibold">{fmtArDateTime(order.closed_at)}</span></div>
              )}
              {order.cancelled_at && (
                <div><span className="text-text-muted">Cancelada:</span> <span className="font-semibold text-rose-600">{fmtArDateTime(order.cancelled_at)}</span></div>
              )}
            </div>
          )}

          {/* Notas TN */}
          {(order.note || order.owner_note) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {order.note && (
                <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-3 text-xs">
                  <div className="text-amber-800 text-[10px] uppercase tracking-wider mb-1 font-bold">Nota del cliente</div>
                  <div className="text-text">{order.note}</div>
                </div>
              )}
              {order.owner_note && (
                <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-3 text-xs">
                  <div className="text-blue-800 text-[10px] uppercase tracking-wider mb-1 font-bold">Nota del dropshipper</div>
                  <div className="text-text">{order.owner_note}</div>
                </div>
              )}
            </div>
          )}

          {/* Factura Contabilium */}
          {order.invoice && (
            <div className="bg-emerald-50/40 border border-emerald-200 rounded-lg p-3">
              <div className="text-emerald-900 text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                <FileText size={12} /> Factura emitida (Contabilium)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-1.5 gap-x-4 text-xs">
                <div>
                  <div className="text-text-muted text-[10px]">Tipo</div>
                  <div className="font-bold">{order.invoice.tipo}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px]">Número</div>
                  <div className="font-mono font-bold">{order.invoice.numero}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px]">Fecha emisión</div>
                  <div>{order.invoice.fecha ? fmtArDateTime(order.invoice.fecha) : "—"}</div>
                </div>
                <div>
                  <div className="text-text-muted text-[10px]">Total facturado</div>
                  <div className="tabular-nums font-bold">{formatCurrency(order.invoice.total)}</div>
                </div>
                {order.invoice.cae && (
                  <div className="col-span-2">
                    <div className="text-text-muted text-[10px]">CAE</div>
                    <div className="font-mono text-[11px]">{order.invoice.cae}</div>
                  </div>
                )}
                {order.invoice.link && (
                  <div className="col-span-2 md:col-span-4">
                    <a href={order.invoice.link} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 text-primary hover:underline font-semibold text-xs">
                      <ExternalLink size={11} /> Abrir factura en Contabilium
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Devoluciones ML */}
          {order.returns && order.returns.length > 0 && (
            <div className="bg-rose-50/40 border border-rose-200 rounded-lg p-3">
              <div className="text-rose-900 text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                <RotateCcw size={12} /> Devoluciones MELI · {order.returns.length}
              </div>
              <div className="space-y-3">
                {order.returns.map((ret, ri) => (
                  <div key={ri} className="bg-surface border border-rose-200/50 rounded-md p-2.5 text-xs">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-3">
                      <div>
                        <div className="text-text-muted text-[10px]">Estado</div>
                        <span className="inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold bg-rose-50 text-rose-700 border-rose-200">{ret.status || "—"}</span>
                      </div>
                      {ret.reason && (
                        <div className="col-span-2 md:col-span-3">
                          <div className="text-text-muted text-[10px]">Motivo</div>
                          <div className="text-text">{ret.reason}</div>
                        </div>
                      )}
                      {ret.amount_to_refund > 0 && (
                        <div>
                          <div className="text-text-muted text-[10px]">Monto a reintegrar</div>
                          <div className="tabular-nums font-bold text-rose-700">{formatCurrency(ret.amount_to_refund)}</div>
                        </div>
                      )}
                      {ret.tracking_code && (
                        <div>
                          <div className="text-text-muted text-[10px]">Tracking devolución</div>
                          <div className="font-mono text-[11px]">{ret.tracking_code}</div>
                        </div>
                      )}
                      {ret.carrier && (
                        <div>
                          <div className="text-text-muted text-[10px]">Carrier</div>
                          <div>{ret.carrier}</div>
                        </div>
                      )}
                      {ret.created_at && (
                        <div>
                          <div className="text-text-muted text-[10px]">Iniciada</div>
                          <div className="text-text-muted">{fmtArDateTime(ret.created_at)}</div>
                        </div>
                      )}
                      {ret.received_at && (
                        <div>
                          <div className="text-text-muted text-[10px]">Recibida</div>
                          <div className="text-emerald-700 font-semibold">{fmtArDateTime(ret.received_at)}</div>
                        </div>
                      )}
                      {ret.discrepancy_type && (
                        <div className="col-span-2">
                          <div className="text-text-muted text-[10px]">Discrepancia</div>
                          <div>{ret.discrepancy_type}{ret.discrepancy_note ? ` — ${ret.discrepancy_note}` : ""}</div>
                        </div>
                      )}
                      {ret.discrepancy_photo && (
                        <div className="col-span-2 md:col-span-4">
                          <a href={ret.discrepancy_photo} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            <ExternalLink size={9} /> Ver foto de discrepancia
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* IDs técnicos */}
          <div className="bg-soft/50 border border-border rounded-lg p-3 text-[10px] text-text-muted grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-4">
            {order.number && <div>Número DROP: <span className="font-mono font-bold text-text">{order.number}</span></div>}
            {order.external_id && <div>ID externo: <span className="font-mono text-text">{order.external_id}</span></div>}
            {order.internal_id && <div>ID interno: <span className="font-mono text-text">{order.internal_id}</span></div>}
            {order.intent_id && <div>PaymentIntent: <span className="font-mono text-text">#{order.intent_id}</span></div>}
            {order.returns_count && order.returns_count > 0 && (
              <div className="text-rose-600 font-semibold flex items-center gap-1 col-span-2"><RotateCcw size={9} /> {order.returns_count} devolución{order.returns_count !== 1 ? "es" : ""}</div>
            )}
          </div>
        </div>
        <div className="px-6 py-3 border-t border-border text-[10px] text-text-muted">
          Click fuera del modal o en ✕ para cerrar
        </div>
      </div>
    </div>
  );
}
