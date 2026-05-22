"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, ImageOff, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Step = {
  mes: string;
  precio_anterior: number;
  precio_nuevo: number;
  delta_precio_pct: number;
  unidades_baseline_3m: number;
  unidades_mes: number;
  impacto_volumen_pct: number | null;
  direccion: "suba" | "baja";
};

type SkuResult = {
  sku: string;
  name: string;
  imagen: string;
  units_periodo: number;
  steps: Step[];
  n_subas: number;
  n_bajas: number;
  impacto_promedio_suba_pct: number | null;
  impacto_promedio_baja_pct: number | null;
  ultimo_cambio_mes: string;
  ultimo_cambio_pct: number;
  ultimo_impacto_pct: number | null;
};

type StepsResp = {
  summary: {
    skus_analizados: number;
    skus_con_cambios_escalon: number;
    total_cambios_detectados: number;
    umbral_pct: number;
    months: number;
  };
  results: SkuResult[];
  generated_at: string;
};

export function PriceStepsView() {
  const [months, setMonths] = useState(18);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isFetching } = useQuery<StepsResp>({
    queryKey: ["wholesale-steps", months],
    queryFn: () => api(`/api/dashboards/products/wholesale-steps?months=${months}&top_n=80&min_units_total=30`),
    staleTime: 5 * 60_000,
  });

  const toggle = (sku: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs text-amber-900">
          <strong>Qué es:</strong> Cambios discretos en el <code>unitCost</code> (PVP mayorista que paga
          el dropshipper) detectados mes a mes — toda variación ≥{data?.summary.umbral_pct ?? 5}% mes
          a mes se marca como "cambio escalón". Para cada cambio comparamos las unidades del mes nuevo
          vs el promedio de los 3 meses anteriores (baseline) para medir el impacto en volumen.
          <br />
          <strong>Cómo usarlo:</strong> Si una <em>suba</em> tuvo un impacto en volumen muy negativo,
          subiste demasiado el PVP mayorista. Si una <em>baja</em> NO produjo aumento de volumen, la
          baja no se justifica comercialmente. Click una fila para expandir todos los cambios detectados.
        </div>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryBox label="SKUs analizados" value={data.summary.skus_analizados.toString()} />
          <SummaryBox label="SKUs con cambios" value={data.summary.skus_con_cambios_escalon.toString()} color="amber" />
          <SummaryBox label="Cambios detectados" value={data.summary.total_cambios_detectados.toString()} />
          <SummaryBox label="Umbral" value={`${data.summary.umbral_pct}%`} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ventana</label>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="px-3 py-1.5 text-xs border border-border rounded-lg"
        >
          <option value={6}>6 meses</option>
          <option value={12}>12 meses</option>
          <option value={18}>18 meses</option>
          <option value={24}>24 meses</option>
          <option value={36}>36 meses</option>
        </select>
        {isFetching && <span className="text-[10px] text-text-muted">Calculando…</span>}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">SKUs con cambios escalón de <code>unitCost</code></h3>
          <p className="text-[11px] text-text-muted">
            Ordenado por magnitud del último cambio · click para ver todos los cambios del SKU
          </p>
        </div>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="w-8"></th>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Unid periodo</th>
                <th className="text-right px-3 py-2">Subas / Bajas</th>
                <th className="text-right px-3 py-2">Impacto avg suba</th>
                <th className="text-right px-3 py-2">Impacto avg baja</th>
                <th className="text-right px-3 py-2">Último cambio</th>
                <th className="text-right px-3 py-2">Impacto último</th>
              </tr>
            </thead>
            <tbody>
              {data?.results.map((r) => (
                <>
                  <tr key={r.sku} onClick={() => toggle(r.sku)} className="border-t border-border cursor-pointer hover:bg-soft/60">
                    <td className="px-2 py-1.5">{expanded.has(r.sku) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                          {r.imagen ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imagen} alt={r.name} className="w-full h-full object-cover" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : <ImageOff size={10} className="text-text-muted/40" />}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`} onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline font-medium truncate max-w-[260px] block">{r.name}</Link>
                          <div className="text-[9px] text-text-muted/70 font-mono">{r.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(r.units_periodo)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className="text-rose-700 font-semibold">{r.n_subas}↑</span>
                      <span className="text-text-muted/40 mx-1">/</span>
                      <span className="text-emerald-700 font-semibold">{r.n_bajas}↓</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.impacto_promedio_suba_pct !== null
                        ? <span className={r.impacto_promedio_suba_pct < 0 ? "text-rose-700 font-bold" : "text-emerald-700 font-bold"}>{r.impacto_promedio_suba_pct >= 0 ? "+" : ""}{r.impacto_promedio_suba_pct}%</span>
                        : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.impacto_promedio_baja_pct !== null
                        ? <span className={r.impacto_promedio_baja_pct > 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{r.impacto_promedio_baja_pct >= 0 ? "+" : ""}{r.impacto_promedio_baja_pct}%</span>
                        : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={r.ultimo_cambio_pct >= 0 ? "text-rose-700 font-bold" : "text-emerald-700 font-bold"}>
                        {r.ultimo_cambio_pct >= 0 ? "+" : ""}{r.ultimo_cambio_pct}%
                      </span>
                      <div className="text-[9px] text-text-muted">{r.ultimo_cambio_mes.slice(0, 7)}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.ultimo_impacto_pct !== null
                        ? <span className={r.ultimo_impacto_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{r.ultimo_impacto_pct >= 0 ? "+" : ""}{r.ultimo_impacto_pct}%</span>
                        : <span className="text-text-muted/40">—</span>}
                    </td>
                  </tr>
                  {expanded.has(r.sku) && (
                    <tr className="bg-soft/30">
                      <td colSpan={8} className="px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Historial de cambios del SKU</div>
                        <table className="w-full text-[11px]">
                          <thead className="text-[9px] uppercase text-text-muted">
                            <tr>
                              <th className="text-left px-2 py-1">Mes</th>
                              <th className="text-right px-2 py-1">Precio ant.</th>
                              <th className="text-right px-2 py-1">Precio nuevo</th>
                              <th className="text-right px-2 py-1">Δ precio %</th>
                              <th className="text-right px-2 py-1">Unidades baseline 3m</th>
                              <th className="text-right px-2 py-1">Unidades mes</th>
                              <th className="text-right px-2 py-1">Impacto vol %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.steps.map((s, i) => (
                              <tr key={`${r.sku}-${s.mes}-${i}`} className="border-t border-border/60">
                                <td className="px-2 py-1">{s.mes.slice(0, 7)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(s.precio_anterior)}</td>
                                <td className="px-2 py-1 text-right tabular-nums font-bold">{formatCurrency(s.precio_nuevo)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">
                                  {s.direccion === "suba"
                                    ? <span className="text-rose-700 font-bold inline-flex items-center gap-1"><TrendingUp size={10} />+{s.delta_precio_pct}%</span>
                                    : <span className="text-emerald-700 font-bold inline-flex items-center gap-1"><TrendingDown size={10} />{s.delta_precio_pct}%</span>}
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">{s.unidades_baseline_3m}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{s.unidades_mes}</td>
                                <td className="px-2 py-1 text-right tabular-nums">
                                  {s.impacto_volumen_pct !== null
                                    ? <span className={s.impacto_volumen_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{s.impacto_volumen_pct >= 0 ? "+" : ""}{s.impacto_volumen_pct}%</span>
                                    : <span className="text-text-muted/40">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {(data?.results.length ?? 0) === 0 && !isFetching && (
                <tr><td colSpan={8} className="text-center py-10 text-text-muted">Sin cambios escalón detectados en la ventana</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color?: "amber" }) {
  const accent = color === "amber" ? "border-amber-300 bg-amber-50/40" : "border-border";
  return (
    <div className={`bg-surface border ${accent} rounded-xl p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
    </div>
  );
}
