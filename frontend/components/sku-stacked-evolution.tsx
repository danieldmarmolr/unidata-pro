"use client";

import { useState, useMemo } from "react";
import {
  Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Legend, Line, ReferenceLine,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { BarChart2, DollarSign, Package } from "lucide-react";

// Reusa los datos que ya entrega /api/dashboards/sku-omnichannel/{sku} →
// monthly_by_channel + forecast_per_channel del product_detail.
// El usuario alterna entre Revenue / Unidades, y opcionalmente el forecast 30/60.

type MonthlyRow = {
  mes: string;
  unistore_tn: number;
  unistore_meli: number;
  unidrop_tn: number;
  unidrop_meli: number;
  rev_unistore_tn: number;
  rev_unistore_meli: number;
  rev_unidrop_tn: number;
  rev_unidrop_meli: number;
};

type ChannelForecast = {
  daily_velocity: number;
  trend_pct: number;
  forecast_30d: number;
  forecast_60d: number;
  revenue_forecast_30d?: number;
};

type ForecastPayload = {
  unistore_tn: ChannelForecast;
  unistore_meli: ChannelForecast;
  unidrop_tn: ChannelForecast;
  unidrop_meli: ChannelForecast;
  total: { forecast_30d: number; forecast_60d: number; revenue_forecast_30d: number };
};

type Props = {
  monthly: MonthlyRow[];
  forecast: ForecastPayload | null;
};

const CHANNEL_COLORS: Record<string, string> = {
  unistore_tn: "#7c3aed",
  unistore_meli: "#f59e0b",
  unidrop_tn: "#06b6d4",
  unidrop_meli: "#10b981",
};

const CHANNEL_LABELS: Record<string, string> = {
  unistore_tn: "Unistore TN",
  unistore_meli: "Unistore MELI",
  unidrop_tn: "Unidrop TN",
  unidrop_meli: "Unidrop MELI",
};

const ALL_CHANNELS = ["unistore_tn", "unistore_meli", "unidrop_tn", "unidrop_meli"] as const;

type Metric = "units" | "revenue";

function fmt(v: number, metric: Metric) {
  if (metric === "revenue") {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toString();
}

function fmtFull(v: number, metric: Metric) {
  return metric === "revenue" ? formatCurrency(v) : formatNumber(v);
}

export function SkuStackedEvolution({ monthly, forecast }: Props) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [showForecast, setShowForecast] = useState(true);
  const [activeChannels, setActiveChannels] = useState<Set<string>>(
    new Set(ALL_CHANNELS),
  );

  function toggleChannel(ch: string) {
    const next = new Set(activeChannels);
    if (next.has(ch)) next.delete(ch);
    else next.add(ch);
    setActiveChannels(next);
  }

  const chartData = useMemo(() => {
    const rows = monthly.map((m) => {
      const fields: Record<string, unknown> = { mes: m.mes };
      let total = 0;
      for (const ch of ALL_CHANNELS) {
        const key = metric === "revenue" ? (`rev_${ch}` as keyof MonthlyRow) : (ch as keyof MonthlyRow);
        const v = Number(m[key]) || 0;
        fields[ch] = activeChannels.has(ch) ? v : 0;
        if (activeChannels.has(ch)) total += v;
      }
      fields.__total = total;
      return fields;
    });

    // Proyeccion: agregamos 2 puntos virtuales (30d y 60d) si forecast disponible
    if (showForecast && forecast && rows.length > 0) {
      const lastMes = monthly[monthly.length - 1]?.mes ?? "";
      const [y, mo] = lastMes.split("-").map((x) => parseInt(x, 10));
      const next = (offset: number) => {
        let yy = y;
        let mm = mo + offset;
        while (mm > 12) {
          mm -= 12;
          yy += 1;
        }
        return `${yy}-${String(mm).padStart(2, "0")}`;
      };

      // Forecast 30d como mes proximo (offset 1), 60d como offset 2.
      const f30Row: Record<string, unknown> = { mes: next(1), __forecast: true };
      const f60Row: Record<string, unknown> = { mes: next(2), __forecast: true };
      let total30 = 0;
      let total60 = 0;
      for (const ch of ALL_CHANNELS) {
        if (!activeChannels.has(ch)) {
          f30Row[ch] = 0;
          f60Row[ch] = 0;
          continue;
        }
        const fc = forecast[ch];
        const v30 = metric === "revenue" ? (fc?.revenue_forecast_30d ?? 0) : (fc?.forecast_30d ?? 0);
        const v60 = metric === "revenue"
          ? Math.round((fc?.revenue_forecast_30d ?? 0) * (fc?.forecast_60d || 0) / Math.max(1, fc?.forecast_30d || 1))
          : (fc?.forecast_60d ?? 0) - (fc?.forecast_30d ?? 0);
        f30Row[ch] = v30;
        f60Row[ch] = v60;
        total30 += v30;
        total60 += v60;
      }
      f30Row.__total = total30;
      f60Row.__total = total60;
      rows.push(f30Row, f60Row);
    }

    return rows;
  }, [monthly, metric, activeChannels, showForecast, forecast]);

  // Punto donde empieza el forecast (para la linea separadora)
  const forecastSplitIdx = showForecast && monthly.length > 0 ? monthly.length - 0.5 : null;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-text">Evolución apilada · 12 meses + forecast</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            Mensual por canal · tooltip muestra valor y % del mix · forecast 30d/60d proyectado a 90d velocity + trend
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Toggle metrica */}
          <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
            <button
              onClick={() => setMetric("revenue")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                metric === "revenue" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <DollarSign size={12} /> Revenue
            </button>
            <button
              onClick={() => setMetric("units")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                metric === "units" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <Package size={12} /> Unidades
            </button>
          </div>
          {/* Toggle forecast */}
          <button
            onClick={() => setShowForecast(!showForecast)}
            className={`px-2.5 py-1 rounded-lg border text-xs ${
              showForecast
                ? "bg-primary/10 border-primary/40 text-primary font-bold"
                : "bg-soft border-border text-text-muted"
            }`}
          >
            Forecast {showForecast ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Toggles de canal (chips) */}
      <div className="flex flex-wrap gap-2 mb-3">
        {ALL_CHANNELS.map((ch) => {
          const active = activeChannels.has(ch);
          return (
            <button
              key={ch}
              onClick={() => toggleChannel(ch)}
              className={`text-[11px] inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition ${
                active
                  ? "bg-surface border-border text-text"
                  : "bg-soft/40 border-border/40 text-text-muted line-through"
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: CHANNEL_COLORS[ch] }}
              />
              {CHANNEL_LABELS[ch]}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v, metric)} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as Record<string, unknown>;
              const total = Number(row.__total) || 0;
              const isForecast = Boolean(row.__forecast);
              return (
                <div className="bg-surface border border-border rounded-lg shadow-lg p-3 text-xs min-w-[210px]">
                  <div className="font-bold text-text mb-2 flex items-center justify-between">
                    <span>{label}</span>
                    {isForecast && (
                      <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">
                        forecast
                      </span>
                    )}
                  </div>
                  {ALL_CHANNELS.map((ch) => {
                    const v = Number(row[ch]) || 0;
                    if (v === 0) return null;
                    const pct = total > 0 ? (v / total) * 100 : 0;
                    return (
                      <div key={ch} className="flex items-center justify-between gap-3 py-0.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ background: CHANNEL_COLORS[ch] }}
                          />
                          <span className="text-text-muted">{CHANNEL_LABELS[ch]}</span>
                        </span>
                        <span className="font-bold tabular-nums text-text">
                          {fmtFull(v, metric)}{" "}
                          <span className="text-[10px] text-text-muted">({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                  <div className="border-t border-border mt-2 pt-2 flex justify-between font-bold text-text">
                    <span>Total mes</span>
                    <span className="tabular-nums">{fmtFull(total, metric)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: 8 }}
            formatter={(value) => CHANNEL_LABELS[value as string] || value}
          />
          {forecastSplitIdx !== null && (
            <ReferenceLine
              x={chartData[Math.floor(forecastSplitIdx)]?.mes as string}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              label={{ value: "forecast →", position: "top", fontSize: 10, fill: "#6b7280" }}
            />
          )}
          {ALL_CHANNELS.map((ch) => (
            <Bar
              key={ch}
              dataKey={ch}
              stackId="canal"
              fill={CHANNEL_COLORS[ch]}
              radius={[0, 0, 0, 0]}
              isAnimationActive={false}
            />
          ))}
          {/* Linea = total */}
          <Line
            type="monotone"
            dataKey="__total"
            stroke="#111827"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            name="Total"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {forecast && (
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-text-muted">
          {ALL_CHANNELS.map((ch) => {
            const fc = forecast[ch];
            if (!fc || fc.forecast_30d <= 0) return null;
            const trendBadge = fc.trend_pct > 5 ? "↗" : fc.trend_pct < -5 ? "↘" : "→";
            const trendColor =
              fc.trend_pct > 5 ? "text-emerald-700" : fc.trend_pct < -5 ? "text-rose-700" : "text-text-muted";
            return (
              <div
                key={ch}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-soft/40"
              >
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ background: CHANNEL_COLORS[ch] }}
                />
                <strong className="text-text">{CHANNEL_LABELS[ch]}</strong>
                <span>30d: {formatNumber(fc.forecast_30d)} u</span>
                <span className={trendColor}>
                  {trendBadge} {fc.trend_pct >= 0 ? "+" : ""}
                  {fc.trend_pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
