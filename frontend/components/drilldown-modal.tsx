"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { X, Download, ExternalLink, User, MapPin, Package, Boxes, Truck, Tag, Building, Share2, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime, tnAdminUrl, looksLikeTnOrderId } from "@/lib/dates";
import { OrderStatusPipeline, OrderStatusBadge, ShippingMethodBadge } from "@/components/order-status-pipeline";

type Result = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  /** Si esta presente, se renderiza una franja de totales arriba de la tabla.
   * Lo usa /api/drilldowns/orders/paid para mostrar ingreso vs ganancia neta vs
   * efectivo pendiente del periodo. Otros drilldowns lo omiten y la franja
   * desaparece. */
  summary?: {
    total_orders?: number;
    total_ingreso?: number;
    total_ganancia_neta?: number;
    margen_pct?: number;
    cash_pendiente_total?: number;
    cash_cobrado_total?: number;
    online_total?: number;
    cost_coverage_pct?: number;
    orders_sin_costo?: number;
    breakdown?: { iibb?: number; iva_neto_a_pagar?: number; gateway_fee?: number; costo_con_iva?: number };
  };
};

type ProfitDict = {
  ingreso_bruto?: number;
  costo_con_iva?: number;
  base_imponible_venta?: number;
  iva_aliquot?: number;
  iva_aliquot_source?: string;
  iva_ventas?: number;
  iva_compras?: number;
  iva_neto_a_pagar?: number;
  iibb?: number;
  gateway_fee?: number;
  gateway_fee_rate?: number;
  ganancia_neta?: number;
  margen_pct?: number;
  has_cost?: boolean;
  is_cash?: boolean;
  is_digital?: boolean;
};

// Una columna se considera "moneda $" si su NOMBRE incluye cualquiera de estos
// tokens. Cubre todas las columnas $ que aparecen en los drilldowns:
// totales/revenue/gmv/facturacion + ticket promedio + max order/orden mas alta
// + LTV + comisiones + acreditado + monto pagado/esperado + paid/pending +
// saldo/deuda + profit/ganancia/margen/rentabilidad + costos + precio + valor.
const CURRENCY_HINT = /total|amount|subtotal|revenue|commission|comision|costo|precio|gmv|cobrado|monto|ticket|ltv|max_order|orden_max|orden_mas|paid|pending|saldo|deuda|profit|ganancia|margen|rentabilidad|facturacion|acreditado|gasto|spend|cobranza|lifetime|valor_compra|valor_max|valor_min|ars$|usd$/i;
const NUMBER_HINT = /^(qty|cantidad|unidades|ordenes|orders|n|count|days|dias)$/i;
const PHONE_HINT = /^(phone|telefono|tel|whatsapp|celular)$/i;
const EMAIL_HINT = /^(email|mail|correo)$/i;
const CUSTOMER_NAME_HINT = /^(cliente|customer|customer_name|nombre_cliente|client|client_name)$/i;
const PROVINCE_HINT = /^(provincia|province|region|departamento)$/i;
const SKU_HINT = /^(sku|sku2|producto_sku|seller_sku|codigo|articulo)$/i;
const PAYMENT_HINT = /^(payment|paymentstatus|pago|payment_status|estado_pago)$/i;
const SHIPPING_HINT = /^(shipping|shippingstatus|envio|shipping_status|estado_envio)$/i;
const SHIPPING_METHOD_HINT = /^(metodo_envio|shipping_method|shippingMethod|metodo|envio_metodo)$/i;
const SHIPPING_CHANNEL_HINT = /^(canal|canal_envio|shipping_channel|carrier_channel)$/i;
const STATUS_HINT = /^(status|estado|order_status)$/i;
const LOTE_HINT = /^(lote|lote_name|nombre_lote|batch)$/i;
const CATEGORIA_HINT = /^(categoria|category|sub_categoria|sub-categoria|sub_category|subcategoria)$/i;
const MARCA_HINT = /^(marca|brand|fabricante)$/i;
const PROVEEDOR_HINT = /^(proveedor|supplier|provider|origen)$/i;
const CIUDAD_HINT = /^(ciudad|city|localidad)$/i;
const PRODUCT_NAME_HINT = /^(producto|product|product_name|nombre_producto|item)$/i;

/** Busca en la fila el valor de una columna (case-insensitive, devuelve null si no esta). */
function findColValue(columns: string[], row: unknown[], colNames: string[]): unknown {
  for (const target of colNames) {
    const idx = columns.findIndex((c) => c.toLowerCase() === target.toLowerCase());
    if (idx >= 0 && row[idx] !== null && row[idx] !== undefined && row[idx] !== "") {
      return row[idx];
    }
  }
  return null;
}

/** Normaliza un telefono argentino para wa.me. */
function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("549")) return digits;
  if (digits.startsWith("54")) return "549" + digits.slice(2);
  if (digits.startsWith("0")) return "549" + digits.slice(1);
  if (digits.length === 10) return "549" + digits;
  return digits;
}

const METODO_PAGO_TIPO_HINT = /^(metodo_pago_tipo|payment_type)$/i;
const GANANCIA_NETA_HINT = /^(ganancia_neta|profit_net|net_profit)$/i;

function MetodoPagoTipoBadge({ tipo, metodo }: { tipo: string; metodo?: string | null }) {
  const lc = tipo.toLowerCase();
  const isEfectivo = lc === "efectivo";
  const isOnline = lc === "online";
  if (!isEfectivo && !isOnline) {
    return <span className="text-text-muted text-[10px] uppercase">{tipo}</span>;
  }
  const styles = isEfectivo
    ? {
        badge: "bg-amber-100 text-amber-900 border-amber-300",
        icon: "💵",
        label: "Efectivo",
        descripcion: "Cobro fuera del gateway (efectivo / transferencia / deposito presencial)",
        accent: "text-amber-900",
        ring: "ring-amber-300/50",
      }
    : {
        badge: "bg-violet-100 text-violet-900 border-violet-300",
        icon: "🟣",
        label: "Online",
        descripcion: "Cobro online via gateway (Pago Nube / GoCuotas / Mercado Pago)",
        accent: "text-violet-900",
        ring: "ring-violet-300/50",
      };
  const metodoLimpio = metodo ? metodo.trim() : "";
  const tieneMetodo = metodoLimpio.length > 0;
  const titleFallback = tieneMetodo
    ? `${styles.label} · ${metodoLimpio}\n${styles.descripcion}`
    : styles.descripcion;
  return (
    <span className="relative inline-block group/mptipo">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider cursor-help transition group-hover/mptipo:ring-2 ${styles.badge} ${styles.ring}`}
        title={titleFallback}
      >
        {styles.icon} {styles.label}
        {tieneMetodo && <span className="opacity-50 text-[8px] ml-0.5">ⓘ</span>}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-full mt-1.5 w-max max-w-[280px] opacity-0 group-hover/mptipo:opacity-100 transition-opacity duration-150"
      >
        <span className="block rounded-lg border border-border bg-surface shadow-xl px-3 py-2 text-left normal-case">
          {tieneMetodo && (
            <span className={`block font-semibold text-[11px] ${styles.accent} mb-0.5`}>
              {metodoLimpio}
            </span>
          )}
          <span className="block text-[10px] text-text-muted leading-snug">
            {styles.descripcion}
          </span>
        </span>
      </span>
    </span>
  );
}

function GananciaNetaCell({ value, profit }: { value: number; profit: ProfitDict | null }) {
  const color = value >= 0 ? "text-emerald-700" : "text-error";
  const margen = profit?.margen_pct;
  if (!profit) return <span className={color}>{formatCurrency(value)}</span>;
  const isDigital = profit.is_digital === true;
  const tooltipLines = [
    `Ingreso bruto:        ${formatCurrency(profit.ingreso_bruto ?? 0)}`,
    isDigital
      ? `- Sin costo (Prod. digital / suscripcion)`
      : `- Costo (c/IVA):      ${formatCurrency(profit.costo_con_iva ?? 0)}`,
    `- IVA neto a pagar:   ${formatCurrency(profit.iva_neto_a_pagar ?? 0)} (alic ${((profit.iva_aliquot ?? 0) * 100).toFixed(1)}% ${profit.iva_aliquot_source})`,
    `- IIBB (5% base imp): ${formatCurrency(profit.iibb ?? 0)}`,
    `- Fee gateway (${((profit.gateway_fee_rate ?? 0) * 100).toFixed(2)}%): ${formatCurrency(profit.gateway_fee ?? 0)}`,
    `= GANANCIA NETA:      ${formatCurrency(value)} (${(margen ?? 0).toFixed(1)}%)`,
  ];
  return (
    <span
      className={`inline-flex items-center gap-1 ${color} font-semibold`}
      title={tooltipLines.join("\n")}
    >
      {formatCurrency(value)}
      {margen !== undefined && (
        <span className="text-[9px] text-text-muted">({margen.toFixed(0)}%)</span>
      )}
      {isDigital && (
        <span className="text-[8px] px-1 rounded bg-sky-100 text-sky-800 uppercase tracking-wider" title="Producto digital / suscripcion: sin costo de inventario">
          digital
        </span>
      )}
    </span>
  );
}

export function CellRenderer({
  col,
  v,
  row,
  columns,
}: {
  col: string;
  v: unknown;
  /** Fila completa - opcional, permite cross-reference entre columnas (ej: nombre cliente -> customer_id) */
  row?: unknown[];
  columns?: string[];
}) {
  if (v === null || v === undefined || v === "") return <>—</>;

  // Tipo de medio de pago → badge color (efectivo / online)
  // Lee la columna metodo_pago de la misma fila para mostrarla en tooltip al hover.
  if (METODO_PAGO_TIPO_HINT.test(col)) {
    const metodoVal = row && columns
      ? findColValue(columns, row, ["metodo_pago", "gateway_name", "gatewayName"])
      : null;
    return <MetodoPagoTipoBadge tipo={String(v)} metodo={metodoVal != null ? String(metodoVal) : null} />;
  }

  // Ganancia neta → moneda + tooltip con desglose contable (lee 'profit' dict de la misma fila)
  if (GANANCIA_NETA_HINT.test(col) && typeof v === "number" && row && columns) {
    const profitIdx = columns.findIndex((c) => /^profit$/i.test(c));
    const profit = (profitIdx >= 0 ? row[profitIdx] : null) as ProfitDict | null;
    return <GananciaNetaCell value={v} profit={profit} />;
  }

  // Numero de orden TN: linkear a TN admin usando el id de la misma fila
  if (/^(numero|order_number|order_numero)$/i.test(col) && row && columns) {
    const orderId = findColValue(columns, row, ["id"]);
    if (orderId) {
      return (
        <a
          href={tnAdminUrl(String(orderId))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
          onClick={(e) => e.stopPropagation()}
          title="Abrir en Tienda Nube"
        >
          {String(v)}
          <ExternalLink size={9} className="opacity-60" />
        </a>
      );
    }
  }

  // Detectar contexto Unidrop: si la fila tiene una columna _unit con valor 'unidrop'
  // entonces los IDs y nombres NO deben linkear a vistas de Unistore (TN admin /
  // /dashboard/customer/[id]). Esto evita mostrar "Customer 360 · Unistore" con
  // datos vacios cuando el id en realidad es un User.id de Unidrop.
  const isUnidropRow = (() => {
    if (!row || !columns) return false;
    const idx = columns.findIndex((c) => /^_unit$/i.test(c));
    if (idx < 0) return false;
    return String(row[idx] ?? "").toLowerCase() === "unidrop";
  })();
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return <>{formatCurrency(v)}</>;
    if (NUMBER_HINT.test(col)) return <>{formatNumber(v)}</>;
    // En filas de Unidrop, los ids son User.id - linkear a vista 360 dropshipper.
    if (isUnidropRow) {
      // Solo linkear si la columna se llama "id" o "user_id" (no si es phone, dni, etc)
      if (/^(id|user_id|userId)$/i.test(col)) {
        return (
          <Link
            href={`/dashboard/dropshipper/${encodeURIComponent(String(v))}`}
            className="text-primary hover:underline font-mono"
            onClick={(e) => e.stopPropagation()}
            title="Abrir vista 360 dropshipper Unidrop"
          >
            {String(v)}
          </Link>
        );
      }
      return <>{String(v)}</>;
    }
    // Order ID grande → linkear a TN admin
    if (looksLikeTnOrderId(col, v)) {
      return (
        <a
          href={tnAdminUrl(v)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
          onClick={(e) => e.stopPropagation()}
          title="Abrir en Tienda Nube"
        >
          {String(v)}
          <ExternalLink size={9} className="opacity-60" />
        </a>
      );
    }
    return <>{String(v)}</>;
  }
  // Detectar fechas: ISO con T o "YYYY-MM-DD HH:MM:SS"
  if (typeof v === "string" && (/^\d{4}-\d{2}-\d{2}T/.test(v) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v))) {
    return <>{fmtArDateTime(v)}</>;
  }
  // Order id como string (solo en rows de Unistore — en Unidrop el id es User.id)
  if (typeof v === "string" && !isUnidropRow && looksLikeTnOrderId(col, v)) {
    return (
      <a
        href={tnAdminUrl(v)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
        onClick={(e) => e.stopPropagation()}
        title="Abrir en Tienda Nube"
      >
        {v}
        <ExternalLink size={9} className="opacity-60" />
      </a>
    );
  }
  const s = String(v);

  // Pipeline de estados de orden: si la fila tiene payment + shipping, mostrar pipeline
  // (solo en la celda de payment; la celda de shipping queda con badge individual)
  if (PAYMENT_HINT.test(col) && row && columns) {
    const shippingVal = findColValue(columns, row, ["shipping", "shippingStatus", "envio", "shipping_status"]);
    const orderStatusVal = findColValue(columns, row, ["status", "estado", "order_status"]);
    const packedVal = findColValue(columns, row, ["empaquetada", "packed", "is_packed"]);
    const canalVal = findColValue(columns, row, ["canal", "shipping_channel", "canal_envio"]);
    if (shippingVal !== null) {
      return <OrderStatusPipeline payment={v} shipping={shippingVal} orderStatus={orderStatusVal} packed={packedVal} canal={String(canalVal ?? "")} compact />;
    }
    return <OrderStatusBadge kind="payment" value={v} />;
  }
  if (SHIPPING_HINT.test(col) && row && columns) {
    // Si la fila tambien tiene payment, la pipeline ya lo muestra: omitimos
    // por completo el texto para evitar redundancia visual.
    const paymentVal = findColValue(columns, row, ["payment", "paymentStatus", "pago", "payment_status"]);
    if (paymentVal !== null) {
      return null;
    }
    return <OrderStatusBadge kind="shipping" value={v} />;
  }

  // Canal de envio: pinta un badge coloreado con icono de carrier.
  if (SHIPPING_CHANNEL_HINT.test(col) && row && columns) {
    const metodoVal = findColValue(columns, row, ["metodo_envio", "shipping_method", "metodo"]);
    return <ShippingMethodBadge canal={s} metodo={metodoVal != null ? String(metodoVal) : null} />;
  }
  // Si solo viene metodo crudo (sin canal), igual mostrar badge clasificado heuristicamente.
  if (SHIPPING_METHOD_HINT.test(col) && row && columns) {
    const canalVal = findColValue(columns, row, ["canal", "canal_envio", "shipping_channel"]);
    if (canalVal != null) return null; // ya se renderizo en la columna canal
    return <ShippingMethodBadge canal={s} metodo={s} />;
  }
  if (STATUS_HINT.test(col) && row && columns) {
    const paymentVal = findColValue(columns, row, ["payment", "paymentStatus", "pago", "payment_status"]);
    if (paymentVal !== null) {
      // Status ya esta cubierto por la pipeline
      return <span className="text-text-muted/60 text-[9px] uppercase">{s}</span>;
    }
    return <OrderStatusBadge kind="status" value={v} />;
  }

  // Cliente: linkear al perfil si tenemos customer_id en la fila, sino busqueda por nombre
  if (CUSTOMER_NAME_HINT.test(col)) {
    // En filas Unidrop el "cliente" es un Dropshipper (User.id) - linkear a su
    // vista 360 propia, NO a la de Customer Unistore.
    if (isUnidropRow) {
      const userId = findColValue(columns!, row!, ["id", "user_id", "userId"]);
      if (userId) {
        return (
          <Link
            href={`/dashboard/dropshipper/${encodeURIComponent(String(userId))}`}
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            onClick={(e) => e.stopPropagation()}
            title="Abrir vista 360 dropshipper Unidrop"
          >
            <User size={10} className="opacity-60" />
            {s}
          </Link>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-text" title="Dropshipper Unidrop">
          <User size={10} className="opacity-60" />
          {s}
        </span>
      );
    }
    let customerId: unknown = null;
    if (row && columns) {
      customerId = findColValue(columns, row, ["customer_id", "customerId", "cliente_id", "id_cliente"]);
    }
    const href = customerId
      ? `/dashboard/customer/${encodeURIComponent(String(customerId))}`
      : `/dashboard/customer?q=${encodeURIComponent(s)}`;
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
        onClick={(e) => e.stopPropagation()}
        title={customerId ? "Abrir perfil del cliente" : "Buscar cliente"}
      >
        <User size={10} className="opacity-60" />
        {s}
      </Link>
    );
  }

  // Provincia: linkear al mapa con esa provincia seleccionada
  if (PROVINCE_HINT.test(col)) {
    return (
      <Link
        href={`/dashboard/mapa?province=${encodeURIComponent(s)}`}
        className="inline-flex items-center gap-1 text-text hover:text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
        title="Ver detalle en el mapa"
      >
        <MapPin size={10} className="opacity-50" />
        {s}
      </Link>
    );
  }

  // SKU: linkear al detalle del producto
  if (SKU_HINT.test(col) && s.length <= 40) {
    return (
      <Link
        href={`/dashboard/productos/${encodeURIComponent(s)}`}
        className="text-primary hover:underline font-mono"
        onClick={(e) => e.stopPropagation()}
        title="Ver detalle del SKU"
      >
        {s}
      </Link>
    );
  }

  // Lote -> /dashboard/lotes con filtro
  if (LOTE_HINT.test(col)) {
    return (
      <Link
        href={`/dashboard/lotes?lote=${encodeURIComponent(s)}`}
        className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
        onClick={(e) => e.stopPropagation()}
        title="Ver detalle del lote"
      >
        <Boxes size={10} className="opacity-60" />
        {s}
      </Link>
    );
  }

  // Categoria -> filtro en productos
  if (CATEGORIA_HINT.test(col) && s.length <= 60) {
    return (
      <Link
        href={`/dashboard/productos?categoria=${encodeURIComponent(s)}`}
        className="inline-flex items-center gap-1 text-text hover:text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
        title="Ver productos de esta categoria"
      >
        <Tag size={10} className="opacity-50" />
        {s}
      </Link>
    );
  }

  // Marca -> filtro en productos
  if (MARCA_HINT.test(col) && s.length <= 60) {
    return (
      <Link
        href={`/dashboard/productos?marca=${encodeURIComponent(s)}`}
        className="text-text hover:text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
        title="Ver productos de esta marca"
      >
        {s}
      </Link>
    );
  }

  // Proveedor -> filtro en lotes
  if (PROVEEDOR_HINT.test(col) && s.length <= 60) {
    return (
      <Link
        href={`/dashboard/lotes?proveedor=${encodeURIComponent(s)}`}
        className="inline-flex items-center gap-1 text-text hover:text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
        title="Ver lotes de este proveedor"
      >
        <Building size={10} className="opacity-50" />
        {s}
      </Link>
    );
  }

  // Ciudad -> mapa con filtro
  if (CIUDAD_HINT.test(col) && s.length <= 60) {
    return (
      <Link
        href={`/dashboard/mapa?ciudad=${encodeURIComponent(s)}`}
        className="inline-flex items-center gap-1 text-text hover:text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
        title="Ver detalle en el mapa"
      >
        <MapPin size={10} className="opacity-50" />
        {s}
      </Link>
    );
  }

  // Nombre de producto: si la fila tiene un sku asociado, linkear al detalle
  if (PRODUCT_NAME_HINT.test(col) && row && columns) {
    const skuVal = findColValue(columns, row, ["sku", "sku2", "seller_sku", "codigo", "articulo"]);
    if (skuVal) {
      return (
        <Link
          href={`/dashboard/productos/${encodeURIComponent(String(skuVal))}`}
          className="inline-flex items-center gap-1 text-text hover:text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
          title="Ver detalle del producto"
        >
          <Package size={10} className="opacity-50" />
          {s.length > 60 ? s.slice(0, 57) + "..." : s}
        </Link>
      );
    }
  }

  // Phone -> WhatsApp link
  if (PHONE_HINT.test(col)) {
    const wa = waNumber(s);
    if (!wa) return <>—</>;
    return (
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
        title="Abrir en WhatsApp"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{s}</span>
      </a>
    );
  }
  // Email -> mailto
  if (EMAIL_HINT.test(col) && s.includes("@")) {
    return (
      <a
        href={`mailto:${s}`}
        className="text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {s}
      </a>
    );
  }
  const display = s.length > 80 ? s.slice(0, 77) + "..." : s;
  return <>{display}</>;
}

function formatCell(col: string, v: unknown): string {
  // legacy plain-string for places that need a string
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return formatCurrency(v);
    if (NUMBER_HINT.test(col)) return formatNumber(v);
    return String(v);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    try { return fmtArDateTime(v); } catch { return v; }
  }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [columns.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Excel xlsx descargado: genera tabla HTML que Excel parsea como .xlsx.
 * Mantiene estilos basicos (header violeta) sin requerir libreria xlsx. */
function downloadXlsx(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"></head>
    <body>
      <table border="1">
        <thead>
          <tr style="background:#7a3eae;color:white;font-weight:bold">
            ${columns.map((c) => `<th>${escape(c)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </body></html>`;
  const blob = new Blob(["﻿" + html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/\.csv$/, "") + ".xls";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Copia al clipboard un link compartible que abre el drilldown en el explorer. */
async function copyShareLink(endpoint: string, title: string, subtitle: string, filename: string) {
  const params = new URLSearchParams({ endpoint, title, subtitle, filename });
  const url = `${window.location.origin}/dashboard/explore?${params.toString()}`;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function DrillDownModal({
  title,
  subtitle,
  endpoint,
  filename = "drilldown.csv",
  onClose,
}: {
  title: string;
  subtitle?: string;
  endpoint: string | null;
  filename?: string;
  onClose: () => void;
}) {
  // Cierre con ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error } = useQuery<Result>({
    queryKey: ["drilldown", endpoint],
    queryFn: () => api(endpoint ?? "/"),
    enabled: !!endpoint,
    staleTime: 60_000,
  });

  // Sort por columna (click en el header). Indice de columna (data.columns) +
  // direccion. Se resetea cuando cambia el endpoint para no mantener un sort
  // que apunta a otra grilla.
  const [sortBy, setSortBy] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  useEffect(() => {
    setSortBy(null);
    setSortDir("desc");
  }, [endpoint]);

  const toggleSort = (idx: number) => {
    if (sortBy === idx) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(idx);
      setSortDir("desc");
    }
  };

  // Filas ordenadas. Si no hay sort, devuelve las originales sin tocar.
  const sortedRows = useMemo(() => {
    if (!data || sortBy === null) return data?.rows ?? [];
    const arr = [...data.rows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      const aNull = va === null || va === undefined || va === "";
      const bNull = vb === null || vb === undefined || vb === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      const na = Number(va);
      const nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof va !== "string" && typeof vb !== "string") {
        return (na - nb) * dir;
      }
      // Strings con numeros adentro -> comparacion natural
      return String(va).localeCompare(String(vb), "es", { numeric: true }) * dir;
    });
    return arr;
  }, [data, sortBy, sortDir]);

  if (!endpoint) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-border w-full max-w-5xl max-h-[92vh] sm:max-h-[85vh] flex flex-col"
      >
        <div className="flex items-start justify-between p-4 sm:p-5 border-b border-border gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm sm:text-base font-bold text-text truncate">{title}</div>
            {subtitle && <div className="text-[11px] sm:text-xs text-text-muted mt-1">{subtitle}</div>}
            {data && (
              <div className="text-xs text-text-muted mt-1 flex items-center gap-2 flex-wrap">
                <span>{formatNumber(data.row_count)} resultados</span>
                {data.row_count >= 200 && <span className="text-warn">(top 200)</span>}
                {(() => {
                  // Si la fila tiene columna 'tier', contar por tier
                  const tierIdx = data.columns.findIndex((c) => /^tier$/i.test(c));
                  if (tierIdx >= 0) {
                    const counts = { gold: 0, silver: 0, bronze: 0 };
                    for (const row of data.rows) {
                      const t = String(row[tierIdx] ?? "").toLowerCase();
                      if (t in counts) counts[t as keyof typeof counts]++;
                    }
                    const total = counts.gold + counts.silver + counts.bronze;
                    if (total === 0) return null;
                    return (
                      <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                        {counts.gold > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-100 to-amber-200 text-amber-900 border border-amber-300">
                            <span>👑</span> {counts.gold} Gold
                          </span>
                        )}
                        {counts.silver > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-slate-100 to-zinc-200 text-slate-800 border border-slate-300">
                            <span>💎</span> {counts.silver} Silver
                          </span>
                        )}
                        {counts.bronze > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-100 to-amber-100 text-amber-900 border border-amber-300">
                            <span>⭐</span> {counts.bronze} Bronze
                          </span>
                        )}
                      </span>
                    );
                  }
                  // Fallback: contar por monto >= 300k
                  const totalIdx = data.columns.findIndex((c) => /^(total|amount|revenue|gmv|monto|cobrado|lifetime|facturacion(_total)?)$/i.test(c));
                  if (totalIdx < 0) return null;
                  const vips = data.rows.filter((r) => Number(r[totalIdx]) >= 300000);
                  if (vips.length === 0) return null;
                  const vipsTotal = vips.reduce((s, r) => s + (Number(r[totalIdx]) || 0), 0);
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 border border-amber-200 text-[10px] font-bold uppercase tracking-wider">
                      <span className="text-[9px]">★</span>
                      {vips.length} VIP · {formatCurrency(vipsTotal)}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                const params = new URLSearchParams({
                  endpoint: endpoint!,
                  title,
                  subtitle: subtitle ?? "",
                  filename,
                });
                window.open(`/dashboard/explore?${params.toString()}`, "_blank", "noopener");
              }}
              className="inline-flex items-center gap-1 text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
              title="Abrir analisis completo en pestana nueva"
            >
              <ExternalLink size={12} /> <span className="hidden sm:inline">Abrir</span>
            </button>
            {data && data.rows.length > 0 && (
              <>
                <button
                  onClick={() => downloadXlsx(filename, data.columns, data.rows)}
                  className="inline-flex items-center gap-1 text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition font-semibold"
                  title="Descargar como Excel (xls)"
                >
                  <Download size={12} /> <span className="hidden sm:inline">Excel</span>
                </button>
                <button
                  onClick={() => downloadCsv(filename, data.columns, data.rows)}
                  className="inline-flex items-center gap-1 text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
                  title="Descargar como CSV"
                >
                  <Download size={12} /> <span className="hidden sm:inline">CSV</span>
                </button>
                <button
                  onClick={async () => {
                    const ok = await copyShareLink(endpoint!, title, subtitle ?? "", filename);
                    alert(ok ? "Link copiado al portapapeles" : "No pude copiar - tu navegador bloqueo el clipboard");
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
                  title="Copiar link para compartir esta vista con el equipo"
                >
                  <Share2 size={12} /> <span className="hidden lg:inline">Compartir</span>
                </button>
              </>
            )}
            <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-1">
          {isLoading && (
            <div className="p-8 text-center text-text-muted text-sm">Cargando detalle...</div>
          )}
          {error && (
            <div className="m-4 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm">
              {(error as Error).message}
            </div>
          )}
          {data && data.rows.length === 0 && !isLoading && (
            <div className="p-12 text-center text-text-muted text-sm">
              Sin resultados para esta seleccion en el periodo actual.
            </div>
          )}
          {data?.summary && (
            <div className="mx-2 my-2 rounded-xl border border-border bg-gradient-to-br from-violet-50 via-surface to-amber-50/40 p-3 sm:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Ingreso total</div>
                  <div className="text-base font-bold text-text">{formatCurrency(data.summary.total_ingreso ?? 0)}</div>
                  <div className="text-[10px] text-text-muted">
                    {data.summary.total_orders ?? 0} órdenes
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Ganancia neta</div>
                  <div className="text-base font-bold text-emerald-700">{formatCurrency(data.summary.total_ganancia_neta ?? 0)}</div>
                  <div className="text-[10px] text-text-muted">
                    margen {(data.summary.margen_pct ?? 0).toFixed(1)}% · cobertura costo {(data.summary.cost_coverage_pct ?? 0).toFixed(0)}%
                  </div>
                </div>
                <div className="border-l border-amber-200 pl-3">
                  <div className="text-[10px] uppercase tracking-wider text-amber-900">💵 Efectivo a esperar</div>
                  <div className="text-base font-bold text-amber-900">{formatCurrency(data.summary.cash_pendiente_total ?? 0)}</div>
                  <div className="text-[10px] text-text-muted">
                    ya cobrado: {formatCurrency(data.summary.cash_cobrado_total ?? 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-violet-700">🟣 Online (gateways)</div>
                  <div className="text-base font-bold text-violet-700">{formatCurrency(data.summary.online_total ?? 0)}</div>
                  <div className="text-[10px] text-text-muted">
                    fee gateway: {formatCurrency(data.summary.breakdown?.gateway_fee ?? 0)}
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-border/60 text-[10px] text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>− costo c/IVA: <strong className="text-text">{formatCurrency(data.summary.breakdown?.costo_con_iva ?? 0)}</strong></span>
                <span>− IVA neto (vs crédito): <strong className="text-text">{formatCurrency(data.summary.breakdown?.iva_neto_a_pagar ?? 0)}</strong></span>
                <span>− IIBB 5%: <strong className="text-text">{formatCurrency(data.summary.breakdown?.iibb ?? 0)}</strong></span>
                <span>− Fee gateway 0.5%: <strong className="text-text">{formatCurrency(data.summary.breakdown?.gateway_fee ?? 0)}</strong></span>
                {(data.summary.orders_sin_costo ?? 0) > 0 && (
                  <span className="text-warn">⚠ {data.summary.orders_sin_costo} órdenes sin costo cargado (no contadas en ganancia)</span>
                )}
              </div>
            </div>
          )}
          {data && data.rows.length > 0 && (() => {
            // Detectar columnas redundantes que se ocultan globalmente:
            //  - shipping si hay payment (pipeline cubre ambos)
            //  - metodo_envio si hay canal (badge ya lo cubre)
            //  - status si hay payment (pipeline cubre)
            const hasPayment = data.columns.some((c) => /^(payment|paymentStatus|pago|payment_status)$/i.test(c));
            const hasCanal = data.columns.some((c) => /^(canal|canal_envio|shipping_channel)$/i.test(c));
            const hasNumero = data.columns.some((c) => /^(numero|order_number|order_numero)$/i.test(c));
            const hasMetodoPagoTipo = data.columns.some((c) => METODO_PAGO_TIPO_HINT.test(c));
            const isHiddenColumn = (c: string) => {
              if (/^(customer_id|customerId|cliente_id|id_cliente)$/i.test(c)) return true;
              if (/^(empaquetada|packed|is_packed)$/i.test(c)) return true;
              if (hasNumero && /^(id)$/i.test(c)) return true;
              if (hasPayment && /^(shipping|shippingstatus|envio|shipping_status|estado_envio)$/i.test(c)) return true;
              if (hasPayment && /^(status|estado|order_status)$/i.test(c)) return true;
              if (hasCanal && /^(metodo_envio|shipping_method|metodo|envio_metodo)$/i.test(c)) return true;
              // metodo_pago (texto descriptivo del gateway) se expone en tooltip del badge metodo_pago_tipo
              if (hasMetodoPagoTipo && /^(metodo_pago|gateway_name|gatewayName)$/i.test(c)) return true;
              // Columnas tecnicas del engine de ganancia (se exponen via tooltip / badge)
              if (/^(profit|gateway_id)$/i.test(c)) return true;
              return false;
            };
            const labelFor = (c: string) => {
              if (/^(payment|paymentStatus|pago|payment_status)$/i.test(c)) return "Estado del pedido";
              if (/^(canal|canal_envio|shipping_channel)$/i.test(c)) return "Envio";
              return c;
            };
            return (
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  {data.columns.map((c, idx) => {
                    if (isHiddenColumn(c)) return null;
                    const active = sortBy === idx;
                    return (
                      <th key={c} className="text-left px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => toggleSort(idx)}
                          className={
                            "inline-flex items-center gap-1 transition " +
                            (active ? "text-primary" : "hover:text-text")
                          }
                          title={`Ordenar por ${labelFor(c)}`}
                        >
                          {labelFor(c)}
                          {active
                            ? (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
                            : <ArrowUpDown size={9} className="opacity-30" />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => {
                  // Si la fila tiene columna 'tier' (drilldown VIP), usar ese.
                  // Sino fallback a la heuristica VIP por monto >= 300k.
                  const tierIdx = data.columns.findIndex((c) => /^tier$/i.test(c));
                  const tierVal = tierIdx >= 0 ? String(r[tierIdx] ?? "").toLowerCase() : "";
                  const totalIdx = data.columns.findIndex((c) => /^(total|amount|revenue|gmv|monto|cobrado|lifetime|facturacion(_total)?)$/i.test(c));
                  const totalVal = totalIdx >= 0 ? Number(r[totalIdx]) : NaN;
                  const isVip = !!tierVal || (!Number.isNaN(totalVal) && totalVal >= 300000);

                  // Highlight efectivo pendiente (paymentStatus=pending + gateway=offline)
                  const tipoIdx = data.columns.findIndex((c) => METODO_PAGO_TIPO_HINT.test(c));
                  const paymentIdx = data.columns.findIndex((c) => /^(payment|paymentStatus|pago|payment_status)$/i.test(c));
                  const tipoVal = tipoIdx >= 0 ? String(r[tipoIdx] ?? "").toLowerCase() : "";
                  const paymentVal = paymentIdx >= 0 ? String(r[paymentIdx] ?? "").toLowerCase() : "";
                  const isCashPending = tipoVal === "efectivo" && paymentVal === "pending";

                  // Visual por tier (gold > silver > bronze) con fallback amber para "compra alta"
                  const vipVisual = (() => {
                    if (tierVal === "gold")   return { icon: "👑", bg: "from-yellow-400 to-amber-500", row: "from-yellow-50 via-amber-50 to-transparent border-amber-300", label: "VIP Gold" };
                    if (tierVal === "silver") return { icon: "💎", bg: "from-slate-400 to-zinc-500",   row: "from-slate-50 via-zinc-50 to-transparent border-slate-300", label: "VIP Silver" };
                    if (tierVal === "bronze") return { icon: "⭐", bg: "from-orange-400 to-amber-500", row: "from-orange-50 via-amber-50 to-transparent border-amber-300", label: "VIP Bronze" };
                    // Fallback: solo "compra alta"
                    return { icon: "★", bg: "from-amber-400 to-orange-500", row: "from-amber-50/80 via-amber-50/40 to-transparent border-amber-200", label: `Compra alta: ${formatCurrency(totalVal)}` };
                  })();

                  const rowClassName = isCashPending
                    ? "border-t border-amber-300 bg-amber-50/60 hover:bg-amber-100/60 transition relative"
                    : isVip
                      ? `border-t bg-gradient-to-r ${vipVisual.row} hover:brightness-95 transition relative`
                      : "border-t border-border hover:bg-soft transition";
                  const rowTitle = isCashPending
                    ? "Efectivo pendiente · esperar cobro presencial"
                    : isVip ? vipVisual.label : undefined;
                  return (
                    <tr
                      key={i}
                      className={rowClassName}
                      title={rowTitle}
                    >
                      {r.map((v, j) => {
                        const col = data.columns[j];
                        if (isHiddenColumn(col)) return null;
                        const isFirstVisible = j === 0;
                        return (
                          <td key={j} className="px-3 py-1.5 whitespace-nowrap font-mono text-[11px]">
                            <div className="inline-flex items-center gap-1.5">
                              {isFirstVisible && isVip && (
                                <span
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br ${vipVisual.bg} text-white shadow-sm flex-shrink-0`}
                                  title={vipVisual.label}
                                >
                                  <span className="text-[10px]">{vipVisual.icon}</span>
                                </span>
                              )}
                              <span>
                                <CellRenderer col={col} v={v} row={r} columns={data.columns} />
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            );
          })()}
        </div>

        <div className="px-5 py-3 border-t border-border bg-soft text-xs text-text-muted flex items-center gap-2">
          <ExternalLink size={11} className="text-primary" />
          <span>Click ESC o fuera del modal para cerrar</span>
        </div>
      </div>
    </div>
  );
}
