"use client";

import { useMemo, useState } from "react";
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
import { Trophy, ChevronDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

type HistoryPoint = {
  date: string;
  unistore_tn: number;
  unistore_ml: number;
  unidrop: number;
  unidrop_ingresos: number;
  meta_ads: number;
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

export type ProfitConsolidatedResponse = {
  days: number;
  horizon: number;
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

const CHANNEL_COLORS = {
  unistore_tn: "#5b8def",
  unistore_ml: "#facc15",
  unidrop: "#a855f7",
  total: "#111827",
};

export function ProfitConsolidatedChart({ data }: { data: ProfitConsolidatedResponse }) {
  const [hiddenMethods, setHiddenMethods] = useState<Set<string>>(new Set());
  const [showBand, setShowBand] = useState(true);

  const winner = data.forecasts.winner;
  const winnerResult = data.forecasts.results.find((r) => r.name === winner);

  const merged = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    const lastHist = data.points[data.points.length - 1];

    // Historico
    for (const p of data.points) {
      out.push({ ...p, _hist: true });
    }

    // Forecasts: bridge desde el ultimo histórico
    if (lastHist && data.forecast_dates.length > 0) {
      // Bridge point — copia el ultimo total como base de cada forecast line
      const bridge: Record<string, unknown> = { date: lastHist.date };
      for (const r of data.forecasts.results) {
        bridge[`fc_${r.name}`] = lastHist.total;
      }
      if (winnerResult?.sigma) {
        bridge.band_upper = lastHist.total + winnerResult.sigma;
        bridge.band_lower = lastHist.total - winnerResult.sigma;
      }
      // Reemplazar el último punto con merge
      const lastIdx = out.length - 1;
      out[lastIdx] = { ...out[lastIdx], ...bridge };

      // Agregar forecast points
      for (let i = 0; i < data.forecast_dates.length; i++) {
        const fpoint: Record<string, unknown> = {
          date: data.forecast_dates[i],
          _forecast: true,
        };
        for (const r of data.forecasts.results) {
          fpoint[`fc_${r.name}`] = r.forecast[i] ?? null;
        }
        if (winnerResult?.sigma && winnerResult.forecast[i] !== undefined) {
          // Banda se ensancha con la distancia al ultimo histórico
          const widen = 1 + Math.sqrt(i + 1) * 0.15;
          fpoint.band_upper = winnerResult.forecast[i] + winnerResult.sigma * widen;
          fpoint.band_lower = winnerResult.forecast[i] - winnerResult.sigma * widen;
        }
        out.push(fpoint);
      }
    }
    return out;
  }, [data, winnerResult]);

  const sortedResults = useMemo(
    () =>
      [...data.forecasts.results].sort((a, b) => {
        const am = a.mape_pct ?? Infinity;
        const bm = b.mape_pct ?? Infinity;
        return am - bm;
      }),
    [data.forecasts.results],
  );

  function toggleMethod(name: string) {
    setHiddenMethods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const todayLine = data.points[data.points.length - 1]?.date;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-sm font-bold text-text">
            Ganancia diaria consolidada · histórico {data.days}d + forecast {data.horizon}d
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            Unistore (TN+ML) + Unidrop retención neta · sombreado = ±σ del método ganador
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showBand}
            onChange={(e) => setShowBand(e.target.checked)}
            className="rounded"
          />
          Mostrar banda confianza
        </label>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="histTn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHANNEL_COLORS.unistore_tn} stopOpacity={0.6} />
              <stop offset="100%" stopColor={CHANNEL_COLORS.unistore_tn} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="histMl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHANNEL_COLORS.unistore_ml} stopOpacity={0.6} />
              <stop offset="100%" stopColor={CHANNEL_COLORS.unistore_ml} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="histDrop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHANNEL_COLORS.unidrop} stopOpacity={0.6} />
              <stop offset="100%" stopColor={CHANNEL_COLORS.unidrop} stopOpacity={0} />
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
            tickFormatter={(v: number) =>
              Math.abs(v) >= 1_000_000
                ? `$${(v / 1_000_000).toFixed(1)}M`
                : Math.abs(v) >= 1_000
                  ? `$${(v / 1_000).toFixed(0)}k`
                  : `$${v}`
            }
          />
          <Tooltip
            formatter={(value, name) => {
              const v = Number(value ?? 0);
              return [formatCurrency(v), String(name ?? "")];
            }}
            labelFormatter={(label) => `Fecha: ${label}`}
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
          />

          {/* Histórico stacked areas */}
          <Area
            type="monotone"
            dataKey="unistore_tn"
            name="Unistore TN"
            stackId="hist"
            stroke={CHANNEL_COLORS.unistore_tn}
            fill="url(#histTn)"
            strokeWidth={1}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="unistore_ml"
            name="Unistore ML"
            stackId="hist"
            stroke={CHANNEL_COLORS.unistore_ml}
            fill="url(#histMl)"
            strokeWidth={1}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="unidrop"
            name="Unidrop (retención)"
            stackId="hist"
            stroke={CHANNEL_COLORS.unidrop}
            fill="url(#histDrop)"
            strokeWidth={1}
            isAnimationActive={false}
          />

          {/* Banda confianza del ganador */}
          {showBand && winnerResult?.sigma && (
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

          {/* Línea total histórico (negra, encima) */}
          <Line
            type="monotone"
            dataKey="total"
            name="Total real"
            stroke={CHANNEL_COLORS.total}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          {/* Forecast lines: una por método (no stacked, son predicciones independientes) */}
          {sortedResults.map((r) => {
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

      {/* Tabla MAPE comparativa */}
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
    </div>
  );
}
