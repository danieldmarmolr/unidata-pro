"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, TrendingUp, ChevronDown, ChevronRight, Target, AlertTriangle, Activity } from "lucide-react";
import Link from "next/link";
import {
  CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Scatter,
} from "recharts";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Elasticity = {
  elasticity: number;
  r2: number;
  n_points: number;
  interpretation: string;
};

type ComparisonRow = {
  sku: string;
  name: string;
  units_unidrop_periodo: number;
  elasticidad_mayorista: Elasticity | null;
  elasticidad_retail: Elasticity | null;
  diff_retail_minus_mayorista: number | null;
  diagnostico: "poder_pricing_mayorista" | "riesgo_churn_dropshippers" | "balanceado" | null;
};

type ComparisonResp = {
  months: number;
  min_units: number;
  summary: {
    total_candidatos: number;
    con_elasticidad_completa: number;
    poder_pricing_mayorista: number;
    riesgo_churn_dropshippers: number;
    balanceado: number;
  };
  results: ComparisonRow[];
  generated_at: string;
};

type CurveResp = {
  sku: string;
  months: number;
  series_mayorista: Array<{ mes: string; precio: number; unidades: number }>;
  series_retail: Array<{ mes: string; precio: number; unidades: number }>;
  elasticidad_mayorista: Elasticity | null;
  elasticidad_retail: Elasticity | null;
  diagnostico: string | null;
};

const DIAG_BADGE: Record<string, { label: string; color: string; emoji: string }> = {
  poder_pricing_mayorista: { label: "Poder de pricing", color: "border-emerald-300 bg-emerald-50 text-emerald-900", emoji: "📈" },
  riesgo_churn_dropshippers: { label: "Riesgo de churn", color: "border-rose-300 bg-rose-50 text-rose-900", emoji: "⚠️" },
  balanceado: { label: "Balanceado", color: "border-slate-300 bg-slate-50 text-slate-700", emoji: "⚖️" },
};

const INTERP_LABEL: Record<string, string> = {
  muy_inelastico: "Muy inelástica",
  inelastico: "Inelástica",
  unitario: "Unitaria",
  elastico: "Elástica",
  muy_elastico: "Muy elástica",
};

/** Devuelve la recomendación accionable concreta en texto. */
function recomendacion(r: ComparisonRow): { titulo: string; detalle: string; color: string; icon: any } {
  const elR = r.elasticidad_retail;
  const elM = r.elasticidad_mayorista;

  if (!elR && !elM) {
    return {
      titulo: "Sin data suficiente",
      detalle: "El SKU no tiene 4 meses con varianza de precio. Probá hacer un A/B test cambiando el PVP en algún mes para empezar a medir.",
      color: "border-slate-300 bg-slate-50 text-slate-800",
      icon: AlertTriangle,
    };
  }
  if (elR && !elM) {
    return {
      titulo: "Precio mayorista NO varió en el período",
      detalle: `La elasticidad retail (ε=${elR.elasticity}) está estimada (${INTERP_LABEL[elR.interpretation]?.toLowerCase() ?? "—"}). Para descubrir la elasticidad mayorista, hacé un cambio puntual en unitCost (subir o bajar ≥5%) y medí el impacto en 2-3 meses.`,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      icon: Target,
    };
  }
  if (!elR && elM) {
    return {
      titulo: "Solo elasticidad mayorista estimada",
      detalle: `Los dropshippers reaccionan con ε=${elM.elasticity} (${INTERP_LABEL[elM.interpretation]?.toLowerCase() ?? ""}). El retail propio no tiene suficiente data para comparar.`,
      color: "border-violet-300 bg-violet-50 text-violet-900",
      icon: Activity,
    };
  }
  // ambos calculables
  const aR = Math.abs(elR!.elasticity);
  const aM = Math.abs(elM!.elasticity);
  if (r.diagnostico === "poder_pricing_mayorista") {
    return {
      titulo: `Subí el PVP mayorista`,
      detalle: `La elasticidad mayorista (ε=${elM!.elasticity}, ${INTERP_LABEL[elM!.interpretation]?.toLowerCase() ?? ""}) es más inelástica que la retail (ε=${elR!.elasticity}). Una suba del PVP a Unidrop debería tener bajo impacto en volumen. Probá +10% como primer paso.`,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      icon: TrendingUp,
    };
  }
  if (r.diagnostico === "riesgo_churn_dropshippers") {
    return {
      titulo: `Mantener PVP o bajarlo`,
      detalle: `La elasticidad mayorista (ε=${elM!.elasticity}) es alta y mayor que la retail (ε=${elR!.elasticity}). Si subís el PVP mayorista, los dropshippers cambian de fuente fácil. Considerá descuentos por volumen para retener.`,
      color: "border-rose-300 bg-rose-50 text-rose-900",
      icon: AlertTriangle,
    };
  }
  return {
    titulo: "Mercado balanceado",
    detalle: `Las elasticidades retail (ε=${elR!.elasticity}) y mayorista (ε=${elM!.elasticity}) son similares. Cambios de PVP afectan a ambos canales en proporción parecida.`,
    color: "border-slate-300 bg-slate-50 text-slate-700",
    icon: Activity,
  };
}

export function ElasticityView() {
  const [months, setMonths] = useState(12);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isFetching } = useQuery<ComparisonResp>({
    queryKey: ["elasticity-comparison", months],
    queryFn: () => api(`/api/dashboards/products/elasticity-comparison?months=${months}&top_n=80&min_units=20`),
    staleTime: 5 * 60_000,
  });

  // Auto-expandir el primer SKU para que el usuario vea de una el detalle gráfico
  useEffect(() => {
    if (data?.results && data.results.length > 0 && expanded.size === 0) {
      setExpanded(new Set([data.results[0].sku]));
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => data?.results ?? [], [data]);

  const toggle = (sku: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-cyan-50 to-sky-50 border border-cyan-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-cyan-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs text-cyan-900">
          <strong>Qué es:</strong> Regresión log-log <code>ln(unidades) ~ a + b·ln(precio)</code> sobre la
          serie mensual del SKU. Calculamos dos curvas: <em>retail</em> (Unistore TN, precio que paga el
          consumidor) y <em>mayorista</em> (Unidrop ML, <code>unitCost</code> que paga el dropshipper).
          <br />
          <strong>Cómo leerlo:</strong> ε ≈ −1 → si subís el precio 10%, bajan las ventas 10%. Si la mayorista
          es más inelástica que la retail, Unistore puede subir el PVP mayorista sin perder volumen. Si es más
          elástica, los dropshippers churnean ante una suba.
        </div>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryBox label="SKUs analizados" value={data.summary.total_candidatos.toString()} />
          <SummaryBox label="Con 2 elasticidades" value={data.summary.con_elasticidad_completa.toString()} />
          <SummaryBox label="📈 Poder pricing Uni" value={data.summary.poder_pricing_mayorista.toString()} color="emerald" />
          <SummaryBox label="⚠️ Riesgo churn DRP" value={data.summary.riesgo_churn_dropshippers.toString()} color="rose" />
          <SummaryBox label="⚖️ Balanceados" value={data.summary.balanceado.toString()} />
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
          <option value={9}>9 meses</option>
          <option value={12}>12 meses</option>
          <option value={18}>18 meses</option>
          <option value={24}>24 meses</option>
        </select>
        {isFetching && <span className="text-[10px] text-text-muted">Calculando…</span>}
      </div>

      {/* Lista de SKUs como cards visuales expandibles */}
      <div className="space-y-3">
        {sorted.map((r) => {
          const isOpen = expanded.has(r.sku);
          const rec = recomendacion(r);
          const elR = r.elasticidad_retail;
          const elM = r.elasticidad_mayorista;
          const diag = r.diagnostico ? DIAG_BADGE[r.diagnostico] : null;
          return (
            <div key={r.sku} className="bg-surface border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(r.sku)}
                className="w-full px-4 py-3 hover:bg-soft/40 transition flex items-start gap-3 text-left"
              >
                <div className="mt-1">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-4 min-w-0">
                    <div className="text-sm font-bold text-text truncate" title={r.name}>{r.name}</div>
                    <div className="text-[10px] text-text-muted font-mono">{r.sku} · {formatNumber(r.units_unidrop_periodo)} u Unidrop</div>
                  </div>
                  <div className="md:col-span-5">
                    <ElasticityBars elR={elR} elM={elM} />
                  </div>
                  <div className="md:col-span-3 text-right">
                    {diag ? (
                      <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded border ${diag.color}`}>
                        {diag.emoji} {diag.label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-muted/60">Datos insuficientes</span>
                    )}
                    {r.diff_retail_minus_mayorista !== null && (
                      <div className="text-[9px] text-text-muted mt-1">
                        Δ |R-M|: <span className={r.diff_retail_minus_mayorista > 0.5 ? "text-emerald-700 font-bold" : r.diff_retail_minus_mayorista < -0.5 ? "text-rose-700 font-bold" : ""}>{r.diff_retail_minus_mayorista >= 0 ? "+" : ""}{r.diff_retail_minus_mayorista}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border bg-soft/20 px-4 py-4">
                  {/* Tarjeta de recomendación accionable */}
                  <div className={`border-2 rounded-xl p-3 mb-4 flex items-start gap-3 ${rec.color}`}>
                    <rec.icon size={18} className="shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-sm mb-1">{rec.titulo}</div>
                      <div>{rec.detalle}</div>
                    </div>
                    <Link
                      href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] font-semibold underline whitespace-nowrap"
                    >
                      SKU 360 →
                    </Link>
                  </div>

                  {/* Charts side-by-side */}
                  <CurveDetail sku={r.sku} months={months} />
                </div>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && !isFetching && (
          <div className="text-center py-10 text-text-muted bg-surface border border-border rounded-xl">
            Sin SKUs con suficiente data
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras horizontales comparativas: |retail| vs |mayorista|. */
function ElasticityBars({ elR, elM }: { elR: Elasticity | null; elM: Elasticity | null }) {
  const max = Math.max(Math.abs(elR?.elasticity ?? 0), Math.abs(elM?.elasticity ?? 0), 1.5);
  return (
    <div className="space-y-1.5">
      <BarRow label="Retail" e={elR} max={max} color="#7a3eae" />
      <BarRow label="Mayorista" e={elM} max={max} color="#f59e0b" />
    </div>
  );
}

function BarRow({ label, e, max, color }: { label: string; e: Elasticity | null; max: number; color: string }) {
  if (!e) {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-text-muted w-16 shrink-0">{label}</span>
        <div className="flex-1 h-3 bg-soft/40 rounded relative">
          <div className="absolute inset-0 flex items-center justify-center text-text-muted/60 text-[9px]">
            sin datos
          </div>
        </div>
      </div>
    );
  }
  const widthPct = Math.min(100, (Math.abs(e.elasticity) / max) * 100);
  const interpColor = Math.abs(e.elasticity) < 0.8 ? "text-emerald-700" : Math.abs(e.elasticity) < 1.2 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-text-muted w-16 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-soft/40 rounded relative overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${widthPct}%`, background: color }} />
        <div className="absolute inset-0 flex items-center justify-end pr-1.5">
          <span className={`text-[9px] font-bold ${interpColor}`} style={{ mixBlendMode: "normal" }}>
            ε={e.elasticity} · R²={e.r2} · n={e.n_points}
          </span>
        </div>
      </div>
    </div>
  );
}

function CurveDetail({ sku, months }: { sku: string; months: number }) {
  const { data, isFetching } = useQuery<CurveResp>({
    queryKey: ["wholesale-curve", sku, months],
    queryFn: () => api(`/api/dashboards/products/wholesale-curve/${encodeURIComponent(sku)}?months=${months}`),
    staleTime: 5 * 60_000,
  });

  if (isFetching && !data) return <div className="text-xs text-text-muted py-6 text-center">Cargando curvas mensuales…</div>;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ScatterCard title="Retail (Unistore TN)" series={data.series_retail} el={data.elasticidad_retail} color="#7a3eae" />
      <ScatterCard title="Mayorista (Unidrop ML, unitCost)" series={data.series_mayorista} el={data.elasticidad_mayorista} color="#f59e0b" />
    </div>
  );
}

function ScatterCard({
  title, series, el, color,
}: {
  title: string;
  series: Array<{ mes: string; precio: number; unidades: number }>;
  el: Elasticity | null;
  color: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-bold text-text">{title}</div>
        {el && (
          <div className="text-[10px] text-text-muted">
            ε = <span className="font-bold tabular-nums" style={{ color }}>{el.elasticity}</span> · R²={el.r2} · n={el.n_points}
          </div>
        )}
      </div>
      {series.length === 0 ? (
        <div className="text-xs text-text-muted py-10 text-center bg-soft/30 rounded">
          Sin data en este canal · no se puede estimar elasticidad
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 18 }}>
            <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" />
            <XAxis
              dataKey="precio"
              type="number"
              tick={{ fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCurrency(v)}
              domain={["dataMin", "dataMax"]}
              label={{ value: "Precio", fontSize: 10, position: "insideBottom", offset: -4, fill: "#94a3b8" }}
            />
            <YAxis
              dataKey="unidades"
              tick={{ fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              label={{ value: "Unidades", fontSize: 10, angle: -90, position: "insideLeft", fill: "#94a3b8" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 11 }}
              formatter={(value, name) => {
                if (name === "unidades") return [formatNumber(Number(value ?? 0)), "Unidades"];
                if (name === "precio") return [formatCurrency(Number(value ?? 0)), "Precio"];
                return [String(value), String(name)];
              }}
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload;
                return p?.mes ? `Mes ${p.mes.slice(0, 7)}` : "";
              }}
            />
            <Scatter dataKey="unidades" fill={color} />
            <Line type="monotone" dataKey="unidades" stroke={color} strokeOpacity={0.3} strokeWidth={1} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color?: "emerald" | "rose" }) {
  const accent = color === "emerald" ? "border-emerald-300 bg-emerald-50/40"
    : color === "rose" ? "border-rose-300 bg-rose-50/40"
    : "border-border";
  return (
    <div className={`bg-surface border ${accent} rounded-xl p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
    </div>
  );
}
