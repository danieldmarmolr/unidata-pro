"use client";

import { Package, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Lote = {
  lote: string | null;
  proveedor: string | null;
  fecha_ingreso: string | null;
  imported_at: string | null;
  cantidad: number | null;
  costo_unit_usd: number | null;
  costo_unit_ars: number | null;
  costo_con_iva_unit_ars: number | null;
  precio_ars: number | null;
  rentabilidad_ars: number | null;
  pct_rentabilidad: number | null;
  categoria?: string | null;
  ncm?: string | null;
};

type Props = {
  lotes: Lote[];
  loteVigente: string | null;
};

function pctDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[10px] text-text-muted">—</span>;
  if (Math.abs(delta) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted">
        <Minus size={10} /> ={" "}
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] ${
        positive ? "text-rose-700" : "text-emerald-700"
      }`}
      title={positive ? "Costo aumentó respecto al lote previo" : "Costo bajó respecto al lote previo"}
    >
      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {positive ? "+" : ""}
      {delta.toFixed(1)}%
    </span>
  );
}

export function SkuLotesTimeline({ lotes, loteVigente }: Props) {
  if (!lotes || lotes.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Package size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Historial de lotes</h3>
            <p className="text-[11px] text-text-muted">Sin lotes cargados para este SKU</p>
          </div>
        </div>
      </div>
    );
  }

  // lotes vienen DESC por imported_at. Para calcular delta vs previo necesitamos
  // comparar lote N con lote N+1 (mas viejo).
  const totalUnits = lotes.reduce((acc, l) => acc + (l.cantidad || 0), 0);

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Package size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Historial de lotes · {lotes.length}</h3>
            <p className="text-[11px] text-text-muted">
              Total importado: <strong className="text-text">{formatNumber(totalUnits)} u</strong> · click un lote para
              ver el detalle
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-text-muted">
            <tr className="border-b border-border">
              <th className="py-2 px-2">Lote</th>
              <th className="py-2 px-2">Proveedor</th>
              <th className="py-2 px-2">Fecha</th>
              <th className="py-2 px-2 text-right">Cantidad</th>
              <th className="py-2 px-2 text-right">Costo USD</th>
              <th className="py-2 px-2 text-right">Costo ARS s/IVA</th>
              <th className="py-2 px-2 text-right">Costo c/IVA</th>
              <th className="py-2 px-2 text-right">Δ vs anterior</th>
              <th className="py-2 px-2 text-right">Precio sug.</th>
              <th className="py-2 px-2 text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l, i) => {
              const prev = lotes[i + 1];
              const deltaUsd = pctDelta(l.costo_unit_usd, prev?.costo_unit_usd ?? null);
              const isVigente = loteVigente && l.lote === loteVigente;
              return (
                <tr
                  key={`${l.lote}-${i}`}
                  className={`border-b border-border/60 ${isVigente ? "bg-primary/5" : "hover:bg-soft/40"}`}
                >
                  <td className="py-2 px-2">
                    <div className="font-mono font-semibold text-text">{l.lote || "—"}</div>
                    {isVigente && (
                      <span className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        vigente
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-text-muted">{l.proveedor || "—"}</td>
                  <td className="py-2 px-2 text-text-muted whitespace-nowrap">
                    {l.fecha_ingreso ? l.fecha_ingreso.slice(0, 10) : l.imported_at?.slice(0, 10) || "—"}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {l.cantidad ? formatNumber(l.cantidad) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {l.costo_unit_usd !== null ? `US$ ${l.costo_unit_usd.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {l.costo_unit_ars !== null ? formatCurrency(l.costo_unit_ars) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {l.costo_con_iva_unit_ars !== null ? formatCurrency(l.costo_con_iva_unit_ars) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <TrendBadge delta={deltaUsd} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {l.precio_ars !== null ? formatCurrency(l.precio_ars) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {l.pct_rentabilidad !== null ? (
                      <span
                        className={`tabular-nums font-bold ${
                          l.pct_rentabilidad >= 30
                            ? "text-emerald-700"
                            : l.pct_rentabilidad >= 15
                              ? "text-amber-700"
                              : "text-rose-700"
                        }`}
                      >
                        {l.pct_rentabilidad.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-text-muted">
        Δ vs anterior compara <strong>costo USD</strong> del lote vs lote previo. Rojo = aumento, verde = baja.
        Útil para detectar saltos de costo del proveedor.
      </div>
    </div>
  );
}
