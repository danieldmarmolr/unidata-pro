"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { TimeSeriesPoint } from "@/lib/types";

export function DailyRevenueChart({
  points,
  caption,
  subtitle,
  height = 280,
}: {
  points: TimeSeriesPoint[];
  caption?: string;
  subtitle?: string;
  height?: number;
}) {
  const total = points.reduce((s, p) => s + p.value, 0);
  const tickFmt = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
        <div className="text-xs text-text-muted">
          Total <span className="font-bold text-primary">{formatCurrency(total)}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sparkviolet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a259ff" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a259ff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(d) => {
              const dt = new Date(d);
              return `${dt.getDate()}/${dt.getMonth() + 1}`;
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={tickFmt}
          />
          <Tooltip
            formatter={(v: unknown) => [formatCurrency(Number(v) || 0), "Revenue"] as [string, string]}
            labelFormatter={(d) => new Date(d).toLocaleDateString("es-AR")}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#7a3eae"
            strokeWidth={2}
            fill="url(#sparkviolet)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
