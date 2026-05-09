"use client";

import { Inbox, DollarSign, Truck, PackageCheck, AlertCircle, RotateCcw, X, Clock, Check, MapPin, Mail, Package, Bike } from "lucide-react";

/**
 * Pipeline visual del progreso de una orden: 4 dots que se desbloquean
 *   Recibida -> Pagada -> Enviada -> Entregada
 *
 * Maneja casos especiales (cancelled / refunded / pending) con iconos rojos
 * o amarillos. Mostrar como tooltip el estado especifico de cada paso.
 *
 * Reemplaza visualmente las 2 columnas Payment + Shipping del PowerBI.
 */

type Step = {
  key: "received" | "paid" | "shipped" | "delivered";
  label: string;
  icon: any;
  active: boolean;
  warning?: boolean;
  cancelled?: boolean;
  hint?: string;
};

const PAYMENT_PAID = ["paid", "approved", "completed", "succeeded"];
const PAYMENT_PENDING = ["pending", "authorized", "processing"];
const PAYMENT_FAIL = ["refunded", "voided", "abandoned", "cancelled", "expired"];

const SHIPPING_DELIVERED = ["delivered"];
const SHIPPING_INTRANSIT = ["shipped", "fulfilled"];
const SHIPPING_PACKED = ["unshipped", "ready_to_ship"];
const SHIPPING_NOT_PACKED = ["unpacked"];

function normalize(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function buildSteps(payment: string, shipping: string, orderStatus: string): Step[] {
  const p = normalize(payment);
  const s = normalize(shipping);
  const o = normalize(orderStatus);

  const isCancelled = o === "cancelled" || p === "voided" || p === "abandoned";
  const isRefunded = p === "refunded";
  const isPaymentFail = PAYMENT_FAIL.includes(p);
  const isPending = PAYMENT_PENDING.includes(p);
  const isPaid = PAYMENT_PAID.includes(p);

  const isDelivered = SHIPPING_DELIVERED.includes(s);
  const isInTransit = SHIPPING_INTRANSIT.includes(s);
  const isPacked = SHIPPING_PACKED.includes(s) || isInTransit || isDelivered;

  return [
    {
      key: "received",
      label: "Recibida",
      icon: Inbox,
      active: true, // siempre activa una vez existe la orden
      hint: "Orden creada en el sistema",
    },
    {
      key: "paid",
      label: isRefunded ? "Reembolsada" : isCancelled ? "Anulada" : isPending ? "Pendiente de pago" : "Pagada",
      icon: isRefunded ? RotateCcw : isCancelled ? X : isPending ? Clock : DollarSign,
      active: isPaid,
      warning: isPending,
      cancelled: isPaymentFail || isCancelled,
      hint: `Pago: ${payment || "—"}`,
    },
    {
      key: "shipped",
      label: isInTransit ? "En camino" : isPacked ? "Lista para enviar" : "Sin armar",
      icon: Truck,
      active: isInTransit || isDelivered,
      warning: isPacked && !isInTransit,
      hint: `Envio: ${shipping || "—"}`,
    },
    {
      key: "delivered",
      // Cuando el ciclo esta cumplido reemplazamos el packagecheck por un Check
      // verde brillante para evitar redundancia con "Enviada" del paso anterior.
      label: isDelivered ? "Ciclo cumplido" : "Entregada",
      icon: isDelivered ? Check : PackageCheck,
      active: isDelivered,
      hint: isDelivered ? "Pedido entregado · ciclo completo" : "Aun no entregado",
    },
  ];
}

/** Devuelve un icono pequeño para representar el canal/metodo de envio. */
export function shippingChannelIcon(canal: string | null | undefined) {
  const c = String(canal ?? "").toLowerCase();
  if (c.includes("retiro") || c.includes("pickup") || c.includes("microcentro")) return MapPin;
  if (c.includes("moto") || c.includes("cadeter")) return Bike;
  if (c.includes("oca") || c.includes("andreani") || c.includes("correo")) return Mail;
  if (c.includes("unifast")) return Truck;
  if (c.includes("personalizado") || c.includes("convenir")) return Package;
  return Truck;
}

const CHANNEL_COLORS: Record<string, string> = {
  "OCA": "bg-blue-50 text-blue-700 border-blue-200",
  "Correo Argentino": "bg-sky-50 text-sky-700 border-sky-200",
  "Unifast": "bg-orange-50 text-orange-700 border-orange-200",
  "Retiro presencial": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Moto / Cadeteria": "bg-violet-50 text-violet-700 border-violet-200",
  "Andreani": "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Personalizado": "bg-amber-50 text-amber-700 border-amber-200",
  "(sin metodo)": "bg-zinc-50 text-zinc-500 border-zinc-200",
  "Otro": "bg-zinc-50 text-zinc-600 border-zinc-200",
};

/** Badge compacto que muestra el canal de envio + tooltip con metodo crudo. */
export function ShippingMethodBadge({
  canal,
  metodo,
}: {
  canal?: string | null;
  metodo?: string | null;
}) {
  const cleanCanal = (canal ?? "").trim() || "(sin metodo)";
  const cleanMetodo = (metodo ?? "").trim();
  const Icon = shippingChannelIcon(cleanCanal);
  const cls = CHANNEL_COLORS[cleanCanal] ?? CHANNEL_COLORS["Otro"];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border ${cls} max-w-[180px]`}
      title={cleanMetodo || cleanCanal}
    >
      <Icon size={10} className="shrink-0" />
      <span className="truncate">{cleanCanal}</span>
    </span>
  );
}

export function OrderStatusPipeline({
  payment,
  shipping,
  orderStatus,
  compact = false,
}: {
  payment?: unknown;
  shipping?: unknown;
  orderStatus?: unknown;
  /** compact: mas estrecho para tablas densas */
  compact?: boolean;
}) {
  const steps = buildSteps(String(payment ?? ""), String(shipping ?? ""), String(orderStatus ?? ""));
  const dotSize = compact ? 22 : 26;
  const iconSize = compact ? 11 : 13;

  const cycleComplete = steps[steps.length - 1].active;

  return (
    <div className="inline-flex items-center gap-0.5">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === steps.length - 1;

        // Colores segun estado. El ultimo step recibe un highlight extra
        // cuando el ciclo esta cumplido para diferenciarlo visualmente.
        const dotClass = step.cancelled
          ? "bg-rose-100 border-rose-300 text-rose-600"
          : step.warning
          ? "bg-amber-100 border-amber-300 text-amber-700"
          : step.active
          ? isLast
            ? "bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/40 ring-2 ring-emerald-200"
            : "bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
          : "bg-zinc-100 border-zinc-200 text-zinc-400";

        const lineClass = steps[i + 1]?.active
          ? "bg-emerald-400"
          : steps[i + 1]?.warning
          ? "bg-amber-300"
          : steps[i + 1]?.cancelled
          ? "bg-rose-300"
          : "bg-zinc-200";

        return (
          <div key={step.key} className="inline-flex items-center" title={`${step.label} · ${step.hint || ""}`}>
            <div
              className={`flex items-center justify-center rounded-full border-[1.5px] ${dotClass} transition-all`}
              style={{ width: isLast && cycleComplete ? dotSize + 2 : dotSize, height: isLast && cycleComplete ? dotSize + 2 : dotSize }}
            >
              <Icon size={isLast && cycleComplete ? iconSize + 1 : iconSize} strokeWidth={isLast && cycleComplete ? 3 : 2.5} />
            </div>
            {!isLast && (
              <div className={`h-[2px] w-3 ${lineClass} transition-colors`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Badge individual: para casos donde solo se tiene un campo (payment O shipping)
 * y no la fila completa.
 */
export function OrderStatusBadge({ kind, value }: { kind: "payment" | "shipping" | "status"; value: unknown }) {
  const v = normalize(value);
  if (!v) return <span className="text-text-muted">—</span>;

  const cfg = (() => {
    if (kind === "payment") {
      if (PAYMENT_PAID.includes(v)) return { icon: DollarSign, label: "Pagada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
      if (PAYMENT_PENDING.includes(v)) return { icon: Clock, label: "Pendiente", cls: "bg-amber-50 text-amber-700 border-amber-200" };
      if (PAYMENT_FAIL.includes(v)) return { icon: AlertCircle, label: v.charAt(0).toUpperCase() + v.slice(1), cls: "bg-rose-50 text-rose-700 border-rose-200" };
      return { icon: DollarSign, label: v, cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
    }
    if (kind === "shipping") {
      if (SHIPPING_DELIVERED.includes(v)) return { icon: PackageCheck, label: "Entregada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
      if (SHIPPING_INTRANSIT.includes(v)) return { icon: Truck, label: "En camino", cls: "bg-blue-50 text-blue-700 border-blue-200" };
      if (SHIPPING_PACKED.includes(v)) return { icon: Inbox, label: "Lista para enviar", cls: "bg-amber-50 text-amber-700 border-amber-200" };
      if (SHIPPING_NOT_PACKED.includes(v)) return { icon: Inbox, label: "Sin armar", cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
      return { icon: Truck, label: v, cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
    }
    // status
    if (v === "open") return { icon: Inbox, label: "Abierta", cls: "bg-blue-50 text-blue-700 border-blue-200" };
    if (v === "closed") return { icon: PackageCheck, label: "Cerrada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (v === "cancelled") return { icon: X, label: "Cancelada", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    return { icon: Clock, label: v, cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
  })();

  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}
