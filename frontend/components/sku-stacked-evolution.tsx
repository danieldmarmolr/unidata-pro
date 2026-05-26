"use client";

import { useState, useMemo } from "react";
import {
  Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, Legend, Line, ReferenceLine, Area, LabelList,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { DollarSign, Package, Layers, BarChart3, Calendar, TrendingUp, TrendingDown, Minus, Award, AlertTriangle } from "lucide-react";

// Grafico de evolucion del SKU en sus 4 canales con 3 ejes de configuracion:
//   - Granularidad: mes / semana / dia (data viene de la page, no del componente)
//   - Metrica: revenue / unidades
//   - Modo: apilado por canal / total unico
// El forecast 30d/60d solo aplica en modo mensual (Para los demas no tiene
// sentido proyectar a 30d en buckets de 1 dia).

export type SeriesRow = {
  period: string;
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

export type Granularity = "day" | "week" | "month";

type Props = {
  series: SeriesRow[];
  forecast: ForecastPayload | null;
  granularity: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  loading?: boolean;
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
type Mode = "stacked" | "total";

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

const GRAN_LABELS: Record<Granularity, string> = {
  day: "Día",
  week: "Semana",
  month: "Mes",
};

function periodLabel(p: string, gran: Granularity): string {
  if (gran === "month") return p; // YYYY-MM
  // YYYY-MM-DD → DD/MM (compacto) si dia / semana
  const parts = p.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return p;
}

export function SkuStackedEvolution({ series, forecast, granularity, onGranularityChange, loading }: Props) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [mode, setMode] = useState<Mode>("stacked");
  const [showForecast, setShowForecast] = useState(true);
  const [activeChannels, setActiveChannels] = useState<Set<string>>(new Set(ALL_CHANNELS));

  function toggleChannel(ch: string) {
    const next = new Set(activeChannels);
    if (next.has(ch)) next.delete(ch);
    else next.add(ch);
    setActiveChannels(next);
  }

  // Forecast solo aplica en modo mensual (calculado para 30d/60d)
  const forecastApplies = granularity === "month";

  const chartData = useMemo(() => {
    const rows = series.map((m) => {
      const fields: Record<string, unknown> = {
        period: m.period,
        label: periodLabel(m.period, granularity),
      };
      let total = 0;
      for (const ch of ALL_CHANNELS) {
        const key = metric === "revenue" ? (`rev_${ch}` as keyof SeriesRow) : (ch as keyof SeriesRow);
        const v = Number(m[key]) || 0;
        fields[ch] = activeChannels.has(ch) ? v : 0;
        if (activeChannels.has(ch)) total += v;
      }
      fields.__total = total;
      return fields;
    });

    if (forecastApplies && showForecast && forecast && rows.length > 0) {
      const lastMes = series[series.length - 1]?.period ?? "";
      const [y, mo] = lastMes.split("-").map((x) => parseInt(x, 10));
      const next = (offset: number) => {
        let yy = y;
        let mm = mo + offset;
        while (mm > 12) { mm -= 12; yy += 1; }
        return `${yy}-${String(mm).padStart(2, "0")}`;
      };

      const f30Row: Record<string, unknown> = { period: next(1), label: next(1), __forecast: true };
      const f60Row: Record<string, unknown> = { period: next(2), label: next(2), __forecast: true };
      let total30 = 0;
      let total60 = 0;
      for (const ch of ALL_CHANNELS) {
        if (!activeChannels.has(ch)) {
          f30Row[ch] = 0; f60Row[ch] = 0; continue;
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
  }, [series, metric, activeChannels, showForecast, forecast, forecastApplies, granularity]);

  const forecastSplitIdx = forecastApplies && showForecast && series.length > 0 ? series.length - 0.5 : null;
  const granOptions: Granularity[] = ["day", "week", "month"];

  // Stats narrativos: promedio, total, mejor / peor periodo, trend %.
  // Se calculan sobre la serie real (sin filas de forecast). Trend = comparar
  // mitad final de la ventana vs mitad inicial.
  const stats = useMemo(() => {
    if (series.length === 0) return null;
    const values = series.map((m) => {
      let total = 0;
      for (const ch of ALL_CHANNELS) {
        if (!activeChannels.has(ch)) continue;
        const key = metric === "revenue" ? (`rev_${ch}` as keyof SeriesRow) : (ch as keyof SeriesRow);
        total += Number(m[key]) || 0;
      }
      return { period: m.period, total };
    });
    const totalSum = values.reduce((acc, v) => acc + v.total, 0);
    const avg = totalSum / values.length;
    const nonZero = values.filter((v) => v.total > 0);
    const best = nonZero.length ? nonZero.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const worst = nonZero.length ? nonZero.reduce((a, b) => (b.total < a.total ? b : a)) : null;

    // Trend = primera mitad vs segunda mitad
    const half = Math.floor(values.length / 2);
    let firstHalf = 0;
    let secondHalf = 0;
    for (let i = 0; i < values.length; i++) {
      if (i < half) firstHalf += values[i].total;
      else secondHalf += values[i].total;
    }
    const trendPct = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;
    const current = values[values.length - 1] ?? null;

    return { totalSum, avg, best, worst, trendPct, current, count: values.length };
  }, [series, metric, activeChannels]);

  // Mostrar labels de total sobre cada barra solo si hay pocas barras (no se
  // amontonan ilegibles). >40 buckets quedan apretados; tampoco mostramos en
  // forecast rows (esos ya tienen el badge "forecast").
  const showLabels = chartData.length <= 40 && mode === "stacked";

  // Label del ultimo bucket real (para marcar el "hoy" / periodo actual)
  const realRows = chartData.filter((r) => !r.__forecast);
  const lastRealLabel = realRows[realRows.length - 1]?.label as string | undefined;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-text">
            Evolución {mode === "stacked" ? "apilada" : "total"} · {GRAN_LABELS[granularity]}
            {forecastApplies && showForecast ? " + forecast" : ""}
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            {granularity === "day"
              ? "Detalle diario · ventana 90d · cada barra = 1 día"
              : granularity === "week"
              ? "Detalle semanal · ventana 365d · cada barra = 1 semana (lun-dom)"
              : "Mensual por canal · 12 meses · forecast 30d/60d via 90d velocity + trend"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {/* Granularidad */}
          <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
            {granOptions.map((g) => (
              <button
                key={g}
                onClick={() => onGranularityChange?.(g)}
                className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                  granularity === g ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
                }`}
              >
                <Calendar size={11} /> {GRAN_LABELS[g]}
              </button>
            ))}
          </div>
          {/* Modo */}
          <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
            <button
              onClick={() => setMode("stacked")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                mode === "stacked" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <Layers size={11} /> Apilado
            </button>
            <button
              onClick={() => setMode("total")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                mode === "total" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <BarChart3 size={11} /> Total
            </button>
          </div>
          {/* Metrica */}
          <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
            <button
              onClick={() => setMetric("revenue")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                metric === "revenue" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <DollarSign size={11} /> Revenue
            </button>
            <button
              onClick={() => setMetric("units")}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                metric === "units" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"
              }`}
            >
              <Package size={11} /> Unidades
            </button>
          </div>
          {forecastApplies && (
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
          )}
        </div>
      </div>

      {/* Resumen narrativo del periodo: total / promedio / mejor / peor / trend.
          Cuenta la historia del SKU sin necesidad de pasar el mouse. */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-xs">
          <div className="bg-soft/40 border border-border rounded-lg px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Total ventana</div>
            <div className="font-extrabold tabular-nums text-text">{fmtFull(stats.totalSum, metric)}</div>
            <div className="text-[10px] text-text-muted">{stats.count} {GRAN_LABELS[granularity].toLowerCase()}{stats.count === 1 ? "" : "s"}</div>
          </div>
          <div className="bg-primary/5 border border-primary/30 rounded-lg px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-primary/80 font-bold">Promedio</div>
            <div className="font-extrabold tabular-nums text-primary">{fmtFull(Math.round(stats.avg), metric)}</div>
            <div className="text-[10px] text-text-muted">por {GRAN_LABELS[granularity].toLowerCase()}</div>
          </div>
          {stats.best && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-emerald-800 font-bold flex items-center gap-1">
                <Award size={9} /> Mejor
              </div>
              <div className="font-extrabold tabular-nums text-emerald-900">{fmtFull(stats.best.total, metric)}</div>
              <div className="text-[10px] text-emerald-800 truncate">{stats.best.period}</div>
            </div>
          )}
          {stats.worst && stats.worst.period !== stats.best?.period && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-rose-800 font-bold flex items-center gap-1">
                <AlertTriangle size={9} /> Peor
              </div>
              <div className="font-extrabold tabular-nums text-rose-900">{fmtFull(stats.worst.total, metric)}</div>
              <div className="text-[10px] text-rose-800 truncate">{stats.worst.period}</div>
            </div>
          )}
          <div className={`border rounded-lg px-2.5 py-1.5 ${
            stats.trendPct > 5 ? "bg-emerald-50 border-emerald-200" :
            stats.trendPct < -5 ? "bg-rose-50 border-rose-200" :
            "bg-soft/40 border-border"
          }`}>
            <div className={`text-[9px] uppercase tracking-wider font-bold flex items-center gap-1 ${
              stats.trendPct > 5 ? "text-emerald-800" :
              stats.trendPct < -5 ? "text-rose-800" : "text-text-muted"
            }`}>
              {stats.trendPct > 5 ? <TrendingUp size={9} /> : stats.trendPct < -5 ? <TrendingDown size={9} /> : <Minus size={9} />}
              Tendencia
            </div>
            <div className={`font-extrabold tabular-nums ${
              stats.trendPct > 5 ? "text-emerald-900" :
              stats.trendPct < -5 ? "text-rose-900" : "text-text"
            }`}>
              {stats.trendPct >= 0 ? "+" : ""}{stats.trendPct.toFixed(0)}%
            </div>
            <div className="text-[10px] text-text-muted">2da vs 1ra mitad</div>
          </div>
        </div>
      )}

      {/* Toggles de canal (chips) — solo relevantes en modo apilado */}
      {mode === "stacked" && (
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
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHANNEL_COLORS[ch] }} />
                {CHANNEL_LABELS[ch]}
              </button>
            );
          })}
        </div>
      )}

      {loading && series.length === 0 ? (
        <div className="h-[340px] animate-pulse bg-soft/40 rounded" />
      ) : series.length === 0 ? (
        <div className="h-[340px] flex items-center justify-center text-text-muted text-sm">
          Sin ventas registradas en el periodo seleccionado.
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
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
                  {mode === "stacked" && ALL_CHANNELS.map((ch) => {
                    const v = Number(row[ch]) || 0;
                    if (v === 0) return null;
                    const pct = total > 0 ? (v / total) * 100 : 0;
                    return (
                      <div key={ch} className="flex items-center justify-between gap-3 py-0.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ background: CHANNEL_COLORS[ch] }} />
                          <span className="text-text-muted">{CHANNEL_LABELS[ch]}</span>
                        </span>
                        <span className="font-bold tabular-nums text-text">
                          {fmtFull(v, metric)} <span className="text-[10px] text-text-muted">({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                  <div className={`flex justify-between font-bold text-text ${mode === "stacked" ? "border-t border-border mt-2 pt-2" : ""}`}>
                    <span>Total</span>
                    <span className="tabular-nums">{fmtFull(total, metric)}</span>
                  </div>
                </div>
              );
            }}
          />
          {mode === "stacked" && (
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: 8 }} formatter={(value) => CHANNEL_LABELS[value as string] || value} />
          )}
          {forecastSplitIdx !== null && (
            <ReferenceLine
              x={chartData[Math.floor(forecastSplitIdx)]?.label as string}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              label={{ value: "forecast →", position: "top", fontSize: 10, fill: "#6b7280" }}
            />
          )}
          {/* Linea horizontal de promedio del periodo — referencia visual rapida */}
          {stats && stats.avg > 0 && (
            <ReferenceLine
              y={stats.avg}
              stroke="#7c3aed"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={{
                value: `prom ${fmt(stats.avg, metric)}`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "#7c3aed",
                fontWeight: 600,
              }}
            />
          )}
          {/* Marca el bucket "actual" (ultimo dato real) para que el ojo lo encuentre */}
          {lastRealLabel && (
            <ReferenceLine
              x={lastRealLabel}
              stroke="#10b981"
              strokeWidth={1.5}
              strokeOpacity={0.4}
              label={{ value: "actual", position: "top", fontSize: 9, fill: "#059669", fontWeight: 600 }}
            />
          )}
          {mode === "stacked" && ALL_CHANNELS.map((ch, idx) => {
            const isLast = idx === ALL_CHANNELS.length - 1;
            return (
              <Bar
                key={ch}
                dataKey={ch}
                stackId="canal"
                fill={CHANNEL_COLORS[ch]}
                isAnimationActive={false}
              >
                {/* Solo dibujamos el label sobre el TOP del stack (ultimo bar) */}
                {isLast && showLabels && (
                  <LabelList
                    dataKey="__total"
                    position="top"
                    fontSize={9}
                    fill="#374151"
                    fontWeight={600}
                    formatter={(v: string | number | undefined) => (v != null && Number(v) > 0 ? fmt(Number(v), metric) : "")}
                  />
                )}
              </Bar>
            );
          })}
          {mode === "total" && (
            <Area
              type="monotone"
              dataKey="__total"
              fill="#7c3aed"
              fillOpacity={0.15}
              stroke="#7c3aed"
              strokeWidth={2}
              isAnimationActive={false}
              name="Total"
            >
              {chartData.length <= 40 && (
                <LabelList
                  dataKey="__total"
                  position="top"
                  fontSize={9}
                  fill="#5b21b6"
                  fontWeight={600}
                  formatter={(v: string | number | undefined) => (v != null && Number(v) > 0 ? fmt(Number(v), metric) : "")}
                />
              )}
            </Area>
          )}
          {mode === "stacked" && (
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
          )}
        </ComposedChart>
      </ResponsiveContainer>
      )}

      {forecastApplies && forecast && (
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-text-muted">
          {ALL_CHANNELS.map((ch) => {
            const fc = forecast[ch];
            if (!fc || fc.forecast_30d <= 0) return null;
            const trendBadge = fc.trend_pct > 5 ? "↗" : fc.trend_pct < -5 ? "↘" : "→";
            const trendColor =
              fc.trend_pct > 5 ? "text-emerald-700" : fc.trend_pct < -5 ? "text-rose-700" : "text-text-muted";
            return (
              <div key={ch} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-soft/40">
                <span className="w-2 h-2 rounded-sm" style={{ background: CHANNEL_COLORS[ch] }} />
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
