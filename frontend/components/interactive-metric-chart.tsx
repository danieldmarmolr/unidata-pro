"use client";

import { useState, useMemo } from "react";
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Legend,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * Chart interactivo de barras + linea con segunda dimension opcional.
 *
 * Permite al usuario elegir:
 *  - Que metrica ver como BARRAS (eje izquierdo)
 *  - Que metrica ADICIONAL ver superpuesta como LINEA (eje derecho)
 *
 * Cada metrica se formatea segun su 'kind':
 *  - "currency" -> $ X.XXX
 *  - "number"   -> X.XXX
 *  - "percent"  -> X.X%
 *
 * Los puntos deben ser un array de objetos con un campo 'date' (string) y
 * los demas campos numericos accesibles por su key.
 */

export type MetricDef = {
  /** Key en el objeto del punto (ej: "revenue", "ordenes") */
  key: string;
  /** Etiqueta visible para el dropdown y el tooltip */
  label: string;
  /** Formato del valor */
  kind?: "currency" | "number" | "percent";
  /** Color del bar/line (default usa la paleta UNIDATA) */
  color?: string;
};

type Point = { date: string; [k: string]: unknown };

const PRIMARY_COLOR = "#7a3eae"; // violeta UNIDATA
const SECONDARY_COLOR = "#10b981"; // verde para contraste

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

export function InteractiveMetricChart({
  points,
  metrics,
  defaultPrimary,
  defaultSecondary,
  caption,
  subtitle,
  height = 320,
}: {
  points: Point[];
  /** Lista de metricas disponibles para los selectors */
  metrics: MetricDef[];
  /** Key inicial para el eje izquierdo (bars) */
  defaultPrimary?: string;
  /** Key inicial para el eje derecho (line). null = sin segunda metrica */
  defaultSecondary?: string | null;
  caption?: string;
  subtitle?: string;
  height?: number;
}) {
  const [primaryKey, setPrimaryKey] = useState<string>(
    defaultPrimary ?? metrics[0]?.key ?? "value",
  );
  const [secondaryKey, setSecondaryKey] = useState<string | null>(
    defaultSecondary ?? null,
  );

  const primary = useMemo(
    () => metrics.find((m) => m.key === primaryKey) ?? metrics[0],
    [primaryKey, metrics],
  );
  const secondary = useMemo(
    () => (secondaryKey ? metrics.find((m) => m.key === secondaryKey) ?? null : null),
    [secondaryKey, metrics],
  );

  const primaryTotal = useMemo(() => {
    if (!primary) return 0;
    return points.reduce((s, p) => s + (Number(p[primary.key]) || 0), 0);
  }, [points, primary]);

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header con selectors. Si hay solo 1 metrica, no muestra selectors. */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="min-w-0">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {metrics.length > 1 && (
            <>
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">Barras</span>
                <select
                  value={primaryKey}
                  onChange={(e) => setPrimaryKey(e.target.value)}
                  className="px-2 py-1 rounded-md border border-border bg-surface text-text text-xs font-semibold focus:ring-1 focus:ring-primary outline-none"
                >
                  {metrics.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </label>
              <span className="text-text-muted/40">+</span>
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">Línea</span>
                <select
                  value={secondaryKey ?? ""}
                  onChange={(e) => setSecondaryKey(e.target.value || null)}
                  className="px-2 py-1 rounded-md border border-border bg-surface text-text text-xs font-semibold focus:ring-1 focus:ring-primary outline-none"
                >
                  <option value="">— ninguna —</option>
                  {metrics
                    .filter((m) => m.key !== primaryKey)
                    .map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                </select>
              </label>
            </>
          )}
          {primary && (
            <span className="text-text-muted ml-2 hidden sm:inline">
              Total: <span className="font-bold text-primary">{fmtValue(primaryTotal, primary.kind)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eee" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(d: string) => {
              // espera "YYYY-MM" o "YYYY-MM-DD"
              if (!d) return "";
              const parts = String(d).split("-");
              if (parts.length === 2) {
                const [y, m] = parts;
                return `${m}/${y.slice(2)}`;
              }
              if (parts.length === 3) {
                const [, m, day] = parts;
                return `${day}/${m}`;
              }
              return d;
            }}
          />
          {primary && (
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: primary.color || PRIMARY_COLOR }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => tickFmt(v, primary.kind)}
            />
          )}
          {secondary && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: secondary.color || SECONDARY_COLOR }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => tickFmt(v, secondary.kind)}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: unknown, name: unknown) => {
              const label = String(name ?? "");
              const m = metrics.find((mm) => mm.label === label);
              return [fmtValue(v, m?.kind), label] as [string, string];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="circle"
          />
          {primary && (
            <Bar
              yAxisId="left"
              dataKey={primary.key}
              name={primary.label}
              fill={primary.color || PRIMARY_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
          )}
          {secondary && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={secondary.key}
              name={secondary.label}
              stroke={secondary.color || SECONDARY_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3, fill: secondary.color || SECONDARY_COLOR }}
              activeDot={{ r: 5 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
