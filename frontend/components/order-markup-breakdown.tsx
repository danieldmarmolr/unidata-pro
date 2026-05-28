"use client";

/**
 * Desglose de markup por SKU + totales financieros del pedido.
 * Se monta como sub-row expandible debajo de una fila de DrillDownModal en
 * /dashboard/ventas. El endpoint /api/drilldowns/orders/{id}/markup-breakdown
 * detecta TN o ML Fox por el prefijo del id ('ML-' o numerico).
 *
 * El render esta pensado para que se entienda de un vistazo cuanto deja
 * cada SKU y cuanto deja el pedido completo (markup bruto + ganancia neta
 * despues de IVA/IIBB/fee gateway).
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

type ItemRow = {
  sku: string;
  name: string;
  qty: number;
  price_unit: number;
  subtotal: number;
  costo_unit: number | null;
  costo_total: number | null;
  ganancia_bruta: number | null;
  markup_pct: number | null;
  has_cost: boolean;
  lote: string | null;
};

type Summary = {
  revenue: number;
  revenue_items: number;
  costo_total: number | null;
  costo_sin_iva: number | null;
  ganancia_bruta: number | null;
  markup_pct_total: number | null;
  iva_neto: number;
  iibb: number;
  gateway_fee: number;
  gateway_fee_rate: number;
  ganancia_neta: number | null;
  margen_pct: number | null;
  cobertura_pct: number;
  skus_sin_costo: number;
  total_items: number;
  is_cash: boolean;
  is_digital: boolean;
  gateway_id: string | null;
  gateway_name: string;
  origen: "tn" | "ml";
};

type Response = {
  items: ItemRow[];
  summary: Summary;
  error: string | null;
};

function fmtPct(v: number | null | undefined, opts?: { signed?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = opts?.signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function markupTone(pct: number | null | undefined): "ok" | "low" | "neg" | "muted" {
  if (pct === null || pct === undefined) return "muted";
  if (pct < 0) return "neg";
  if (pct < 15) return "low";
  return "ok";
}

export function OrderMarkupBreakdown({ orderId }: { orderId: string }) {
  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ["order-markup-breakdown", orderId],
    queryFn: () => api<Response>(`/api/drilldowns/orders/${encodeURIComponent(orderId)}/markup-breakdown`),
    staleTime: 5 * 60_000,
    enabled: !!orderId,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-3 bg-gradient-to-b from-soft/60 to-transparent">
        <div className="h-32 animate-pulse bg-surface/60 rounded-lg" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-error bg-rose-50 border-t border-rose-200">
        Error cargando detalle: {(error as Error).message}
      </div>
    );
  }
  if (!data || data.error || !data.items || data.items.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-text-muted bg-soft/40 italic border-t border-border">
        {data?.error === "order_not_found"
          ? "No pude encontrar el pedido en la base."
          : "Esta orden no tiene items con SKU cargado."}
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="px-3 sm:px-4 py-3 bg-gradient-to-b from-soft/50 to-transparent border-t border-border">
      {/* Tabla de SKUs */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-soft/80 text-text-muted text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold">SKU</th>
              <th className="text-right px-2 py-1.5 font-semibold">Cant</th>
              <th className="text-right px-2 py-1.5 font-semibold">Precio U</th>
              <th className="text-right px-2 py-1.5 font-semibold">Subtotal</th>
              <th className="text-right px-2 py-1.5 font-semibold">Costo U</th>
              <th className="text-right px-2 py-1.5 font-semibold">Costo total</th>
              <th className="text-right px-2 py-1.5 font-semibold">Markup $</th>
              <th className="text-right px-2 py-1.5 font-semibold">Markup %</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {data.items.map((it, i) => {
              const tone = markupTone(it.markup_pct);
              return (
                <tr key={`${it.sku}-${i}`} className="border-t border-border hover:bg-soft/50 transition">
                  <td className="px-2 py-1.5 align-top">
                    <Link
                      href={`/dashboard/productos/${encodeURIComponent(it.sku)}`}
                      className="text-primary hover:underline font-semibold"
                    >
                      {it.sku}
                    </Link>
                    {it.name && it.name !== it.sku && (
                      <div className="text-[9px] text-text-muted leading-tight max-w-[200px] truncate" title={it.name}>
                        {it.name}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(it.price_unit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(it.subtotal)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                    {it.costo_unit !== null ? formatCurrency(it.costo_unit) : <span className="text-warn">sin costo</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                    {it.costo_total !== null ? formatCurrency(it.costo_total) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums font-bold",
                      tone === "ok" && "text-emerald-700",
                      tone === "low" && "text-amber-700",
                      tone === "neg" && "text-error",
                      tone === "muted" && "text-text-muted",
                    )}
                  >
                    {it.ganancia_bruta !== null ? formatCurrency(it.ganancia_bruta) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums font-bold",
                      tone === "ok" && "text-emerald-700",
                      tone === "low" && "text-amber-700",
                      tone === "neg" && "text-error",
                      tone === "muted" && "text-text-muted",
                    )}
                  >
                    {it.markup_pct !== null ? fmtPct(it.markup_pct) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Resumen del pedido — totales + indicadores financieros */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mt-3">
        <div className="bg-surface border border-border rounded-lg p-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Ingreso pedido</div>
          <div className="text-sm font-extrabold text-text tabular-nums">{formatCurrency(s.revenue)}</div>
          <div className="text-[9px] text-text-muted">{s.total_items} items</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Costo total</div>
          <div className="text-sm font-bold text-text-muted tabular-nums">
            {s.costo_total !== null ? formatCurrency(s.costo_total) : "—"}
          </div>
          <div className="text-[9px] text-text-muted">con IVA del lote</div>
        </div>
        <div
          className={cn(
            "bg-surface border rounded-lg p-2",
            (s.ganancia_bruta ?? 0) >= 0 ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40",
          )}
        >
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-1">
            {(s.ganancia_bruta ?? 0) >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            Markup $
          </div>
          <div
            className={cn(
              "text-sm font-extrabold tabular-nums",
              (s.ganancia_bruta ?? 0) >= 0 ? "text-emerald-700" : "text-error",
            )}
          >
            {s.ganancia_bruta !== null ? formatCurrency(s.ganancia_bruta) : "—"}
          </div>
          <div className="text-[9px] text-text-muted">bruto (sin AFIP)</div>
        </div>
        <div
          className={cn(
            "bg-surface border rounded-lg p-2",
            (s.markup_pct_total ?? 0) >= 15
              ? "border-emerald-200 bg-emerald-50/40"
              : (s.markup_pct_total ?? 0) >= 0
                ? "border-amber-200 bg-amber-50/40"
                : "border-rose-200 bg-rose-50/40",
          )}
        >
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Markup %</div>
          <div
            className={cn(
              "text-sm font-extrabold tabular-nums",
              (s.markup_pct_total ?? 0) >= 15
                ? "text-emerald-700"
                : (s.markup_pct_total ?? 0) >= 0
                  ? "text-amber-700"
                  : "text-error",
            )}
          >
            {fmtPct(s.markup_pct_total)}
          </div>
          <div className="text-[9px] text-text-muted">sobre costo total</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Cobertura</div>
          <div
            className={cn(
              "text-sm font-bold tabular-nums",
              s.cobertura_pct >= 100
                ? "text-emerald-700"
                : s.cobertura_pct >= 50
                  ? "text-amber-700"
                  : "text-error",
            )}
          >
            {s.cobertura_pct.toFixed(0)}%
          </div>
          <div className="text-[9px] text-text-muted">
            {s.skus_sin_costo > 0 ? `${s.skus_sin_costo} sin costo` : "todos cargados"}
          </div>
        </div>
        <div
          className={cn(
            "bg-surface border rounded-lg p-2",
            (s.ganancia_neta ?? 0) >= 0 ? "border-violet-200 bg-violet-50/40" : "border-rose-200 bg-rose-50/40",
          )}
        >
          <div className="text-[9px] uppercase tracking-wider text-violet-700 font-bold">Ganancia neta</div>
          <div
            className={cn(
              "text-sm font-extrabold tabular-nums",
              (s.ganancia_neta ?? 0) >= 0 ? "text-violet-800" : "text-error",
            )}
          >
            {s.ganancia_neta !== null ? formatCurrency(s.ganancia_neta) : "—"}
          </div>
          <div className="text-[9px] text-text-muted">margen {fmtPct(s.margen_pct)}</div>
        </div>
      </div>

      {/* Cargas AFIP + gateway — desglose financiero del pedido */}
      <div className="mt-2 text-[10px] text-text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>
          − IVA neto: <strong className="text-text">{formatCurrency(s.iva_neto)}</strong>
        </span>
        <span>
          − IIBB 5%: <strong className="text-text">{formatCurrency(s.iibb)}</strong>
        </span>
        <span>
          − Fee gateway {(s.gateway_fee_rate * 100).toFixed(2)}%: <strong className="text-text">{formatCurrency(s.gateway_fee)}</strong>
        </span>
        {s.gateway_name && (
          <span className="text-text-muted/80">
            · gateway: <strong className="text-text">{s.gateway_name}</strong>
            {s.is_cash && <span className="ml-1 text-amber-700">(efectivo)</span>}
          </span>
        )}
      </div>

      {s.skus_sin_costo > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
          <AlertTriangle size={10} />
          <span>
            {s.skus_sin_costo} SKU{s.skus_sin_costo > 1 ? "s" : ""} sin costo cargado — el markup mostrado es parcial.{" "}
            <Link href="/dashboard/costos" className="underline font-semibold">
              Cargar lotes faltantes
            </Link>
          </span>
        </div>
      )}
    </div>
  );
}
