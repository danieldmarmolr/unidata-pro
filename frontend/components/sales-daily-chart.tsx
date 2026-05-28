"use client";

/**
 * Chart de metricas diarias para /dashboard/ventas — equivalente visual al
 * DailyMetricChart de Gerencia pero scoped por unidad (Unistore o Unidrop)
 * y leyendo `daily_revenue` del endpoint /api/dashboards/sales/{unit}.
 *
 * Diferencias con el de Gerencia:
 *  - NO incluye forecast (el endpoint actual de sales no lo devuelve).
 *  - Los canales son TN y ML directos (no _unistore/_unidrop) porque la
 *    pagina ya filtra por unidad arriba.
 *  - El selector de variable mapea a los campos que SI vienen en el payload
 *    (revenue, orders, units, ticket_avg, devoluciones).
 *
 * Visual: stacked Area por canal con gradients + linea Total negra.
 */

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  DollarSign,
  ShoppingCart,
  Package,
  Receipt,
  RotateCcw,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type DailyPoint = {
  date: string;
  value?: number;          // revenue total
  revenue_tn?: number;
  revenue_ml?: number;
  orders?: number;
  orders_tn?: number;
  orders_ml?: number;
  units?: number;
  ticket_avg?: number;
  devoluciones?: number;
  skus?: number;
};

type Variable =
  | "revenue"
  | "orders"
  | "units"
  | "ticket_avg"
  | "devoluciones";

const VARIABLE_OPTIONS: {
  value: Variable;
  label: string;
  icon: typeof DollarSign;
  unit: "currency" | "number";
  totalKey: keyof DailyPoint;
  tnKey?: keyof DailyPoint;
  mlKey?: keyof DailyPoint;
  splittable: boolean;
}[] = [
  { value: "revenue",      label: "Facturación", icon: DollarSign,   unit: "currency", totalKey: "value",        tnKey: "revenue_tn", mlKey: "revenue_ml", splittable: true },
  { value: "orders",       label: "Órdenes",     icon: ShoppingCart, unit: "number",   totalKey: "orders",       tnKey: "orders_tn",  mlKey: "orders_ml",  splittable: true },
  { value: "units",        label: "Unidades",    icon: Package,      unit: "number",   totalKey: "units",        splittable: false },
  { value: "ticket_avg",   label: "Ticket Prom.",icon: Receipt,      unit: "currency", totalKey: "ticket_avg",   splittable: false },
  { value: "devoluciones", label: "Devoluciones",icon: RotateCcw,    unit: "number",   totalKey: "devoluciones", splittable: false },
];

const CHANNEL_META = {
  tn:    { label: "Tienda Nube",   color: "#5b8def" },
  ml:    { label: "Mercado Libre", color: "#facc15" },
  total: { label: "Total",         color: "#111827" },
} as const;
type Channel = keyof typeof CHANNEL_META;
const ALL_CHANNELS: Channel[] = ["tn", "ml", "total"];

function compactAxis(v: number, unit: "currency" | "number"): string {
  return unit === "currency" ? formatCurrency(v, "ARS", 0) : formatNumber(Math.round(v));
}

function fmtTooltipValue(v: number, unit: "currency" | "number"): string {
  if (!Number.isFinite(v)) return "—";
  return unit === "currency" ? formatCurrency(v) : formatNumber(v);
}

export function SalesDailyChart({
  points,
  caption,
  subtitle,
  height = 320,
  unitLabel,
}: {
  points: DailyPoint[];
  caption?: string;
  subtitle?: string;
  height?: number;
  /** "Unistore" o "Unidrop" — solo para tooltip/legend, no afecta logica. */
  unitLabel?: string;
}) {
  const [variable, setVariable] = useState<Variable>("revenue");
  const [channels, setChannels] = useState<Set<Channel>>(
    new Set(["tn", "ml", "total"]),
  );
  const [stacked, setStacked] = useState(true);

  const opt = VARIABLE_OPTIONS.find((o) => o.value === variable)!;
  const unit = opt.unit;
  const splittable = opt.splittable;
  const canStack = splittable && channels.has("tn") && channels.has("ml");

  // Detectar si los datos vienen agrupados por HORA (period=today/yesterday).
  // El backend emite "YYYY-MM-DD HH:00" (17 chars con espacio) en ese caso.
  // Para granularidad diaria emite "YYYY-MM-DD" (10 chars).
  const isHourly = useMemo(() => {
    if (!points || !points.length) return false;
    const sample = points.find((p) => p.date)?.date ?? "";
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(sample);
  }, [points]);

  // Formatter del eje X: HH cuando es horario, MM-DD cuando es diario.
  const xTickFormatter = (v: string) => {
    if (!v) return "";
    if (isHourly) {
      // "2026-05-28 14:00" -> "14:00"
      const space = v.indexOf(" ");
      return space >= 0 ? v.slice(space + 1, space + 6) : v;
    }
    return v.slice(5); // MM-DD
  };

  // Trend numeric resumen (delta primera mitad vs segunda mitad)
  const trend = useMemo(() => {
    if (!points || points.length < 4) return null;
    const half = Math.floor(points.length / 2);
    const first = points.slice(0, half);
    const second = points.slice(half);
    const sumFirst = first.reduce((s, p) => s + (Number(p[opt.totalKey] ?? 0) || 0), 0);
    const sumSecond = second.reduce((s, p) => s + (Number(p[opt.totalKey] ?? 0) || 0), 0);
    const avgFirst = sumFirst / Math.max(1, first.length);
    const avgSecond = sumSecond / Math.max(1, second.length);
    if (avgFirst <= 0) return null;
    const pct = (avgSecond - avgFirst) / avgFirst * 100;
    return { pct, direction: pct >= 1 ? "up" : pct <= -1 ? "down" : "flat" as const };
  }, [points, opt.totalKey]);

  const totalSum = useMemo(() => {
    if (!points) return 0;
    return points.reduce((s, p) => s + (Number(p[opt.totalKey] ?? 0) || 0), 0);
  }, [points, opt.totalKey]);

  const todayRef = points && points.length ? points[points.length - 1]?.date : null;

  function toggleChannel(c: Channel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-text">
            {isHourly
              ? `Métricas horarias${unitLabel ? ` · ${unitLabel}` : ""}`
              : (caption ?? `${opt.label} diaria${unitLabel ? ` · ${unitLabel}` : ""}`)}
          </div>
          {subtitle && (
            <div className="text-[10px] text-text-muted mt-0.5">
              {isHourly ? "Distribución por hora del día (24 buckets, timezone Argentina)" : subtitle}
            </div>
          )}
          <div className="text-[10px] text-text-muted mt-1 flex items-center gap-2 flex-wrap">
            <span>Total del periodo: <strong className="text-text tabular-nums">{fmtTooltipValue(totalSum, unit)}</strong></span>
            {trend && (
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-full font-bold tabular-nums",
                  trend.direction === "up" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                  trend.direction === "down" && "bg-rose-50 text-rose-700 border border-rose-200",
                  trend.direction === "flat" && "bg-soft text-text-muted border border-border",
                )}
              >
                {trend.direction === "up" ? "↗" : trend.direction === "down" ? "↘" : "→"}{" "}
                {trend.pct >= 0 ? "+" : ""}{trend.pct.toFixed(1)}% 2da mitad vs 1ra
              </span>
            )}
          </div>
        </div>
        {canStack && (
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stacked}
              onChange={(e) => setStacked(e.target.checked)}
              className="rounded"
            />
            Apilado
          </label>
        )}
      </div>

      {/* Selectores: variable + canales */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Variable:</span>
          {VARIABLE_OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = o.value === variable;
            return (
              <button
                key={o.value}
                onClick={() => setVariable(o.value)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border",
                  active
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-soft border-border text-text-muted hover:text-text hover:border-primary/40",
                )}
              >
                <Icon size={11} />
                {o.label}
              </button>
            );
          })}
        </div>

        {splittable && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Canales:</span>
            {ALL_CHANNELS.map((c) => {
              const meta = CHANNEL_META[c];
              const active = channels.has(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition border",
                    active
                      ? "bg-surface border-current shadow-sm"
                      : "bg-soft border-border text-text-muted/60 opacity-60",
                  )}
                  style={active ? { color: meta.color, borderColor: meta.color } : undefined}
                  title={`${active ? "Ocultar" : "Mostrar"} ${meta.label}`}
                >
                  <span className="w-2 h-2 rounded-sm" style={{ background: meta.color }} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="grad_sales_tn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHANNEL_META.tn.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={CHANNEL_META.tn.color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad_sales_ml" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHANNEL_META.ml.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={CHANNEL_META.ml.color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad_sales_total" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7a3eae" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#7a3eae" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={xTickFormatter}
            minTickGap={isHourly ? 8 : 20}
            interval={isHourly ? 1 : "preserveStartEnd"}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => compactAxis(v, unit)}
          />
          <Tooltip
            formatter={(value, name) => [fmtTooltipValue(Number(value ?? 0), unit), String(name ?? "")]}
            labelFormatter={(label) => `Fecha: ${label}`}
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
          />

          {/* Modo horario (HOY/AYER): barras stacked TN + ML por hora */}
          {isHourly && splittable && opt.tnKey && opt.mlKey && (
            <>
              {channels.has("tn") && (
                <Bar
                  dataKey={opt.tnKey as string}
                  name={CHANNEL_META.tn.label}
                  stackId="ch"
                  fill={CHANNEL_META.tn.color}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              )}
              {channels.has("ml") && (
                <Bar
                  dataKey={opt.mlKey as string}
                  name={CHANNEL_META.ml.label}
                  stackId="ch"
                  fill={CHANNEL_META.ml.color}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              )}
            </>
          )}

          {/* Modo horario y variable NO splittable: una sola barra */}
          {isHourly && !splittable && (
            <Bar
              dataKey={opt.totalKey as string}
              name={opt.label}
              fill="#7a3eae"
              isAnimationActive={false}
              radius={[2, 2, 0, 0]}
            />
          )}

          {/* Modo diario: areas apiladas TN + ML */}
          {!isHourly && splittable && stacked && opt.tnKey && opt.mlKey && (
            <>
              {channels.has("tn") && (
                <Area
                  type="monotone"
                  dataKey={opt.tnKey as string}
                  name={CHANNEL_META.tn.label}
                  stackId="ch"
                  stroke={CHANNEL_META.tn.color}
                  fill="url(#grad_sales_tn)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
              {channels.has("ml") && (
                <Area
                  type="monotone"
                  dataKey={opt.mlKey as string}
                  name={CHANNEL_META.ml.label}
                  stackId="ch"
                  stroke={CHANNEL_META.ml.color}
                  fill="url(#grad_sales_ml)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
            </>
          )}

          {/* Modo diario y NO stacked: areas superpuestas separadas */}
          {!isHourly && splittable && !stacked && opt.tnKey && opt.mlKey && (
            <>
              {channels.has("tn") && (
                <Area
                  type="monotone"
                  dataKey={opt.tnKey as string}
                  name={CHANNEL_META.tn.label}
                  stroke={CHANNEL_META.tn.color}
                  fill="url(#grad_sales_tn)"
                  fillOpacity={0.4}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
              {channels.has("ml") && (
                <Area
                  type="monotone"
                  dataKey={opt.mlKey as string}
                  name={CHANNEL_META.ml.label}
                  stroke={CHANNEL_META.ml.color}
                  fill="url(#grad_sales_ml)"
                  fillOpacity={0.4}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
            </>
          )}

          {/* Modo diario y NO splittable: area unica con el total */}
          {!isHourly && !splittable && (
            <Area
              type="monotone"
              dataKey={opt.totalKey as string}
              name={opt.label}
              stroke="#7a3eae"
              fill="url(#grad_sales_total)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          )}

          {/* Linea Total — solo en modo DIARIO con canal "total" activo
              (en modo horario las barras stacked ya muestran el total naturalmente). */}
          {!isHourly && splittable && channels.has("total") && (
            <Line
              type="monotone"
              dataKey={opt.totalKey as string}
              name="Total"
              stroke={CHANNEL_META.total.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}

          {todayRef && !isHourly && (
            <ReferenceLine
              x={todayRef}
              stroke="#374151"
              strokeDasharray="3 3"
              label={{ value: "Último", fontSize: 9, fill: "#374151", position: "insideTopRight" }}
            />
          )}

          <Legend wrapperStyle={{ fontSize: 10 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
