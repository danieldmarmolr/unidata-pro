"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Trophy, BarChart3, DollarSign, Package, ShoppingCart, Users, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type Variable = "profit" | "revenue" | "units" | "orders" | "customers" | "aov";

const VARIABLE_OPTIONS: { value: Variable; label: string; icon: typeof DollarSign; tone: string }[] = [
  { value: "revenue",   label: "Facturación", icon: DollarSign,   tone: "emerald" },
  { value: "profit",    label: "Ganancia",    icon: BarChart3,    tone: "primary" },
  { value: "units",     label: "Unidades",    icon: Package,      tone: "amber" },
  { value: "orders",    label: "Órdenes",     icon: ShoppingCart, tone: "indigo" },
  { value: "customers", label: "Clientes",    icon: Users,        tone: "pink" },
  { value: "aov",       label: "AOV",         icon: Receipt,      tone: "teal" },
];

type HistoryPoint = {
  date: string;
  unistore_tn: number;
  unistore_ml: number;
  unidrop: number;
  total: number;
};

type ForecastResult = {
  name: string;
  label: string;
  forecast: number[];
  mape_pct: number | null;
  in_sample_rmse: number | null;
  sigma: number | null;
  params: Record<string, unknown>;
};

type DailyMetricResponse = {
  days: number;
  horizon: number;
  variable: Variable;
  variable_label: string;
  variable_unit: "currency" | "number";
  points: HistoryPoint[];
  forecast_dates: string[];
  forecasts: {
    horizon: number;
    backtest_size: number;
    history_n: number;
    results: ForecastResult[];
    winner: string | null;
  };
  error: string | null;
};

const METHOD_COLORS: Record<string, string> = {
  naive_last: "#94a3b8",
  naive_mean7: "#64748b",
  linear: "#3b82f6",
  wma: "#06b6d4",
  ema: "#10b981",
  holt: "#f97316",
  hw_additive: "#dc2626",
  hw_multiplicative: "#a855f7",
};

const CHANNEL_META = {
  unistore_tn: { label: "Unistore TN", color: "#5b8def" },
  unistore_ml: { label: "Unistore ML", color: "#facc15" },
  unidrop:     { label: "Unidrop",     color: "#a855f7" },
  total:       { label: "Total",       color: "#111827" },
} as const;
type Channel = keyof typeof CHANNEL_META;
const ALL_CHANNELS: Channel[] = ["unistore_tn", "unistore_ml", "unidrop", "total"];

function fmtValue(v: number, unit: "currency" | "number"): string {
  if (!Number.isFinite(v)) return "—";
  return unit === "currency" ? formatCurrency(v) : formatNumber(v);
}

function compactAxis(v: number, unit: "currency" | "number"): string {
  const abs = Math.abs(v);
  if (unit === "currency") {
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
    return `$${v}`;
  }
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

export function DailyMetricChart({
  defaultVariable = "revenue",
  defaultDays = 90,
  horizon = 28,
}: {
  defaultVariable?: Variable;
  defaultDays?: number;
  horizon?: number;
}) {
  const [variable, setVariable] = useState<Variable>(defaultVariable);
  const [days, setDays] = useState<number>(defaultDays);
  const [channels, setChannels] = useState<Set<Channel>>(
    new Set(["unistore_tn", "unistore_ml", "unidrop", "total"]),
  );
  const [hiddenMethods, setHiddenMethods] = useState<Set<string>>(new Set());
  const [showBand, setShowBand] = useState(true);
  const [stacked, setStacked] = useState(true);

  const { data, isLoading, error } = useQuery<DailyMetricResponse>({
    queryKey: ["gerencia-daily-metric", variable, days, horizon],
    queryFn: () => api(`/api/dashboards/gerencia/daily-metric?variable=${variable}&days=${days}&horizon=${horizon}`),
    staleTime: 5 * 60_000,
  });

  const winner = data?.forecasts.winner ?? null;
  const winnerResult = data?.forecasts.results.find((r) => r.name === winner);
  const unit = data?.variable_unit ?? "number";
  const showForecast = channels.has("total");

  const merged = useMemo(() => {
    if (!data) return [];
    const out: Record<string, unknown>[] = [];
    const lastHist = data.points[data.points.length - 1];

    for (const p of data.points) {
      out.push({ ...p, _hist: true });
    }

    if (showForecast && lastHist && data.forecast_dates.length > 0) {
      const bridge: Record<string, unknown> = { date: lastHist.date };
      for (const r of data.forecasts.results) {
        bridge[`fc_${r.name}`] = lastHist.total;
      }
      if (winnerResult?.sigma) {
        bridge.band_upper = lastHist.total + winnerResult.sigma;
        bridge.band_lower = lastHist.total - winnerResult.sigma;
      }
      const lastIdx = out.length - 1;
      out[lastIdx] = { ...out[lastIdx], ...bridge };

      for (let i = 0; i < data.forecast_dates.length; i++) {
        const fpoint: Record<string, unknown> = {
          date: data.forecast_dates[i],
          _forecast: true,
        };
        for (const r of data.forecasts.results) {
          fpoint[`fc_${r.name}`] = r.forecast[i] ?? null;
        }
        if (winnerResult?.sigma && winnerResult.forecast[i] !== undefined) {
          const widen = 1 + Math.sqrt(i + 1) * 0.15;
          fpoint.band_upper = winnerResult.forecast[i] + winnerResult.sigma * widen;
          fpoint.band_lower = winnerResult.forecast[i] - winnerResult.sigma * widen;
        }
        out.push(fpoint);
      }
    }
    return out;
  }, [data, winnerResult, showForecast]);

  const sortedResults = useMemo(
    () =>
      data
        ? [...data.forecasts.results].sort((a, b) => {
            const am = a.mape_pct ?? Infinity;
            const bm = b.mape_pct ?? Infinity;
            return am - bm;
          })
        : [],
    [data?.forecasts.results],
  );

  function toggleChannel(c: Channel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function toggleMethod(name: string) {
    setHiddenMethods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const todayLine = data?.points[data.points.length - 1]?.date;
  const selectedOption = VARIABLE_OPTIONS.find((o) => o.value === variable);

  // AOV no se grafica como stacked porque es un ratio (no es aditivo entre canales)
  const canStack = variable !== "aov";
  const effectiveStacked = stacked && canStack;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-text">
            {data?.variable_label ?? "Cargando…"} diaria · histórico {data?.days ?? days}d
            {showForecast && data ? ` + forecast ${data.horizon}d` : ""}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {variable === "aov"
              ? "Ticket promedio = facturación / órdenes. El total NO es aditivo entre canales (promedio simple)."
              : variable === "profit"
                ? "Unistore (TN+ML) + Unidrop retención neta · sombreado = ±σ del método ganador"
                : "TN + ML Unistore + Unidrop (canónica del canal) · sombreado = ±σ del método ganador"}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canStack && channels.size > 1 && (
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
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBand}
              onChange={(e) => setShowBand(e.target.checked)}
              className="rounded"
            />
            Banda confianza
          </label>
        </div>
      </div>

      {/* Selectors: variable + period + canales */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 mb-4">
        {/* Variable picker */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Variable:</span>
          {VARIABLE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = opt.value === variable;
            return (
              <button
                key={opt.value}
                onClick={() => setVariable(opt.value)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border",
                  active
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-soft border-border text-text-muted hover:text-text hover:border-primary/40",
                )}
                title={opt.label}
              >
                <Icon size={11} />
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Period picker */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Días:</span>
          {[30, 60, 90, 180].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-2 py-1 rounded-md text-[11px] font-semibold transition border",
                days === d
                  ? "bg-text text-white border-text"
                  : "bg-soft border-border text-text-muted hover:text-text",
              )}
            >
              {d}d
            </button>
          ))}
        </div>

        {/* Channels toggles */}
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
      </div>

      {/* Loading / Error */}
      {isLoading && <div className="h-[360px] bg-soft/30 rounded-lg animate-pulse" />}
      {error && (
        <div className="text-sm text-error bg-rose-50 border border-rose-200 rounded p-3">
          Error cargando serie: {(error as Error).message}
        </div>
      )}
      {data?.error && (
        <div className="text-xs text-warn bg-amber-50 border border-amber-200 rounded p-3 mb-2">
          {data.error}
        </div>
      )}

      {data && !isLoading && (
        <>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="grad_unistore_tn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHANNEL_META.unistore_tn.color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={CHANNEL_META.unistore_tn.color} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad_unistore_ml" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHANNEL_META.unistore_ml.color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={CHANNEL_META.unistore_ml.color} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad_unidrop" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHANNEL_META.unidrop.color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={CHANNEL_META.unidrop.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => (v ? v.slice(5) : "")}
                minTickGap={20}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => compactAxis(v, unit)}
              />
              <Tooltip
                formatter={(value, name) => [fmtValue(Number(value ?? 0), unit), String(name ?? "")]}
                labelFormatter={(label) => `Fecha: ${label}`}
                contentStyle={{ borderRadius: 8, fontSize: 11 }}
              />

              {/* Histórico: 3 canales como Area (stacked o no) según toggle */}
              {channels.has("unistore_tn") && (
                <Area
                  type="monotone"
                  dataKey="unistore_tn"
                  name={CHANNEL_META.unistore_tn.label}
                  stackId={effectiveStacked ? "hist" : undefined}
                  stroke={CHANNEL_META.unistore_tn.color}
                  fill="url(#grad_unistore_tn)"
                  fillOpacity={effectiveStacked ? 1 : 0.4}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
              {channels.has("unistore_ml") && (
                <Area
                  type="monotone"
                  dataKey="unistore_ml"
                  name={CHANNEL_META.unistore_ml.label}
                  stackId={effectiveStacked ? "hist" : undefined}
                  stroke={CHANNEL_META.unistore_ml.color}
                  fill="url(#grad_unistore_ml)"
                  fillOpacity={effectiveStacked ? 1 : 0.4}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}
              {channels.has("unidrop") && (
                <Area
                  type="monotone"
                  dataKey="unidrop"
                  name={CHANNEL_META.unidrop.label}
                  stackId={effectiveStacked ? "hist" : undefined}
                  stroke={CHANNEL_META.unidrop.color}
                  fill="url(#grad_unidrop)"
                  fillOpacity={effectiveStacked ? 1 : 0.4}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              )}

              {/* Banda confianza (solo si Total visible y hay sigma) */}
              {showForecast && showBand && winnerResult?.sigma && (
                <>
                  <Area
                    type="monotone"
                    dataKey="band_upper"
                    name="Banda sup"
                    stroke="none"
                    fill={METHOD_COLORS[winner ?? ""] ?? "#dc2626"}
                    fillOpacity={0.08}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="band_lower"
                    name="Banda inf"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={1}
                    isAnimationActive={false}
                    legendType="none"
                  />
                </>
              )}

              {/* Línea Total real */}
              {channels.has("total") && (
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke={CHANNEL_META.total.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}

              {/* Forecast lines (solo si Total visible) */}
              {showForecast && sortedResults.map((r) => {
                if (hiddenMethods.has(r.name)) return null;
                const isWinner = r.name === winner;
                return (
                  <Line
                    key={r.name}
                    type="monotone"
                    dataKey={`fc_${r.name}`}
                    name={`${r.label}${r.mape_pct !== null ? ` · MAPE ${r.mape_pct.toFixed(1)}%` : ""}`}
                    stroke={METHOD_COLORS[r.name] ?? "#888"}
                    strokeWidth={isWinner ? 2.5 : 1.2}
                    strokeDasharray={isWinner ? undefined : "4 4"}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    legendType="none"
                  />
                );
              })}

              {todayLine && (
                <ReferenceLine
                  x={todayLine}
                  stroke="#374151"
                  strokeDasharray="3 3"
                  label={{ value: "HOY", fontSize: 10, fill: "#374151", position: "insideTopRight" }}
                />
              )}

              <Legend wrapperStyle={{ fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Tabla MAPE comparativa (solo si forecast visible) */}
          {showForecast && sortedResults.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2 flex items-center gap-2">
                <Trophy size={12} />
                Comparación de métodos (MAPE backtest 14d) — click para ocultar/mostrar
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                {sortedResults.map((r) => {
                  const hidden = hiddenMethods.has(r.name);
                  const isWinner = r.name === winner;
                  const color = METHOD_COLORS[r.name] ?? "#888";
                  return (
                    <button
                      key={r.name}
                      onClick={() => toggleMethod(r.name)}
                      className={cn(
                        "text-left text-xs px-3 py-2 rounded-lg border transition",
                        hidden ? "opacity-40 bg-soft border-border" : "bg-soft border-border hover:border-primary/30",
                        isWinner && !hidden && "ring-2 ring-emerald-300 border-emerald-300",
                      )}
                      title={hidden ? "Click para mostrar" : "Click para ocultar"}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                        <span className="font-semibold text-text truncate flex-1">{r.label}</span>
                        {isWinner && <Trophy size={10} className="text-emerald-600 shrink-0" />}
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="text-text-muted">MAPE</span>
                        <span className="font-bold tabular-nums">
                          {r.mape_pct === null ? "—" : `${r.mape_pct.toFixed(1)}%`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {winnerResult && (
                <div className="mt-3 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <Trophy size={14} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{winnerResult.label}</strong> es el método con menor error en backtest 14d
                    (MAPE {winnerResult.mape_pct?.toFixed(1)}%). Su forecast {data.horizon}d se muestra con
                    línea sólida más gruesa y la banda sombreada representa ±σ del error in-sample.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Selected option badge */}
          {selectedOption && (
            <div className="mt-3 text-[10px] text-text-muted">
              Mostrando <strong className="text-text">{selectedOption.label.toLowerCase()}</strong>{" "}
              en {channels.size} canal{channels.size === 1 ? "" : "es"}
              {!showForecast && " · forecast oculto (activá 'Total' para verlo)"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
