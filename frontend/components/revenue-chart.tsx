"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeSeries } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

const COLORS = ["#7a3eae", "#a259ff", "#facc15"];

type Row = { date: string } & Record<string, number | string>;

export function RevenueChart({
  series,
  height = 320,
}: {
  series: TimeSeries[];
  height?: number;
}) {
  // Pivot: union of dates, one row per date with each series as a column
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

  const formatTick = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-text">Tendencia ultimos 12 meses</div>
          <div className="text-xs text-text-muted">
            Revenue Tienda Nube + Mercado Libre · Ordenes Unidrop procesadas
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.label} id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.55} />
                <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.05} />
              </linearGradient>
            ))}
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
          <Tooltip
            formatter={(v: unknown, name: unknown) => {
              const n = Number(v) || 0;
              const nm = String(name ?? "");
              if (nm.toLowerCase().includes("ordenes")) {
                return [formatNumber(n), nm] as [string, string];
              }
              return [formatCurrency(n), nm] as [string, string];
            }}
            labelStyle={{ color: "#21093a", fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {series.map((s, i) => (
            <Area
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={COLORS[i % COLORS.length]}
              fill={`url(#g${i})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
