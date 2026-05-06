"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatNumber } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  paid: "#7a3eae",
  pending: "#facc15",
  abandoned: "#9ca3af",
  voided: "#fb2c36",
  refunded: "#fb7185",
  cancelled: "#ef4444",
  desconocido: "#cbd5e1",
};

const FALLBACK_COLORS = ["#7a3eae", "#a259ff", "#facc15", "#fb2c36", "#9ca3af", "#c79bff"];

type Datum = { name: string; value: number };

export function DonutChart({
  data,
  caption,
  height = 260,
}: {
  data: Datum[];
  caption?: string;
  height?: number;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {caption && <div className="text-sm font-bold text-text mb-3">{caption}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={55}
            outerRadius={85}
            dataKey="value"
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={STATUS_COLORS[d.name.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, name: string) => [
              `${formatNumber(v)} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`,
              name,
            ]}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
