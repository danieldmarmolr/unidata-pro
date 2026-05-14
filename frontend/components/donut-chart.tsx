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
  onSliceClick,
  colorMap,
  highlightName,
}: {
  data: Datum[];
  caption?: string;
  height?: number;
  /** Click en una porcion → drill */
  onSliceClick?: (d: Datum) => void;
  /** Override de colores por nombre de slice */
  colorMap?: Record<string, string>;
  /** Slice destacado (el resto se atenua) */
  highlightName?: string | null;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {caption && (
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm font-bold text-text">{caption}</div>
          <div className="text-xs text-text-muted">
            Total <span className="font-bold text-primary">{formatNumber(total)}</span>
          </div>
        </div>
      )}
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
            onClick={(d: any) => {
              if (onSliceClick && d?.payload) onSliceClick({ name: d.payload.name, value: d.payload.value });
            }}
            label={({ name, value, percent }) => {
              const pct = ((percent ?? 0) * 100).toFixed(0);
              if (Number(pct) < 4) return ""; // evitar labels superpuestos en porciones chicas
              return `${name} ${pct}%`;
            }}
            labelLine={false}
          >
            {data.map((d, i) => {
              const color = colorMap?.[d.name] ?? STATUS_COLORS[d.name.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
              const dimmed = !!highlightName && highlightName !== d.name;
              return (
                <Cell
                  key={d.name}
                  fill={color}
                  fillOpacity={dimmed ? 0.25 : 1}
                  style={{ cursor: onSliceClick ? "pointer" : "default" }}
                />
              );
            })}
          </Pie>
          <Tooltip
            formatter={(v: unknown, name: unknown) => {
              const n = Number(v) || 0;
              return [
                `${formatNumber(n)} (${total > 0 ? ((n / total) * 100).toFixed(1) : 0}%)`,
                String(name ?? ""),
              ] as [string, string];
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      {/* Tabla compacta debajo: valores exactos */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        {data.map((d, i) => {
          const color = colorMap?.[d.name] ?? STATUS_COLORS[d.name.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
          const isHighlighted = !!highlightName && highlightName === d.name;
          const dimmed = !!highlightName && !isHighlighted;
          const pct = total > 0 ? (d.value / total * 100).toFixed(1) : "0.0";
          const item = (
            <div className={`flex items-center gap-1.5 py-0.5 truncate transition ${dimmed ? "opacity-40" : ""}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className={`truncate ${isHighlighted ? "font-bold text-text" : "text-text-muted"}`}>{d.name}</span>
              <span className="ml-auto font-semibold text-text tabular-nums">
                {formatNumber(d.value)} <span className="text-text-muted font-normal">({pct}%)</span>
              </span>
            </div>
          );
          return onSliceClick ? (
            <button
              key={d.name}
              onClick={() => onSliceClick(d)}
              className={`text-left hover:bg-soft rounded px-1 -mx-1 transition ${isHighlighted ? "ring-1 ring-primary/30 bg-soft/60" : ""}`}
            >
              {item}
            </button>
          ) : (
            <div key={d.name} className="px-1">{item}</div>
          );
        })}
      </div>
    </div>
  );
}
