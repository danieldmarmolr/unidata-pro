"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { X, Download, ExternalLink, User, MapPin, Package, Boxes, Truck, Tag, Building } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime, tnAdminUrl, looksLikeTnOrderId } from "@/lib/dates";
import { OrderStatusPipeline, OrderStatusBadge, ShippingMethodBadge } from "@/components/order-status-pipeline";

type Result = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
};

const CURRENCY_HINT = /total|amount|subtotal|revenue|commission|costo|precio|gmv|cobrado|monto/i;
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
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return <>{formatCurrency(v)}</>;
    if (NUMBER_HINT.test(col)) return <>{formatNumber(v)}</>;
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
  // Order id como string
  if (typeof v === "string" && looksLikeTnOrderId(col, v)) {
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
    if (shippingVal !== null) {
      return <OrderStatusPipeline payment={v} shipping={shippingVal} orderStatus={orderStatusVal} compact />;
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
    try { return new Date(v).toLocaleString("es-AR"); } catch { return v; }
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
                  const totalIdx = data.columns.findIndex((c) => /^(total|amount|revenue|gmv|monto|cobrado)$/i.test(c));
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
              <button
                onClick={() => downloadCsv(filename, data.columns, data.rows)}
                className="inline-flex items-center gap-1 text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
              >
                <Download size={12} /> <span className="hidden sm:inline">CSV</span>
              </button>
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
          {data && data.rows.length > 0 && (() => {
            // Detectar columnas redundantes que se ocultan globalmente:
            //  - shipping si hay payment (pipeline cubre ambos)
            //  - metodo_envio si hay canal (badge ya lo cubre)
            //  - status si hay payment (pipeline cubre)
            const hasPayment = data.columns.some((c) => /^(payment|paymentStatus|pago|payment_status)$/i.test(c));
            const hasCanal = data.columns.some((c) => /^(canal|canal_envio|shipping_channel)$/i.test(c));
            const isHiddenColumn = (c: string) => {
              if (/^(customer_id|customerId|cliente_id|id_cliente)$/i.test(c)) return true;
              if (hasPayment && /^(shipping|shippingstatus|envio|shipping_status|estado_envio)$/i.test(c)) return true;
              if (hasPayment && /^(status|estado|order_status)$/i.test(c)) return true;
              if (hasCanal && /^(metodo_envio|shipping_method|metodo|envio_metodo)$/i.test(c)) return true;
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
                  {data.columns.map((c) => {
                    if (isHiddenColumn(c)) return null;
                    return <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{labelFor(c)}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  // Detectar fila VIP: total > $300.000 (umbral de "Cliente VIP")
                  const totalIdx = data.columns.findIndex((c) => /^(total|amount|revenue|gmv|monto|cobrado)$/i.test(c));
                  const totalVal = totalIdx >= 0 ? Number(r[totalIdx]) : NaN;
                  const isVip = !Number.isNaN(totalVal) && totalVal >= 300000;

                  return (
                    <tr
                      key={i}
                      className={
                        isVip
                          ? "border-t border-amber-200 bg-gradient-to-r from-amber-50/80 via-amber-50/40 to-transparent hover:from-amber-100/80 hover:via-amber-50/60 transition relative"
                          : "border-t border-border hover:bg-soft transition"
                      }
                      title={isVip ? `Compra alta: ${formatCurrency(totalVal)} (VIP)` : undefined}
                    >
                      {r.map((v, j) => {
                        const col = data.columns[j];
                        if (isHiddenColumn(col)) return null;
                        // En la primera celda visible mostrar un badge VIP
                        const isFirstVisible = j === 0;
                        return (
                          <td key={j} className="px-3 py-1.5 whitespace-nowrap font-mono text-[11px]">
                            <div className="inline-flex items-center gap-1.5">
                              {isFirstVisible && isVip && (
                                <span
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm shadow-amber-500/30 flex-shrink-0"
                                  title={`Compra VIP: ${formatCurrency(totalVal)}`}
                                >
                                  <span className="text-[8px] font-extrabold">★</span>
                                </span>
                              )}
                              <span className={isFirstVisible && isVip ? "" : ""}>
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
