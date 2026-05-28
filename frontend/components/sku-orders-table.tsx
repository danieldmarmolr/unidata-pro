"use client";

/**
 * Tabla "Órdenes con este SKU" en /dashboard/productos/[sku].
 *
 * Muestra para cada pedido:
 *  - número, fecha, cliente, provincia, estado del pedido (pipeline)
 *  - Cantidad del SKU en el pedido
 *  - Markup $ y Markup % del SKU (precio - costo unitario del lote, * qty)
 *  - % de influencia del SKU en el markup total del pedido
 *
 * Sirve para entender QUE pedidos dependen del markup de este SKU y cuanto
 * pesa en cada uno. Paginacion fija a 10 filas + "Ver mas" para no desbordar
 * la pagina cuando hay 100+ ordenes.
 */

import { useState } from "react";
import { Package } from "lucide-react";
import { ExportButtons } from "@/components/export-buttons";
import { ExpandableOrderRow, type OrderRowData } from "@/components/expandable-order-row";
import { cn, formatCurrency } from "@/lib/utils";

type Order = {
  id: number | null;
  numero: string;
  fecha: string;
  payment: string;
  shipping: string;
  status: string;
  total: number;
  qty: number;
  precio_unit: number;
  subtotal: number;
  provincia: string;
  cliente: string;
  customer_id: number | null;
  empaquetada: boolean;
  canal?: string;
  sku_has_cost?: boolean;
  costo_unit_sku?: number | null;
  costo_total_sku?: number | null;
  markup_sku_abs?: number | null;
  markup_sku_pct?: number | null;
  markup_total_pedido_abs?: number | null;
  pedido_cobertura_costos?: boolean;
  pedido_items_sin_costo?: number;
  pct_influencia_markup?: number | null;
};

const PAGE_SIZE = 10;

function markupTone(pct: number | null | undefined): "ok" | "low" | "neg" | "muted" {
  if (pct === null || pct === undefined) return "muted";
  if (pct < 0) return "neg";
  if (pct < 15) return "low";
  return "ok";
}

function influenceTone(pct: number | null | undefined): "high" | "mid" | "low" | "muted" {
  if (pct === null || pct === undefined) return "muted";
  if (pct >= 50) return "high";
  if (pct >= 20) return "mid";
  return "low";
}

export function SkuOrdersTable({
  sku,
  period,
  windowLabel,
  orders,
}: {
  sku: string;
  period?: string;
  windowLabel?: string;
  orders: Order[];
}) {
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? orders : orders.slice(0, PAGE_SIZE);

  // Totales agregados de markup del SKU en el periodo (para el header)
  let total_markup_sku = 0;
  let total_qty_sku = 0;
  let ordenes_con_costo = 0;
  for (const o of orders) {
    if (o.sku_has_cost && o.markup_sku_abs !== null && o.markup_sku_abs !== undefined) {
      total_markup_sku += o.markup_sku_abs;
      ordenes_con_costo += 1;
    }
    total_qty_sku += o.qty || 0;
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Package size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Órdenes con este SKU · {windowLabel || period || ""}</h3>
            <p className="text-[11px] text-text-muted">
              {orders.length} {orders.length === 1 ? "orden" : "órdenes"} TN · {total_qty_sku} unidades vendidas
              {ordenes_con_costo > 0 && (
                <>
                  {" · "}
                  Markup acumulado del SKU:{" "}
                  <strong className={cn(total_markup_sku >= 0 ? "text-emerald-700" : "text-error")}>
                    {formatCurrency(total_markup_sku)}
                  </strong>
                </>
              )}
              {" · click ▸ para ver los items completos"}
            </p>
          </div>
        </div>
        <ExportButtons
          filename={`ordenes_con_${sku}_${period || "30d"}`}
          columns={[
            "#", "Numero", "Fecha", "Cliente", "Provincia",
            "Qty", "Precio unit", "Subtotal SKU", "Costo unit",
            "Markup $ SKU", "Markup % SKU", "% influencia",
            "Total orden", "Markup total pedido",
            "Estado pago", "Estado envío",
          ]}
          rows={orders.map((o, i) => [
            i + 1, o.numero, o.fecha, o.cliente, o.provincia,
            o.qty, o.precio_unit, o.subtotal,
            o.costo_unit_sku ?? "",
            o.markup_sku_abs ?? "",
            o.markup_sku_pct ?? "",
            o.pct_influencia_markup ?? "",
            o.total, o.markup_total_pedido_abs ?? "",
            o.payment, o.shipping,
          ])}
        />
      </div>
      {orders.length === 0 ? (
        <div className="py-8 text-center text-text-muted text-sm">
          No hay órdenes con este SKU en el periodo seleccionado.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Número</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Estado del pedido</th>
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2 text-right">Markup $</th>
                  <th className="px-3 py-2 text-right">Markup %</th>
                  <th className="px-3 py-2 text-right" title="% que este SKU representa del markup total del pedido">
                    % infl.
                  </th>
                  <th className="px-3 py-2 text-right">Total orden</th>
                  <th className="px-3 py-2 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o, i) => {
                  if (!o.id) return null;
                  const tone = markupTone(o.markup_sku_pct);
                  const inf = influenceTone(o.pct_influencia_markup);
                  const subtitleParts: string[] = [];
                  if (o.cliente) subtitleParts.push(o.cliente);
                  if (o.provincia) subtitleParts.push(o.provincia);
                  subtitleParts.push(`${o.qty}x · ${formatCurrency(o.subtotal)} de este SKU`);
                  const orderRow: OrderRowData = {
                    id: o.id,
                    numero: o.numero,
                    fecha: o.fecha,
                    total: o.total,
                    payment: o.payment,
                    shipping: o.shipping,
                    status: o.status,
                    empaquetada: o.empaquetada,
                    canal: o.canal,
                    subtitle: subtitleParts.join(" · "),
                  };
                  return (
                    <ExpandableOrderRow
                      key={i}
                      order={orderRow}
                      idx={i + 1}
                      cols={10}
                      highlightSku={sku}
                      // Columnas extras inyectadas entre "Estado del pedido" y "Total orden"
                      extraCells={
                        <>
                          <td className="px-3 py-2 align-middle text-right tabular-nums">
                            {o.qty}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 align-middle text-right tabular-nums font-bold",
                              tone === "ok" && "text-emerald-700",
                              tone === "low" && "text-amber-700",
                              tone === "neg" && "text-error",
                              tone === "muted" && "text-text-muted",
                            )}
                          >
                            {o.markup_sku_abs !== null && o.markup_sku_abs !== undefined
                              ? formatCurrency(o.markup_sku_abs)
                              : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 align-middle text-right tabular-nums font-bold",
                              tone === "ok" && "text-emerald-700",
                              tone === "low" && "text-amber-700",
                              tone === "neg" && "text-error",
                              tone === "muted" && "text-text-muted",
                            )}
                          >
                            {o.markup_sku_pct !== null && o.markup_sku_pct !== undefined
                              ? `${o.markup_sku_pct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 align-middle text-right tabular-nums",
                              inf === "high" && "text-violet-800 font-bold",
                              inf === "mid" && "text-violet-700 font-semibold",
                              inf === "low" && "text-text-muted",
                              inf === "muted" && "text-text-muted",
                            )}
                            title={
                              o.pct_influencia_markup !== null && o.pct_influencia_markup !== undefined
                                ? `Este SKU aporta ${o.pct_influencia_markup.toFixed(1)}% del markup total del pedido (${o.markup_total_pedido_abs !== null ? formatCurrency(o.markup_total_pedido_abs!) : "?"})`
                                : "Sin datos suficientes para calcular influencia"
                            }
                          >
                            {o.pct_influencia_markup !== null && o.pct_influencia_markup !== undefined
                              ? `${o.pct_influencia_markup.toFixed(0)}%`
                              : "—"}
                            {(o.pedido_items_sin_costo ?? 0) > 0 && (
                              <span className="ml-1 text-[9px] text-amber-600" title={`${o.pedido_items_sin_costo} items del pedido sin costo cargado — influencia parcial`}>
                                ⚠
                              </span>
                            )}
                          </td>
                        </>
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          {orders.length > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-border bg-soft hover:border-primary hover:text-primary transition"
              >
                {showAll
                  ? `Mostrar solo ${PAGE_SIZE}`
                  : `Ver ${orders.length - PAGE_SIZE} órdenes más`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
