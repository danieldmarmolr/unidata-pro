"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, ImageOff, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceDot,
} from "recharts";
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

type CurveResp = {
  sku: string;
  months: number;
  series_mayorista: Array<{ mes: string; precio: number; unidades: number }>;
};

/** Devuelve la conclusión accionable para el último cambio del SKU. */
function diagnosticoUltimoCambio(r: SkuResult): { title: string; detail: string; color: string; Icon: any } {
  const dir = r.ultimo_cambio_pct >= 0 ? "suba" : "baja";
  const impacto = r.ultimo_impacto_pct;

  if (impacto === null) {
    return {
      title: "Sin baseline para medir impacto",
      detail: "El cambio fue muy reciente o no hay 3 meses previos con ventas para comparar.",
      color: "border-slate-300 bg-slate-50 text-slate-800",
      Icon: AlertTriangle,
    };
  }
  if (dir === "suba" && impacto < -20) {
    return {
      title: "Suba dolió en volumen",
      detail: `Subiste el PVP ${r.ultimo_cambio_pct}% y el volumen cayó ${impacto}% vs el baseline de 3 meses. Probablemente subiste demasiado para este SKU. Considerá revertir o ofrecer descuento por volumen.`,
      color: "border-rose-300 bg-rose-50 text-rose-900",
      Icon: AlertTriangle,
    };
  }
  if (dir === "suba" && impacto >= -10) {
    return {
      title: "Suba sostenida sin churn",
      detail: `Subiste el PVP ${r.ultimo_cambio_pct}% y el impacto en volumen fue ${impacto >= 0 ? "+" : ""}${impacto}%. Los dropshippers absorbieron la suba. Margen mayorista capturado sin perder volumen.`,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      Icon: CheckCircle2,
    };
  }
  if (dir === "baja" && impacto > 30) {
    return {
      title: "Baja activó volumen",
      detail: `Bajaste el PVP ${r.ultimo_cambio_pct}% y el volumen creció ${impacto >= 0 ? "+" : ""}${impacto}%. La baja se justifica si el aumento de volumen compensa la pérdida unitaria.`,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      Icon: TrendingUp,
    };
  }
  if (dir === "baja" && impacto < 10) {
    return {
      title: "Baja no produjo aumento",
      detail: `Bajaste el PVP ${r.ultimo_cambio_pct}% pero el volumen apenas creció ${impacto >= 0 ? "+" : ""}${impacto}%. La baja no se justifica comercialmente: estás dejando margen en la mesa.`,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      Icon: Target,
    };
  }
  return {
    title: dir === "suba" ? "Suba con impacto moderado" : "Baja con impacto moderado",
    detail: `Cambio ${r.ultimo_cambio_pct}%, impacto en volumen ${impacto >= 0 ? "+" : ""}${impacto}%. Resultado esperado.`,
    color: "border-slate-300 bg-slate-50 text-slate-700",
    Icon: Activity,
  };
}

// Local fallback icon (no rename needed)
function Activity({ size, className }: { size?: number; className?: string }) {
  return <Target size={size} className={className} />;
}

/** Mini sparkline de la última serie de precios — para mostrar en el row. */
function Sparkline({ series, color = "#7a3eae" }: { series: Array<{ mes: string; precio: number }>; color?: string }) {
  if (series.length < 2) return <div className="text-[9px] text-text-muted/50">—</div>;
  const max = Math.max(...series.map((s) => s.precio));
  const min = Math.min(...series.map((s) => s.precio));
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = series.map((s, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((s.precio - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
      {series.map((s, i) => {
        const x = (i / (series.length - 1)) * w;
        const y = h - ((s.precio - min) / range) * h;
        return <circle key={i} cx={x} cy={y} r={1.5} fill={color} />;
      })}
    </svg>
  );
}

function SparklineFromCurve({ sku }: { sku: string }) {
  const { data } = useQuery<CurveResp>({
    queryKey: ["wholesale-curve", sku, 12],
    queryFn: () => api(`/api/dashboards/products/wholesale-curve/${encodeURIComponent(sku)}?months=12`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="w-20 h-6 bg-soft/40 rounded animate-pulse" />;
  return <Sparkline series={data.series_mayorista} color="#f59e0b" />;
}

export function PriceStepsView() {
  const [months, setMonths] = useState(18);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isFetching } = useQuery<StepsResp>({
    queryKey: ["wholesale-steps", months],
    queryFn: () => api(`/api/dashboards/products/wholesale-steps?months=${months}&top_n=80&min_units_total=30`),
    staleTime: 5 * 60_000,
  });

  // Auto-expandir el primero al cargar
  useEffect(() => {
    if (data?.results && data.results.length > 0 && expanded.size === 0) {
      setExpanded(new Set([data.results[0].sku]));
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

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
          el dropshipper) detectados mes a mes — toda variación ≥{data?.summary.umbral_pct ?? 5}% se marca
          como cambio escalón. Para cada cambio comparamos las unidades del mes nuevo vs el promedio de
          los 3 meses previos (baseline).
          <br />
          <strong>Qué hacer:</strong> Si una <em>suba</em> tuvo impacto en volumen muy negativo, subiste
          demasiado. Si una <em>baja</em> NO produjo aumento, la baja no se justifica comercialmente.
          Click una card para ver el gráfico precio + volumen del SKU.
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

      <div className="space-y-3">
        {data?.results.map((r) => {
          const isOpen = expanded.has(r.sku);
          const diag = diagnosticoUltimoCambio(r);
          const dirIcon = r.ultimo_cambio_pct >= 0 ? <TrendingUp size={18} className="text-rose-600" /> : <TrendingDown size={18} className="text-emerald-600" />;
          return (
            <div key={r.sku} className="bg-surface border border-border rounded-xl overflow-hidden">
              <button onClick={() => toggle(r.sku)} className="w-full px-4 py-3 hover:bg-soft/40 transition flex items-start gap-3 text-left">
                <div className="mt-2">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                <div className="w-10 h-10 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                  {r.imagen ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imagen} alt={r.name} className="w-full h-full object-cover" loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : <ImageOff size={14} className="text-text-muted/40" />}
                </div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-center min-w-0">
                  <div className="md:col-span-4 min-w-0">
                    <div className="text-sm font-bold text-text truncate" title={r.name}>{r.name}</div>
                    <div className="text-[10px] text-text-muted font-mono">{r.sku} · {formatNumber(r.units_periodo)} u</div>
                  </div>
                  <div className="md:col-span-2 flex items-center justify-center">
                    <SparklineFromCurve sku={r.sku} />
                  </div>
                  <div className="md:col-span-3 text-center">
                    <div className="text-[9px] uppercase text-text-muted font-bold">Cambios</div>
                    <div className="text-xs font-bold">
                      <span className="text-rose-700">{r.n_subas}↑</span>
                      <span className="text-text-muted/40 mx-1">·</span>
                      <span className="text-emerald-700">{r.n_bajas}↓</span>
                    </div>
                  </div>
                  <div className="md:col-span-3 text-right">
                    <div className="text-[9px] uppercase text-text-muted font-bold">Último cambio</div>
                    <div className="text-base font-extrabold flex items-center gap-1 justify-end">
                      {dirIcon}
                      <span className={r.ultimo_cambio_pct >= 0 ? "text-rose-700" : "text-emerald-700"}>
                        {r.ultimo_cambio_pct >= 0 ? "+" : ""}{r.ultimo_cambio_pct}%
                      </span>
                    </div>
                    {r.ultimo_impacto_pct !== null && (
                      <div className="text-[10px] text-text-muted">
                        Impacto vol: <span className={r.ultimo_impacto_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{r.ultimo_impacto_pct >= 0 ? "+" : ""}{r.ultimo_impacto_pct}%</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border bg-soft/20 px-4 py-4 space-y-4">
                  {/* Tarjeta de diagnóstico accionable */}
                  <div className={`border-2 rounded-xl p-3 flex items-start gap-3 ${diag.color}`}>
                    <diag.Icon size={18} className="shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-sm mb-1">{diag.title}</div>
                      <div>{diag.detail}</div>
                    </div>
                    <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] font-semibold underline whitespace-nowrap">
                      SKU 360 →
                    </Link>
                  </div>

                  {/* Compound chart: precio (línea) + unidades (barras) con marcadores en escalones */}
                  <CompoundPriceVolumeChart sku={r.sku} steps={r.steps} />

                  {/* Historial detallado de cambios */}
                  <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-text-muted font-bold">
                      Historial de cambios escalón ({r.steps.length})
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="text-[9px] uppercase text-text-muted bg-soft/40">
                        <tr>
                          <th className="text-left px-2 py-1.5">Mes</th>
                          <th className="text-right px-2 py-1.5">Precio ant.</th>
                          <th className="text-right px-2 py-1.5">Precio nuevo</th>
                          <th className="text-right px-2 py-1.5">Δ precio</th>
                          <th className="text-right px-2 py-1.5">Unid baseline 3m</th>
                          <th className="text-right px-2 py-1.5">Unid mes</th>
                          <th className="text-right px-2 py-1.5">Impacto vol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.steps.map((s, i) => (
                          <tr key={`${r.sku}-${s.mes}-${i}`} className="border-t border-border/60">
                            <td className="px-2 py-1.5 font-mono">{s.mes.slice(0, 7)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(s.precio_anterior)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-bold">{formatCurrency(s.precio_nuevo)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {s.direccion === "suba"
                                ? <span className="text-rose-700 font-bold inline-flex items-center gap-1"><TrendingUp size={10} />+{s.delta_precio_pct}%</span>
                                : <span className="text-emerald-700 font-bold inline-flex items-center gap-1"><TrendingDown size={10} />{s.delta_precio_pct}%</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{s.unidades_baseline_3m}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{s.unidades_mes}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {s.impacto_volumen_pct !== null
                                ? <span className={s.impacto_volumen_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{s.impacto_volumen_pct >= 0 ? "+" : ""}{s.impacto_volumen_pct}%</span>
                                : <span className="text-text-muted/40">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {(data?.results.length ?? 0) === 0 && !isFetching && (
          <div className="text-center py-10 text-text-muted bg-surface border border-border rounded-xl">
            Sin cambios escalón detectados en la ventana
          </div>
        )}
      </div>
    </div>
  );
}

function CompoundPriceVolumeChart({ sku, steps }: { sku: string; steps: Step[] }) {
  const { data } = useQuery<CurveResp>({
    queryKey: ["wholesale-curve", sku, 12],
    queryFn: () => api(`/api/dashboards/products/wholesale-curve/${encodeURIComponent(sku)}?months=12`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[260px] bg-soft/40 rounded animate-pulse" />;
  if (data.series_mayorista.length === 0) return <div className="text-xs text-text-muted text-center py-10">Sin serie mensual para graficar</div>;

  // Mes de cada escalon para marcar
  const stepMeses = new Set(steps.map((s) => s.mes.slice(0, 7)));
  // Pre-procesar el series para Recharts: dual axis precio + unidades
  const series = data.series_mayorista.map((p) => ({
    mes: p.mes.slice(0, 7),
    precio: p.precio,
    unidades: p.unidades,
    isStep: stepMeses.has(p.mes.slice(0, 7)),
  }));

  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="text-xs font-bold text-text mb-1">Evolución mensual · precio mayorista vs unidades Unidrop</div>
      <div className="text-[10px] text-text-muted mb-2">
        Línea naranja = <code>unitCost</code> promedio · barras = unidades vendidas · puntos rojos marcan los cambios escalón detectados
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={series} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={(v) => formatCurrency(v)} orientation="left" />
          <YAxis yAxisId="right" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} orientation="right" />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value, name) => {
              if (name === "precio") return [formatCurrency(Number(value ?? 0)), "Precio mayorista"];
              if (name === "unidades") return [formatNumber(Number(value ?? 0)), "Unidades"];
              return [String(value), String(name)];
            }}
          />
          <Bar yAxisId="right" dataKey="unidades" fill="#7a3eae" fillOpacity={0.3} radius={[2, 2, 0, 0]} />
          <Line yAxisId="left" type="monotone" dataKey="precio" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          {/* Marcar puntos de escalón en la línea de precio */}
          {series.filter((s) => s.isStep).map((s) => (
            <ReferenceDot key={`dot-${s.mes}`} yAxisId="left" x={s.mes} y={s.precio} r={6} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
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
