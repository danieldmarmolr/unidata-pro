"use client";

import type { TopProduct } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

export function TopProductsTable({ data }: { data: TopProduct[] }) {
  const maxRevenue = Math.max(0, ...data.map((d) => d.revenue));
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-text">Top 15 productos</div>
          <div className="text-xs text-text-muted mt-0.5">
            Por revenue (ordenes pagadas en el periodo)
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="pl-2 py-2 w-8">#</th>
              <th className="py-2">Producto</th>
              <th className="py-2 text-right">Unidades</th>
              <th className="py-2 text-right">Ordenes</th>
              <th className="py-2 text-right pr-2 min-w-[160px]">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p, i) => {
              const pct = maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0;
              return (
                <tr
                  key={`${p.product_id}-${i}`}
                  className="border-t border-border hover:bg-soft transition"
                >
                  <td className="pl-2 py-2.5 text-text-muted text-xs font-mono">{i + 1}</td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-text leading-tight max-w-[420px] truncate" title={p.name}>
                      {p.name}
                    </div>
                    {p.sku && <div className="text-[11px] text-text-muted mt-0.5">SKU {p.sku}</div>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-text">{formatNumber(p.units)}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-muted">{formatNumber(p.orders)}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums">
                    <div className="font-semibold text-text">{formatCurrency(p.revenue)}</div>
                    <div className="h-1 bg-soft rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-text-muted text-sm">
                  Sin datos en el periodo seleccionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
