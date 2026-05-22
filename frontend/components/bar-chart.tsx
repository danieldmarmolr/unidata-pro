"use client";

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";

const COLORS = ["#7a3eae", "#a259ff", "#c79bff", "#e0cff3"];

type Datum = { name: string; value: number; extra?: Record<string, number | string | boolean | null> | null };

export function HBarChart({
  data,
  height = 280,
  formatter = "currency",
  color = "#7a3eae",
  caption,
  onBarClick,
  highlightName,
}: {
  data: Datum[];
  height?: number;
  formatter?: "currency" | "number";
  color?: string;
  caption?: string;
  onBarClick?: (d: Datum) => void;
  highlightName?: string | null;
}) {
  const fmt = (v: number) => (formatter === "currency" ? formatCurrency(v) : formatNumber(v));
  const tickFmt = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {caption && <div className="text-sm font-bold text-text mb-3">{caption}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={tickFmt}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#374151" }}
            axisLine={false}
            tickLine={false}
            width={140}
          />
          <Tooltip
            cursor={{ fill: "#f5f0fb" }}
            formatter={(v: unknown) => [fmt(Number(v) || 0), ""] as [string, string]}
          />
          <Bar
            dataKey="value"
            radius={[0, 6, 6, 0]}
            barSize={18}
            onClick={(d: any) => {
              if (onBarClick && d?.payload) onBarClick(d.payload as Datum);
            }}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
          >
            {data.map((d, i) => {
              const baseFill = i === 0 ? color : `${color}${Math.max(40, 100 - i * 8).toString(16)}`.slice(0, 7);
              const dimmed = !!highlightName && highlightName !== d.name;
              return (
                <Cell key={i} fill={baseFill} fillOpacity={dimmed ? 0.3 : 1} />
              );
            })}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { COLORS as BAR_COLORS };
