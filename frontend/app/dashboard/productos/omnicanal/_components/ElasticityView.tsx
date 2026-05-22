"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, TrendingUp } from "lucide-react";
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

const DIAG_LABEL: Record<string, string> = {
  poder_pricing_mayorista: "Poder de pricing Unistore (mayorista inelástica)",
  riesgo_churn_dropshippers: "Riesgo de churn (mayorista elástica)",
  balanceado: "Balanceado",
};
const DIAG_COLOR: Record<string, string> = {
  poder_pricing_mayorista: "text-emerald-700 bg-emerald-50 border-emerald-200",
  riesgo_churn_dropshippers: "text-rose-700 bg-rose-50 border-rose-200",
  balanceado: "text-text-muted bg-soft border-border",
};

const INTERP_LABEL: Record<string, string> = {
  muy_inelastico: "Muy inelástica",
  inelastico: "Inelástica",
  unitario: "Unitaria",
  elastico: "Elástica",
  muy_elastico: "Muy elástica",
};

function ElasticityChip({ e }: { e: Elasticity | null }) {
  if (!e) return <span className="text-text-muted/40 text-[10px]">—</span>;
  const a = Math.abs(e.elasticity);
  const color = a < 0.8 ? "text-emerald-700" : a < 1.2 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="text-right whitespace-nowrap">
      <span className={`font-bold tabular-nums ${color}`}>{e.elasticity}</span>
      <div className="text-[9px] text-text-muted">
        {INTERP_LABEL[e.interpretation] ?? e.interpretation} · R²={e.r2} · n={e.n_points}
      </div>
    </div>
  );
}

export function ElasticityView() {
  const [months, setMonths] = useState(12);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  const { data, isFetching } = useQuery<ComparisonResp>({
    queryKey: ["elasticity-comparison", months],
    queryFn: () => api(`/api/dashboards/products/elasticity-comparison?months=${months}&top_n=80&min_units=20`),
    staleTime: 5 * 60_000,
  });

  const sorted = useMemo(() => data?.results ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-cyan-50 to-sky-50 border border-cyan-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-cyan-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs text-cyan-900">
          <strong>Qué es:</strong> Estimación de elasticidad-precio por SKU usando regresión log-log
          sobre la serie mensual: <code>ln(unidades) ~ a + b·ln(precio)</code>. Calculamos dos curvas
          por SKU — <em>retail</em> (Unistore TN, precio que paga el consumidor) y <em>mayorista</em>
          (Unidrop ML, <code>unitCost</code> que paga el dropshipper a Unistore).
          <br />
          <strong>Cómo leerlo:</strong> Una elasticidad ≈ −1 significa que si subís el precio 10% bajan
          las ventas 10%. Si la <em>mayorista</em> es más inelástica que la <em>retail</em>, Unistore
          tiene poder de pricing sobre los dropshippers y puede subir PVP mayorista. Si es más elástica,
          los dropshippers churnean fácil ante una suba.
        </div>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryBox label="SKUs analizados" value={data.summary.total_candidatos.toString()} />
          <SummaryBox label="Con 2 elasticidades" value={data.summary.con_elasticidad_completa.toString()} />
          <SummaryBox label="Poder pricing Uni" value={data.summary.poder_pricing_mayorista.toString()} color="emerald" />
          <SummaryBox label="Riesgo churn DRP" value={data.summary.riesgo_churn_dropshippers.toString()} color="rose" />
          <SummaryBox label="Balanceados" value={data.summary.balanceado.toString()} />
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

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">Comparación elasticidad retail vs mayorista</h3>
          <p className="text-[11px] text-text-muted">
            Click una fila para ver la curva precio-volumen del SKU · {sorted.length} SKUs
          </p>
        </div>
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Unid Unidrop</th>
                <th className="text-right px-3 py-2">Elasticidad retail</th>
                <th className="text-right px-3 py-2">Elasticidad mayorista</th>
                <th className="text-right px-3 py-2">Δ |retail − mayor|</th>
                <th className="text-left px-3 py-2">Diagnóstico</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.sku}
                  onClick={() => setSelectedSku(r.sku)}
                  className={`border-t border-border cursor-pointer hover:bg-soft/60 ${selectedSku === r.sku ? "bg-primary/10" : ""}`}
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium truncate max-w-[260px]" title={r.name}>{r.name}</div>
                    <div className="text-[9px] text-text-muted/70 font-mono">{r.sku}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(r.units_unidrop_periodo)}</td>
                  <td className="px-3 py-1.5"><ElasticityChip e={r.elasticidad_retail} /></td>
                  <td className="px-3 py-1.5"><ElasticityChip e={r.elasticidad_mayorista} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.diff_retail_minus_mayorista !== null
                      ? <span className={r.diff_retail_minus_mayorista > 0.5 ? "text-emerald-700 font-bold" : r.diff_retail_minus_mayorista < -0.5 ? "text-rose-700 font-bold" : ""}>
                          {r.diff_retail_minus_mayorista >= 0 ? "+" : ""}{r.diff_retail_minus_mayorista}
                        </span>
                      : <span className="text-text-muted/40">—</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.diagnostico ? (
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${DIAG_COLOR[r.diagnostico]}`}>
                        {DIAG_LABEL[r.diagnostico]}
                      </span>
                    ) : <span className="text-text-muted/40">datos insuficientes</span>}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && !isFetching && (
                <tr><td colSpan={6} className="text-center py-10 text-text-muted">Sin SKUs con suficiente data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSku && <CurveDetail sku={selectedSku} months={months} onClose={() => setSelectedSku(null)} />}
    </div>
  );
}

function CurveDetail({ sku, months, onClose }: { sku: string; months: number; onClose: () => void }) {
  const { data, isFetching } = useQuery<CurveResp>({
    queryKey: ["wholesale-curve", sku, months],
    queryFn: () => api(`/api/dashboards/products/wholesale-curve/${encodeURIComponent(sku)}?months=${months}`),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="bg-surface border-2 border-primary/40 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-bold text-text flex items-center gap-2">
            <TrendingUp size={14} />
            Curva precio-volumen · {sku}
          </h3>
          <p className="text-[11px] text-text-muted">
            Mensual · {months} meses · regresión log-log para estimar elasticidad
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/productos/${encodeURIComponent(sku)}`} className="text-[11px] text-primary hover:underline">
            Abrir SKU 360
          </Link>
          <button onClick={onClose} className="text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-0.5">
            Cerrar
          </button>
        </div>
      </div>

      {isFetching && <div className="text-xs text-text-muted">Cargando series…</div>}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ScatterCard title="Retail (Unistore TN)" series={data.series_retail} el={data.elasticidad_retail} color="#7a3eae" />
          <ScatterCard title="Mayorista (Unidrop ML, unitCost)" series={data.series_mayorista} el={data.elasticidad_mayorista} color="#f59e0b" />
        </div>
      )}
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
    <div className="bg-soft/40 rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-bold text-text">{title}</div>
        {el && (
          <div className="text-[10px] text-text-muted">
            ε = <span className="font-bold tabular-nums" style={{ color }}>{el.elasticity}</span> · R²={el.r2} · n={el.n_points}
          </div>
        )}
      </div>
      {series.length === 0 ? (
        <div className="text-xs text-text-muted py-8 text-center">Sin data en este canal</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" />
            <XAxis dataKey="precio" type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => formatCurrency(v)} domain={["dataMin", "dataMax"]} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} dataKey="unidades" />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 11 }}
              formatter={(value, name) => {
                if (name === "unidades") return [formatNumber(Number(value ?? 0)), "Unidades"];
                if (name === "precio") return [formatCurrency(Number(value ?? 0)), "Precio"];
                return [String(value), String(name)];
              }}
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload;
                return p?.mes ? `Mes ${p.mes}` : "";
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
