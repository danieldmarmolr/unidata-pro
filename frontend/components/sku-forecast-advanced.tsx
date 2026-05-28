"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, LabelList,
} from "recharts";
import { Trophy, Target, TrendingUp, Sparkles, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type ForecastResult = {
  name: string;
  label: string;
  forecast: number[];
  mape_pct: number | null;
  in_sample_rmse: number | null;
  sigma: number | null;
  params: Record<string, unknown>;
};

type ForecastsBlock = {
  horizon: number;
  backtest_size: number;
  history_n: number;
  results: ForecastResult[];
  winner: string | null;
};

type HistoryPoint = {
  date: string;
  units_tn: number;
  units_ml: number;
  units_total: number;
  revenue_total: number;
};

type ForecastAdvancedResponse = {
  sku: string;
  history_days: number;
  horizon: number;
  points: HistoryPoint[];
  forecast_dates: string[];
  forecasts: ForecastsBlock;
  revenue_forecasts: ForecastsBlock;
  summary: {
    total_units_history: number;
    total_revenue_history: number;
    days_with_sales: number;
    daily_avg_units: number;
    daily_avg_revenue: number;
    projected_units_horizon: number;
    projected_revenue_horizon: number;
  };
  generated_at: string;
  error?: string;
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

const HORIZON_OPTIONS = [7, 14, 28, 60, 90];
const HISTORY_OPTIONS = [60, 90, 180, 365];

function fmtDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function fmtTickK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${Math.round(v)}`;
}

type Variable = "units" | "revenue";

export function SkuForecastAdvanced({ sku }: { sku: string }) {
  const [variable, setVariable] = useState<Variable>("units");
  const [horizon, setHorizon] = useState<number>(28);
  const [historyDays, setHistoryDays] = useState<number>(180);
  const [hiddenMethods, setHiddenMethods] = useState<Set<string>>(
    new Set(["naive_last", "naive_mean7"]),
  );
  const [showBand, setShowBand] = useState(true);
  const [showLabels, setShowLabels] = useState(false);

  const { data, isLoading, error } = useQuery<ForecastAdvancedResponse>({
    queryKey: ["sku-forecast-adv", sku, historyDays, horizon],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/forecast-advanced?history_days=${historyDays}&horizon=${horizon}`),
    staleTime: 3 * 60_000,
    enabled: !!sku,
  });

  const activeForecasts = variable === "units" ? data?.forecasts : data?.revenue_forecasts;
  const winner = activeForecasts?.winner ?? null;
  const winnerResult = activeForecasts?.results.find((r) => r.name === winner);

  const valueKey: keyof HistoryPoint = variable === "units" ? "units_total" : "revenue_total";

  const merged = useMemo(() => {
    if (!data) return [];
    const out: Record<string, unknown>[] = [];
    const lastHist = data.points[data.points.length - 1];

    for (const p of data.points) {
      out.push({
        date: p.date,
        actual: p[valueKey],
        _hist: true,
      });
    }

    if (lastHist && data.forecast_dates.length > 0 && activeForecasts) {
      // Bridge: copiar actual al ultimo punto historico hacia cada forecast key
      const bridge: Record<string, unknown> = { ...out[out.length - 1] };
      const lastVal = lastHist[valueKey];
      for (const r of activeForecasts.results) {
        bridge[`fc_${r.name}`] = lastVal;
      }
      if (winnerResult?.sigma) {
        bridge.band_upper = lastVal + winnerResult.sigma;
        bridge.band_lower = Math.max(0, lastVal - winnerResult.sigma);
      }
      out[out.length - 1] = bridge;

      for (let i = 0; i < data.forecast_dates.length; i++) {
        const fpoint: Record<string, unknown> = {
          date: data.forecast_dates[i],
          _forecast: true,
        };
        for (const r of activeForecasts.results) {
          fpoint[`fc_${r.name}`] = r.forecast[i] ?? null;
        }
        if (winnerResult?.sigma && winnerResult.forecast[i] !== undefined) {
          const widen = 1 + Math.sqrt(i + 1) * 0.15;
          fpoint.band_upper = winnerResult.forecast[i] + winnerResult.sigma * widen;
          fpoint.band_lower = Math.max(0, winnerResult.forecast[i] - winnerResult.sigma * widen);
        }
        out.push(fpoint);
      }
    }
    return out;
  }, [data, activeForecasts, winnerResult, valueKey]);

  const sortedResults = useMemo(() => {
    if (!activeForecasts) return [];
    return [...activeForecasts.results].sort((a, b) => {
      const am = a.mape_pct ?? Infinity;
      const bm = b.mape_pct ?? Infinity;
      return am - bm;
    });
  }, [activeForecasts]);

  function toggleMethod(name: string) {
    setHiddenMethods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const todayLine = data?.points[data.points.length - 1]?.date;
  const formatValue = (v: number) =>
    variable === "revenue" ? formatCurrency(v) : `${formatNumber(v)} u`;

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-800">
        Error en forecast: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-md shrink-0">
            <TrendingUp size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-text flex items-center gap-2 flex-wrap">
              <span>Pronóstico avanzado del SKU</span>
              {winner && winnerResult && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">
                  <Trophy size={10} /> Ganador: {winnerResult.label}
                  {winnerResult.mape_pct !== null && ` · MAPE ${winnerResult.mape_pct.toFixed(1)}%`}
                </span>
              )}
            </div>
            <div className="text-[11px] text-text-muted">
              {data
                ? `${data.summary.days_with_sales} dias con ventas · prom ${data.summary.daily_avg_units.toFixed(2)} u/dia · 8 modelos · backtest ${activeForecasts?.backtest_size ?? 0}d`
                : "Cargando..."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
            <input type="checkbox" checked={showBand} onChange={(e) => setShowBand(e.target.checked)} className="rounded" />
            Banda ±σ
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="rounded" />
            Mostrar valores
          </label>
        </div>
      </div>

      {/* Variable + Horizonte + Historia */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Variable:</span>
          {([
            { v: "units", label: "Unidades" },
            { v: "revenue", label: "Facturación" },
          ] as Array<{ v: Variable; label: string }>).map((opt) => (
            <button
              key={opt.v}
              onClick={() => setVariable(opt.v)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border",
                variable === opt.v
                  ? "bg-primary text-white border-primary shadow-sm"
                  : "bg-soft border-border text-text-muted hover:text-text hover:border-primary/40",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Horizonte:</span>
          {HORIZON_OPTIONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={cn(
                "px-2 py-1 rounded-md text-[11px] font-semibold transition border min-w-[34px]",
                horizon === h
                  ? "bg-text text-white border-text"
                  : "bg-soft border-border text-text-muted hover:text-text",
              )}
              title={`Pronosticar próximos ${h} dias`}
            >
              {h}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mr-1">Historia:</span>
          {HISTORY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setHistoryDays(d)}
              className={cn(
                "px-2 py-1 rounded-md text-[11px] font-semibold transition border min-w-[40px]",
                historyDays === d
                  ? "bg-text text-white border-text"
                  : "bg-soft border-border text-text-muted hover:text-text",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <SummaryCard
            label={`Total historico (${data.history_days}d)`}
            value={variable === "units" ? `${formatNumber(data.summary.total_units_history)} u` : formatCurrency(data.summary.total_revenue_history)}
            accent="slate"
            icon={<TrendingUp size={12} />}
          />
          <SummaryCard
            label="Promedio diario"
            value={variable === "units" ? `${data.summary.daily_avg_units.toFixed(2)} u` : formatCurrency(data.summary.daily_avg_revenue)}
            accent="primary"
            icon={<Sparkles size={12} />}
          />
          <SummaryCard
            label={`Proyectado próximos ${horizon}d`}
            value={
              variable === "units"
                ? `${formatNumber(data.summary.projected_units_horizon)} u`
                : formatCurrency(data.summary.projected_revenue_horizon)
            }
            accent="emerald"
            icon={<Target size={12} />}
            highlight
          />
          <SummaryCard
            label="Días con ventas"
            value={`${data.summary.days_with_sales} / ${data.points.length}`}
            sub={`${((data.summary.days_with_sales / Math.max(1, data.points.length)) * 100).toFixed(0)}% de los dias`}
            accent="amber"
            icon={<TrendingUp size={12} />}
          />
        </div>
      )}

      {/* Chart */}
      {isLoading || !data ? (
        <div className="h-[420px] bg-soft animate-pulse rounded-lg" />
      ) : data.points.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-text-muted">
          Sin historia suficiente para forecast.
        </div>
      ) : (
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7a3eae" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#7a3eae" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                tickFormatter={fmtTickK}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 11 }}
                labelFormatter={(label) => fmtDate(label as string)}
                formatter={(value, name) => {
                  if (value === null || value === undefined) return ["—", String(name)];
                  const v = Number(value);
                  if (name === "actual") return [formatValue(v), "Historico"];
                  if (name === "band_upper") return [formatValue(v), "Banda +σ"];
                  if (name === "band_lower") return [formatValue(v), "Banda -σ"];
                  const nameStr = String(name);
                  if (nameStr.startsWith("fc_")) {
                    const method = nameStr.replace("fc_", "");
                    const meta = activeForecasts?.results.find((r) => r.name === method);
                    const isWinner = method === winner;
                    return [formatValue(v), `${meta?.label ?? method}${isWinner ? " 🏆" : ""}`];
                  }
                  return [formatValue(v), nameStr];
                }}
              />
              {/* Custom legend rendered below the chart - Recharts 3 Legend no longer accepts payload */}
              {todayLine && (
                <ReferenceLine
                  x={todayLine}
                  stroke="#a855f7"
                  strokeDasharray="4 4"
                  label={{ value: "hoy", fontSize: 9, fill: "#a855f7", position: "insideTopRight" }}
                />
              )}

              {/* Banda de confianza del winner */}
              {showBand && (
                <>
                  <Area
                    type="monotone"
                    dataKey="band_upper"
                    stroke="none"
                    fill="url(#bandGrad)"
                    isAnimationActive={false}
                    name="band_upper"
                  />
                  <Area
                    type="monotone"
                    dataKey="band_lower"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={1}
                    isAnimationActive={false}
                    name="band_lower"
                  />
                </>
              )}

              {/* Histórico (área + línea) */}
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#7a3eae"
                strokeWidth={2}
                fill="url(#actualGrad)"
                name="actual"
                dot={false}
                isAnimationActive={false}
              >
                {showLabels && (
                  <LabelList
                    dataKey="actual"
                    position="top"
                    formatter={(value: unknown) => {
                      if (value === null || value === undefined) return "";
                      const v = Number(value);
                      if (!Number.isFinite(v) || v === 0) return "";
                      return variable === "revenue" ? fmtTickK(v) : `${v}`;
                    }}
                    fontSize={9}
                    fill="#7a3eae"
                  />
                )}
              </Area>

              {/* Una line por método (visible si no esta en hiddenMethods) */}
              {(activeForecasts?.results || [])
                .filter((r) => !hiddenMethods.has(r.name))
                .map((r) => {
                  const isWinner = r.name === winner;
                  return (
                    <Line
                      key={r.name}
                      type="monotone"
                      dataKey={`fc_${r.name}`}
                      stroke={METHOD_COLORS[r.name] || "#888"}
                      strokeWidth={isWinner ? 2.6 : 1.4}
                      strokeDasharray={isWinner ? undefined : "4 3"}
                      dot={isWinner ? { r: 3, fill: METHOD_COLORS[r.name] } : false}
                      name={`fc_${r.name}`}
                      isAnimationActive={false}
                      connectNulls
                    >
                      {showLabels && isWinner && (
                        <LabelList
                          dataKey={`fc_${r.name}`}
                          position="top"
                          formatter={(value: unknown) => {
                            if (value === null || value === undefined) return "";
                            const v = Number(value);
                            if (!Number.isFinite(v)) return "";
                            return variable === "revenue" ? fmtTickK(v) : `${v.toFixed(1)}`;
                          }}
                          fontSize={9}
                          fill={METHOD_COLORS[r.name] || "#888"}
                        />
                      )}
                    </Line>
                  );
                })}

              {/* Marcador del último punto histórico */}
              {data.points.length > 0 && (
                <ReferenceDot
                  x={data.points[data.points.length - 1].date}
                  y={data.points[data.points.length - 1][valueKey]}
                  r={5}
                  fill="#7a3eae"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla de modelos con MAPE + toggle */}
      {sortedResults.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Modelos · click para mostrar/ocultar · ordenados por MAPE
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {sortedResults.map((r) => {
              const hidden = hiddenMethods.has(r.name);
              const isWinner = r.name === winner;
              const color = METHOD_COLORS[r.name] || "#888";
              const sum = r.forecast.reduce((acc, v) => acc + v, 0);
              return (
                <button
                  key={r.name}
                  onClick={() => toggleMethod(r.name)}
                  className={cn(
                    "text-left border rounded-lg p-2 transition group",
                    hidden ? "opacity-50 bg-soft" : "bg-bg",
                    isWinner ? "border-amber-300 bg-amber-50/40" : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[11px] font-bold text-text truncate" title={r.label}>
                        {r.label}
                      </span>
                      {isWinner && <Trophy size={10} className="text-amber-600 shrink-0" />}
                    </div>
                    {hidden ? <EyeOff size={11} className="text-text-muted" /> : <Eye size={11} className="text-text-muted" />}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] text-text-muted">MAPE</span>
                    <span className={cn(
                      "text-[12px] font-extrabold tabular-nums",
                      r.mape_pct === null ? "text-text-muted" :
                      r.mape_pct < 15 ? "text-emerald-700" :
                      r.mape_pct < 30 ? "text-amber-700" : "text-rose-700",
                    )}>
                      {r.mape_pct !== null ? `${r.mape_pct.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mt-0.5">
                    <span className="text-[10px] text-text-muted">Suma {horizon}d</span>
                    <span className="text-[11px] font-bold tabular-nums text-text">
                      {variable === "revenue" ? fmtTickK(sum) : Math.round(sum).toString()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, sub, accent, icon, highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "primary" | "emerald" | "amber" | "slate";
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  const grads: Record<string, string> = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    slate: "from-slate-400 to-slate-600",
  };
  return (
    <div className={cn(
      "border rounded-xl p-3",
      highlight ? "bg-gradient-to-br from-emerald-50/60 to-teal-50/40 border-emerald-200" : "bg-surface border-border",
    )}>
      <div className="flex items-start justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${grads[accent]} text-white flex items-center justify-center shadow-md shrink-0`}>
          {icon}
        </div>
      </div>
      <div className="text-lg font-extrabold text-text tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
