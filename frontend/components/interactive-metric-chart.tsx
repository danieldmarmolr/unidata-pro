"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Bar, Line, Area, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Legend,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { BarChart2, TrendingUp, Activity, X } from "lucide-react";

export type MetricDef = {
  key: string;
  label: string;
  kind?: "currency" | "number" | "percent";
  color?: string;
};

type VizType = "bar" | "line" | "area";
type AxisSide = "left" | "right";

type ActiveSeries = {
  key: string;
  vizType: VizType;
  axis: AxisSide;
};

type Point = { date: string; [k: string]: unknown };

const PALETTE = [
  "#7a3eae", "#10b981", "#f59e0b", "#3b82f6", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899",
];

function fmtValue(v: unknown, kind: MetricDef["kind"] = "number"): string {
  const n = Number(v) || 0;
  if (kind === "currency") return formatCurrency(n);
  if (kind === "percent") return `${n.toFixed(1)}%`;
  return formatNumber(n);
}

function tickFmt(v: number, kind: MetricDef["kind"] = "number"): string {
  if (kind === "currency") {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

const VIZ_ICONS: Record<VizType, React.ReactNode> = {
  bar: <BarChart2 size={11} />,
  line: <TrendingUp size={11} />,
  area: <Activity size={11} />,
};

const VIZ_LABELS: VizType[] = ["bar", "line", "area"];

export function InteractiveMetricChart({
  points,
  metrics,
  defaultPrimary,
  defaultSecondary,
  defaultSeries,
  caption,
  subtitle,
  height = 320,
}: {
  points: Point[];
  metrics: MetricDef[];
  defaultPrimary?: string;
  defaultSecondary?: string | null;
  /** Override completo de series iniciales (tiene prioridad sobre defaultPrimary/Secondary) */
  defaultSeries?: ActiveSeries[];
  caption?: string;
  subtitle?: string;
  height?: number;
}) {
  const initialSeries = useMemo<ActiveSeries[]>(() => {
    if (defaultSeries) return defaultSeries;
    const primary = defaultPrimary ?? metrics[0]?.key;
    const series: ActiveSeries[] = primary
      ? [{ key: primary, vizType: "bar", axis: "left" }]
      : [];
    if (defaultSecondary) {
      series.push({ key: defaultSecondary, vizType: "line", axis: "right" });
    }
    return series;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [activeSeries, setActiveSeries] = useState<ActiveSeries[]>(initialSeries);

  const metricColor = useCallback(
    (key: string, idx: number) => metrics.find((m) => m.key === key)?.color ?? PALETTE[idx % PALETTE.length],
    [metrics],
  );

  const toggleMetric = (key: string) => {
    setActiveSeries((prev) => {
      const exists = prev.findIndex((s) => s.key === key);
      if (exists >= 0) {
        if (prev.length === 1) return prev; // keep at least 1
        return prev.filter((s) => s.key !== key);
      }
      const newAxis: AxisSide = prev.some((s) => s.axis === "left") ? "right" : "left";
      return [...prev, { key, vizType: "line", axis: newAxis }];
    });
  };

  const updateSeries = (key: string, patch: Partial<ActiveSeries>) => {
    setActiveSeries((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  };

  const hasLeft = activeSeries.some((s) => s.axis === "left");
  const hasRight = activeSeries.some((s) => s.axis === "right");

  const primaryForTotal = activeSeries[0];
  const primaryMeta = metrics.find((m) => m.key === primaryForTotal?.key);
  const primaryTotal = useMemo(
    () =>
      primaryForTotal
        ? points.reduce((s, p) => s + (Number(p[primaryForTotal.key]) || 0), 0)
        : 0,
    [points, primaryForTotal],
  );

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="min-w-0">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
        {primaryMeta && (
          <span className="text-xs text-text-muted hidden sm:inline self-start mt-0.5">
            Total: <span className="font-bold text-primary">{fmtValue(primaryTotal, primaryMeta.kind)}</span>
          </span>
        )}
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {metrics.map((m, idx) => {
          const seriesIdx = activeSeries.findIndex((s) => s.key === m.key);
          const isActive = seriesIdx >= 0;
          const series = isActive ? activeSeries[seriesIdx] : null;
          const color = metricColor(m.key, idx);

          return (
            <div key={m.key} className="flex items-center">
              {/* Toggle chip */}
              <button
                onClick={() => toggleMetric(m.key)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-l text-[11px] font-semibold border transition-all ${
                  isActive
                    ? "border-r-0"
                    : "bg-soft text-text-muted border-border hover:border-text-muted"
                }`}
                style={isActive ? { background: color + "18", color, borderColor: color + "60" } : {}}
                title={isActive ? "Click para desactivar" : "Click para activar"}
              >
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ background: isActive ? color : "#ccc" }}
                />
                {m.label}
                {isActive && <X size={9} className="opacity-60" />}
              </button>

              {/* Controls (only when active) */}
              {isActive && series && (
                <>
                  {/* Viz type cycle button */}
                  <button
                    onClick={() => {
                      const next = VIZ_LABELS[(VIZ_LABELS.indexOf(series.vizType) + 1) % VIZ_LABELS.length];
                      updateSeries(m.key, { vizType: next });
                    }}
                    title={`Tipo: ${series.vizType} (click para cambiar)`}
                    className="px-1.5 py-1 border-y text-[10px] transition-colors hover:bg-soft"
                    style={{ borderColor: color + "60", color, background: color + "0a" }}
                  >
                    {VIZ_ICONS[series.vizType]}
                  </button>
                  {/* Axis toggle */}
                  <button
                    onClick={() => updateSeries(m.key, { axis: series.axis === "left" ? "right" : "left" })}
                    title={`Eje: ${series.axis === "left" ? "izquierdo" : "derecho"} (click para cambiar)`}
                    className="px-1.5 py-1 rounded-r border text-[9px] font-bold transition-colors hover:bg-soft"
                    style={{ borderColor: color + "60", color, background: color + "0a" }}
                  >
                    {series.axis === "left" ? "L" : "R"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={points} margin={{ top: 8, right: hasRight ? 10 : 0, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eee" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(d: string) => {
              if (!d) return "";
              const parts = String(d).split("-");
              if (parts.length === 2) return `${parts[1]}/${parts[0].slice(2)}`;
              if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
              return d;
            }}
          />
          {hasLeft && (
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => {
                const leftSeries = activeSeries.find((s) => s.axis === "left");
                const m = leftSeries ? metrics.find((mm) => mm.key === leftSeries.key) : null;
                return tickFmt(v, m?.kind);
              }}
              width={58}
            />
          )}
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => {
                const rightSeries = activeSeries.find((s) => s.axis === "right");
                const m = rightSeries ? metrics.find((mm) => mm.key === rightSeries.key) : null;
                return tickFmt(v, m?.kind);
              }}
              width={52}
            />
          )}
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
            formatter={(v: unknown, name: unknown) => {
              const key = String(name ?? "");
              const m = metrics.find((mm) => mm.key === key || mm.label === key);
              return [fmtValue(v, m?.kind), m?.label ?? key] as [string, string];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />

          {activeSeries.map((s, idx) => {
            const color = metricColor(s.key, metrics.findIndex((m) => m.key === s.key));
            const m = metrics.find((mm) => mm.key === s.key);
            const yId = s.axis;

            if (s.vizType === "bar") {
              return (
                <Bar
                  key={s.key}
                  yAxisId={yId}
                  dataKey={s.key}
                  name={m?.label ?? s.key}
                  fill={color}
                  fillOpacity={0.85}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                  stackId={s.axis === "left" ? "left" : undefined}
                />
              );
            }
            if (s.vizType === "area") {
              return (
                <Area
                  key={s.key}
                  yAxisId={yId}
                  type="monotone"
                  dataKey={s.key}
                  name={m?.label ?? s.key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              );
            }
            return (
              <Line
                key={s.key}
                yAxisId={yId}
                type="monotone"
                dataKey={s.key}
                name={m?.label ?? s.key}
                stroke={color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
