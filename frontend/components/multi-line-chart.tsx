"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeSeries } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

const COLORS = ["#7a3eae", "#a259ff", "#facc15", "#fb2c36", "#25d366"];

export function MultiLineChart({
  series,
  caption,
  subtitle,
  height = 300,
  formatter = "number",
}: {
  series: TimeSeries[];
  caption?: string;
  subtitle?: string;
  height?: number;
  formatter?: "currency" | "number";
}) {
  const dateSet = new Set<string>();
  series.forEach((s) => s.points.forEach((p) => dateSet.add(p.date)));
  const dates = Array.from(dateSet).sort();
  const data = dates.map((d) => {
    const row: Record<string, number | string> = { date: d };
    series.forEach((s) => {
      const p = s.points.find((p) => p.date === d);
      row[s.label] = p ? p.value : 0;
    });
    return row;
  });

  const fmt = (v: number) => (formatter === "currency" ? formatCurrency(v, "ARS", 2) : formatNumber(v));
  const tickFmt = (v: number) => (formatter === "currency" ? formatCurrency(v, "ARS", 0) : formatNumber(v));

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {(caption || subtitle) && (
        <div className="mb-3">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={tickFmt} />
          <Tooltip formatter={(v: unknown, name: unknown) => [fmt(Number(v) || 0), String(name ?? "")] as [string, string]} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
