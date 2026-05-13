"use client";

import { useState, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { TimeSeries } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

// Keyed by exact backend labels de revenue_by_channel
export const CHANNEL_COLORS: Record<string, string> = {
  "Unistore - Tienda Nube": "#7a3eae",
  "Unidrop - Tienda Nube": "#a259ff",
  "Unistore - Mercado Libre": "#f97316",
  "Unidrop - Mercado Libre": "#f59e0b",
  "Unidrop - Suscripciones MELI": "#06b6d4",
};

// Colores para el donut (revenue_mix) — misma paleta, distintos nombres
export const DONUT_COLORS: Record<string, string> = {
  "TN Unistore (retail propio)": "#7a3eae",
  "TN Unidrop (dropshippers)": "#a259ff",
  "ML Unistore (Fox Electronics)": "#f97316",
  "ML Unidrop (dropshippers)": "#f59e0b",
  "Suscripciones MELI (Unidrop)": "#06b6d4",
};

// Mapeo donut name → series label del trend chart
export const DONUT_TO_SERIES: Record<string, string> = {
  "TN Unistore (retail propio)": "Unistore - Tienda Nube",
  "ML Unistore (Fox Electronics)": "Unistore - Mercado Libre",
  "TN Unidrop (dropshippers)": "Unidrop - Tienda Nube",
  "ML Unidrop (dropshippers)": "Unidrop - Mercado Libre",
  "Suscripciones MELI (Unidrop)": "Unidrop - Suscripciones MELI",
};

const FALLBACK_COLORS = ["#7a3eae", "#a259ff", "#f59e0b", "#f97316", "#06b6d4", "#10b981", "#ef4444"];

function getColor(label: string, idx: number): string {
  if (CHANNEL_COLORS[label]) return CHANNEL_COLORS[label];
  for (const [key, color] of Object.entries(CHANNEL_COLORS)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

type Row = { date: string } & Record<string, number | string>;

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  stacked: boolean;
}

function CustomTooltip({ active, payload, label, stacked }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = sorted.reduce((s, p) => s + (p.value ?? 0), 0);
  const dominant = sorted[0];

  return (
    <div className="bg-white border border-border rounded-xl shadow-lg p-3 min-w-[200px]">
      <div className="text-[11px] font-bold text-text-muted mb-2">{label}</div>
      {stacked && total > 0 && (
        <div className="mb-2 pb-2 border-b border-border">
          <div className="text-[11px] text-text-muted">Total</div>
          <div className="text-sm font-extrabold text-text">{formatCurrency(total)}</div>
          {dominant && (
            <div className="text-[10px] mt-0.5" style={{ color: dominant.color }}>
              Lidera: {dominant.name} ({((dominant.value / total) * 100).toFixed(0)}%)
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        {sorted.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-[11px] text-text-muted truncate max-w-[130px]">{p.name}</span>
            </div>
            <span className="text-[11px] font-bold text-text tabular-nums">
              {p.name.toLowerCase().includes("ordenes") ? formatNumber(p.value) : formatCurrency(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevenueChart({
  series,
  height = 320,
  filterSeries,
}: {
  series: TimeSeries[];
  height?: number;
  filterSeries?: string | null;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [stacked, setStacked] = useState(false);

  const colors = useMemo(() => series.map((s, i) => getColor(s.label, i)), [series]);

  const dateSet = new Set<string>();
  series.forEach((s) => s.points.forEach((p) => dateSet.add(p.date)));
  const dates = Array.from(dateSet).sort();
  const data: Row[] = dates.map((d) => {
    const row: Row = { date: d };
    series.forEach((s) => {
      const p = s.points.find((p) => p.date === d);
      row[s.label] = p ? p.value : 0;
    });
    return row;
  });

  const visibleSeries = series.filter((s) => {
    if (filterSeries) return s.label === filterSeries;
    return !hidden.has(s.label);
  });

  const totalAcrossAll = useMemo(() => {
    return series.reduce((sum, s) => {
      if (hidden.has(s.label)) return sum;
      return sum + s.points.reduce((s2, p) => s2 + p.value, 0);
    }, 0);
  }, [series, hidden]);

  const dominantSeries = useMemo(() => {
    if (!visibleSeries.length) return null;
    return visibleSeries.reduce((best, s) => {
      const total = s.points.reduce((sum, p) => sum + p.value, 0);
      const bestTotal = best.points.reduce((sum, p) => sum + p.value, 0);
      return total > bestTotal ? s : best;
    });
  }, [visibleSeries]);

  const formatTick = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };

  const toggleSeries = (label: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-sm font-bold text-text">Tendencia ultimos 12 meses</div>
          <div className="text-xs text-text-muted mt-0.5">
            Revenue Tienda Nube + Mercado Libre · Ordenes Unidrop procesadas
          </div>
          {totalAcrossAll > 0 && (
            <div className="text-xs text-text-muted mt-1">
              Total visible: <span className="font-bold text-primary">{formatCurrency(totalAcrossAll)}</span>
              {dominantSeries && (
                <span className="ml-2">
                  · lidera{" "}
                  <span className="font-semibold" style={{ color: colors[series.indexOf(dominantSeries)] }}>
                    {dominantSeries.label}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setStacked((s) => !s)}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition ${
            stacked
              ? "bg-primary text-white border-primary"
              : "bg-soft text-text-muted border-border hover:border-primary"
          }`}
        >
          {stacked ? "Apilado ▪" : "Superpuesto ▫"}
        </button>
      </div>

      {/* Leyenda interactiva */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {filterSeries && (
          <span className="text-[10px] text-primary font-semibold px-2 py-0.5 bg-primary/10 rounded-full border border-primary/20">
            Filtrado desde torta ·{" "}
            <span className="underline cursor-pointer" onClick={() => {}}>
              click en torta para limpiar
            </span>
          </span>
        )}
        {series.map((s, i) => {
          const isFiltered = !!filterSeries && filterSeries !== s.label;
          const isHidden = !filterSeries && hidden.has(s.label);
          const dimmed = isFiltered || isHidden;
          const color = colors[i];
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => !filterSeries && toggleSeries(s.label)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                dimmed
                  ? "border-border text-text-muted bg-soft opacity-40"
                  : "border-transparent text-white"
              } ${filterSeries ? "cursor-default" : ""}`}
              style={dimmed ? {} : { background: color }}
              title={filterSeries ? s.label : isHidden ? "Click para mostrar" : "Click para ocultar"}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: dimmed ? "#9ca3af" : "white" }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => {
              const color = colors[i];
              const isHidden = hidden.has(s.label);
              return (
                <linearGradient key={s.label} id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={isHidden ? 0 : stacked ? 0.7 : 0.45} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatTick}
          />
          <Tooltip content={<CustomTooltip stacked={stacked} />} />
          {visibleSeries.map((s, idx) => {
            const i = series.indexOf(s);
            const color = colors[i];
            return (
              <Area
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={color}
                fill={`url(#g${i})`}
                strokeWidth={dominantSeries?.label === s.label ? 2.5 : 1.5}
                strokeOpacity={1}
                stackId={stacked ? "stack" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
