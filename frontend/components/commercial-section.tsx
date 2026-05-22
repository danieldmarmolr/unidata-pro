"use client";

/**
 * Seccion Comercial — vista granular del revenue cross-org con tres modos
 * de visualizacion + Share + Top SKUs por ganancia + Top clientes por ganancia.
 *
 * Controles:
 *  - Granularidad: Dia · Semana · Mes · Trimestre
 *  - Ventana:      3m · 6m · 12m · 24m
 *  - Modo vista:   Lineas superpuestas · Barras apiladas · Share 100%
 *
 * Bloques:
 *  - Chart principal (cambia segun modo) con tooltip de share por canal
 *  - Donut "Share del periodo" por canal y por unidad
 *  - Tabla "Top SKUs por ganancia" (cross-canal Unistore) con margen + share
 *  - Tabla "Top clientes por ganancia" (cross-canal Unistore)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { DonutChart } from "@/components/donut-chart";
import { api } from "@/lib/api";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

// =============================================================================
// Types (matchear backend commercial_breakdown.py)
// =============================================================================

type Granularity = "day" | "week" | "month" | "quarter";
type Window = "3m" | "6m" | "12m" | "24m";
type ViewMode = "lines" | "stacked" | "share100";

type TimePoint = {
  bucket: string;
  total: number;
  tn_unistore: number;
  ml_unistore: number;
  tn_unidrop: number;
  ml_unidrop: number;
  subs_unidrop: number;
};

type ChannelShareRow = {
  channel: string;
  label: string;
  unit: string;
  revenue: number;
  share_pct: number;
};

type UnitShareRow = {
  unit: string;
  label: string;
  revenue: number;
  share_pct: number;
};

type SkuRow = {
  sku: string;
  name: string;
  units: number;
  units_tn: number;
  units_ml: number;
  revenue: number;
  rev_tn: number;
  rev_ml: number;
  costo: number;
  ganancia_neta: number;
  margen_pct: number;
  has_cost: boolean;
  share_pct: number;
};

type CustomerRow = {
  customer_key: string;
  nombre: string;
  channel: "tn" | "ml";
  channel_label: string;
  ordenes: number;
  revenue: number;
  ganancia_estimada: number;
  last_order: string;
};

export type CommercialResponse = {
  granularity: Granularity;
  period_months: number;
  since: string;
  channel_labels: Record<string, string>;
  channel_units: Record<string, string>;
  time_series: TimePoint[];
  channel_share: {
    total: number;
    by_channel: ChannelShareRow[];
    by_unit: UnitShareRow[];
  };
  top_skus_by_profit: {
    rows: SkuRow[];
    without_cost_count: number;
    total_profit_period: number;
    error: string | null;
  };
  top_customers: {
    rows: CustomerRow[];
    margen_promedio_usado_pct: number;
    error: string | null;
  };
  generated_at: string;
};

// =============================================================================
// Constants
// =============================================================================

const CHANNEL_COLORS: Record<string, string> = {
  tn_unistore: "#8b5cf6",      // violeta
  ml_unistore: "#f59e0b",      // ambar
  tn_unidrop: "#a78bfa",       // violeta claro
  ml_unidrop: "#fb923c",       // naranja
  subs_unidrop: "#06b6d4",     // cyan
};

const UNIT_COLORS: Record<string, string> = {
  unistore: "#6366f1",
  unidrop: "#a855f7",
};

const GRAN_LABEL: Record<Granularity, string> = {
  day: "Día",
  week: "Semana",
  month: "Mes",
  quarter: "Trimestre",
};

const WINDOW_MONTHS: Record<Window, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "24m": 24,
};

const CHANNEL_KEYS = ["tn_unistore", "ml_unistore", "tn_unidrop", "ml_unidrop", "subs_unidrop"] as const;

// =============================================================================
// Component
// =============================================================================

export function CommercialSection() {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [windowSel, setWindowSel] = useState<Window>("12m");
  const [viewMode, setViewMode] = useState<ViewMode>("stacked");
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());

  const periodMonths = WINDOW_MONTHS[windowSel];

  const { data, isLoading, error } = useQuery<CommercialResponse>({
    queryKey: ["dashboards", "gerencia", "commercial", granularity, periodMonths],
    queryFn: () =>
      api<CommercialResponse>(
        `/api/dashboards/gerencia/commercial?granularity=${granularity}&period_months=${periodMonths}&top_n_skus=20&top_n_customers=20`,
      ),
    staleTime: 5 * 60_000,
  });

  // Normalizar para vista 100% share: convertir cada canal a su % del total del bucket
  const chartData = useMemo(() => {
    if (!data?.time_series) return [];
    if (viewMode !== "share100") return data.time_series;
    return data.time_series.map((p) => {
      const total = p.total || 1;
      const out: Record<string, unknown> = { bucket: p.bucket, total: 100 };
      for (const ch of CHANNEL_KEYS) {
        out[ch] = (p[ch] / total) * 100;
      }
      return out;
    });
  }, [data?.time_series, viewMode]);

  const toggleChannel = (ch: string) => {
    setHiddenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  function fmtTickX(v: string) {
    if (!v) return "";
    if (granularity === "day") return v.slice(5);
    if (granularity === "week") return v.slice(5);
    if (granularity === "month") return v.slice(0, 7);
    if (granularity === "quarter") {
      const d = new Date(v);
      const m = d.getMonth();
      return `Q${Math.floor(m / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
    }
    return v;
  }

  return (
    <div className="space-y-6">
      {/* Header con controles */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-text">Revenue cross-organización por canal</h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              5 canales operativos · Granularidad {GRAN_LABEL[granularity]} · Ventana {windowSel}
              {data && ` · Total ${formatCurrency(data.channel_share.total)}`}
            </p>
          </div>
        </div>

        {/* Controles en 3 grupos */}
        <div className="flex flex-wrap gap-4 mb-5">
          <ControlGroup label="Granularidad">
            {(["day", "week", "month", "quarter"] as Granularity[]).map((g) => (
              <ControlButton key={g} active={granularity === g} onClick={() => setGranularity(g)}>
                {GRAN_LABEL[g]}
              </ControlButton>
            ))}
          </ControlGroup>

          <ControlGroup label="Ventana">
            {(["3m", "6m", "12m", "24m"] as Window[]).map((w) => (
              <ControlButton key={w} active={windowSel === w} onClick={() => setWindowSel(w)}>
                {w}
              </ControlButton>
            ))}
          </ControlGroup>

          <ControlGroup label="Modo vista">
            <ControlButton active={viewMode === "lines"} onClick={() => setViewMode("lines")}>
              ↗ Líneas
            </ControlButton>
            <ControlButton active={viewMode === "stacked"} onClick={() => setViewMode("stacked")}>
              ▦ Barras apiladas
            </ControlButton>
            <ControlButton active={viewMode === "share100"} onClick={() => setViewMode("share100")}>
              % Share 100%
            </ControlButton>
          </ControlGroup>
        </div>

        {/* Chart */}
        {error && (
          <div className="text-sm text-error bg-rose-50 border border-rose-200 rounded p-3 mb-3">
            Error: {(error as Error).message}
          </div>
        )}
        {isLoading || !data ? (
          <div className="h-[380px] bg-soft/50 rounded animate-pulse" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={380}>
              {viewMode === "lines" ? (
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={fmtTickX} minTickGap={20} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
                      : Math.abs(v) >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
                      : `$${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(Number(value ?? 0)), String(name ?? "")]}
                    labelFormatter={(l) => `Periodo: ${l}`}
                    contentStyle={{ borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {CHANNEL_KEYS.map((ch) => (
                    !hiddenChannels.has(ch) && (
                      <Line
                        key={ch}
                        type="monotone"
                        dataKey={ch}
                        name={data.channel_labels[ch] ?? ch}
                        stroke={CHANNEL_COLORS[ch]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    )
                  ))}
                </ComposedChart>
              ) : viewMode === "stacked" ? (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={fmtTickX} minTickGap={20} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
                      : Math.abs(v) >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
                      : `$${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(Number(value ?? 0)), String(name ?? "")]}
                    labelFormatter={(l) => `Periodo: ${l}`}
                    contentStyle={{ borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {CHANNEL_KEYS.map((ch) => (
                    !hiddenChannels.has(ch) && (
                      <Bar
                        key={ch}
                        dataKey={ch}
                        name={data.channel_labels[ch] ?? ch}
                        stackId="rev"
                        fill={CHANNEL_COLORS[ch]}
                        isAnimationActive={false}
                      />
                    )
                  ))}
                </BarChart>
              ) : (
                /* share100: area chart normalizado */
                <AreaChart data={chartData} stackOffset="expand">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={fmtTickX} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip
                    formatter={(value, name) => [`${Number(value ?? 0).toFixed(1)}%`, String(name ?? "")]}
                    labelFormatter={(l) => `Periodo: ${l}`}
                    contentStyle={{ borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {CHANNEL_KEYS.map((ch) => (
                    !hiddenChannels.has(ch) && (
                      <Area
                        key={ch}
                        type="monotone"
                        dataKey={ch}
                        name={data.channel_labels[ch] ?? ch}
                        stackId="rev"
                        stroke={CHANNEL_COLORS[ch]}
                        fill={CHANNEL_COLORS[ch]}
                        fillOpacity={0.7}
                        isAnimationActive={false}
                      />
                    )
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>

            {/* Toggle de canales debajo del chart */}
            <div className="mt-4 flex flex-wrap gap-2">
              {CHANNEL_KEYS.map((ch) => {
                const hidden = hiddenChannels.has(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      "inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition",
                      hidden ? "opacity-40 bg-soft border-border" : "bg-white border-border hover:border-primary/40",
                    )}
                    title={hidden ? "Click para mostrar" : "Click para ocultar"}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[ch] }} />
                    <span className="font-medium text-text">{data.channel_labels[ch] ?? ch}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Share donuts: por canal + por unidad */}
      {data && !isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="text-sm font-bold text-text mb-1">Share por canal · ventana {windowSel}</h3>
            <p className="text-[11px] text-text-muted mb-3">
              Total {formatCurrency(data.channel_share.total)} repartido entre 5 canales operativos
            </p>
            <DonutChart
              caption={`Mix por canal`}
              data={data.channel_share.by_channel.map((c) => ({ name: c.label, value: c.revenue }))}
              colorMap={Object.fromEntries(
                data.channel_share.by_channel.map((c) => [c.label, CHANNEL_COLORS[c.channel] ?? "#888"]),
              )}
              height={260}
            />
            <div className="mt-3 space-y-1">
              {data.channel_share.by_channel.map((c) => (
                <div key={c.channel} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm" style={{ background: CHANNEL_COLORS[c.channel] }} />
                    <span className="text-text">{c.label}</span>
                  </span>
                  <span className="tabular-nums text-text-muted">
                    {formatCurrency(c.revenue)} <strong className="text-text">({c.share_pct.toFixed(1)}%)</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="text-sm font-bold text-text mb-1">Share por unidad de negocio</h3>
            <p className="text-[11px] text-text-muted mb-3">
              Contribución relativa de cada unidad al revenue total
            </p>
            <DonutChart
              caption="Mix por unidad"
              data={data.channel_share.by_unit.map((u) => ({ name: u.label, value: u.revenue }))}
              colorMap={Object.fromEntries(
                data.channel_share.by_unit.map((u) => [u.label, UNIT_COLORS[u.unit] ?? "#888"]),
              )}
              height={260}
            />
            <div className="mt-3 space-y-1.5">
              {data.channel_share.by_unit.map((u) => (
                <div key={u.unit} className="bg-soft rounded-lg p-2 text-xs flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: UNIT_COLORS[u.unit] }} />
                    <span className="font-semibold text-text">{u.label}</span>
                  </span>
                  <span className="tabular-nums">
                    <strong className="text-text">{u.share_pct.toFixed(1)}%</strong>
                    <span className="text-text-muted ml-2">{formatCurrency(u.revenue)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top SKUs por GANANCIA + Top clientes por GANANCIA */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TopSkusByProfitTable data={data?.top_skus_by_profit} loading={isLoading} window={windowSel} />
        <TopCustomersByProfitTable data={data?.top_customers} loading={isLoading} window={windowSel} />
      </div>

      {data && (
        <div className="text-[10px] text-text-muted text-right">
          Datos generados: {new Date(data.generated_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">{label}</div>
      <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">{children}</div>
    </div>
  );
}

function ControlButton({
  children, active, onClick,
}: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs font-semibold rounded-md transition",
        active ? "bg-white text-text shadow-sm" : "text-text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function TopSkusByProfitTable({
  data, loading, window,
}: { data: CommercialResponse["top_skus_by_profit"] | undefined; loading: boolean; window: Window }) {
  if (loading || !data) {
    return <div className="h-[480px] bg-surface border border-border rounded-xl animate-pulse" />;
  }
  if (data.error) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-text mb-2">Top SKUs por ganancia neta</h3>
        <div className="text-xs text-error">Error: {data.error}</div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text">Top 20 SKUs por ganancia neta · {window}</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            Unistore (TN + ML) · ganancia descuenta IVA, IIBB, gateway fee y costo de mercadería con IVA
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ganancia total</div>
          <div className="text-base font-extrabold text-success tabular-nums">{formatCurrency(data.total_profit_period)}</div>
        </div>
      </div>
      {data.without_cost_count > 0 && (
        <div className="mb-3 text-[10px] bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-800">
          ⚠ {data.without_cost_count} SKUs vendidos sin costo cargado · ganancia subestimada.{" "}
          <Link href="/dashboard/costos" className="underline font-semibold">Cargar costos</Link>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left font-semibold py-2 pr-2">#</th>
              <th className="text-left font-semibold py-2 px-2">SKU · Producto</th>
              <th className="text-right font-semibold py-2 px-2">Unid</th>
              <th className="text-right font-semibold py-2 px-2">Revenue</th>
              <th className="text-right font-semibold py-2 px-2">Ganancia</th>
              <th className="text-right font-semibold py-2 px-2">Margen</th>
              <th className="text-right font-semibold py-2 pl-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.sku} className="border-b border-border/50 last:border-0 hover:bg-soft/40 transition">
                <td className="py-2 pr-2 text-text-muted tabular-nums">{i + 1}</td>
                <td className="py-2 px-2">
                  <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                        className="font-semibold text-primary hover:underline">
                    {r.sku}
                  </Link>
                  <div className="text-[10px] text-text-muted truncate max-w-[200px]" title={r.name}>{r.name}</div>
                  <div className="text-[9px] text-text-muted mt-0.5">
                    TN {r.units_tn}u · ML {r.units_ml}u
                  </div>
                </td>
                <td className="text-right tabular-nums py-2 px-2 font-bold">{r.units}</td>
                <td className="text-right tabular-nums py-2 px-2">
                  {formatCurrency(r.revenue)}
                  <div className="text-[9px] text-text-muted">
                    TN {formatCurrency(r.rev_tn)} · ML {formatCurrency(r.rev_ml)}
                  </div>
                </td>
                <td className="text-right tabular-nums py-2 px-2 font-bold text-success">
                  {formatCurrency(r.ganancia_neta)}
                </td>
                <td className="text-right tabular-nums py-2 px-2 font-semibold">{r.margen_pct.toFixed(1)}%</td>
                <td className="text-right tabular-nums py-2 pl-2">
                  <span className="inline-flex items-center gap-1">
                    <div className="w-12 bg-soft rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, r.share_pct * 3)}%` }} />
                    </div>
                    <strong>{r.share_pct.toFixed(1)}%</strong>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopCustomersByProfitTable({
  data, loading, window,
}: { data: CommercialResponse["top_customers"] | undefined; loading: boolean; window: Window }) {
  if (loading || !data) {
    return <div className="h-[480px] bg-surface border border-border rounded-xl animate-pulse" />;
  }
  if (data.error) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-text mb-2">Top clientes por ganancia</h3>
        <div className="text-xs text-error">Error: {data.error}</div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text">Top 20 clientes por ganancia · {window}</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            Unistore (TN + ML) · ganancia estimada = revenue × margen promedio del periodo
            <strong className="text-text"> ({data.margen_promedio_usado_pct.toFixed(1)}%)</strong>
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left font-semibold py-2 pr-2">#</th>
              <th className="text-left font-semibold py-2 px-2">Cliente</th>
              <th className="text-left font-semibold py-2 px-2">Canal</th>
              <th className="text-right font-semibold py-2 px-2">Órdenes</th>
              <th className="text-right font-semibold py-2 px-2">Revenue</th>
              <th className="text-right font-semibold py-2 pl-2">Ganancia est.</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.customer_key} className="border-b border-border/50 last:border-0 hover:bg-soft/40 transition">
                <td className="py-2 pr-2 text-text-muted tabular-nums">{i + 1}</td>
                <td className="py-2 px-2">
                  <div className="font-semibold text-text truncate max-w-[180px]" title={r.nombre}>
                    {r.nombre || "—"}
                  </div>
                  {r.last_order && (
                    <div className="text-[9px] text-text-muted">Última: {r.last_order.slice(0, 10)}</div>
                  )}
                </td>
                <td className="py-2 px-2">
                  <span className={cn(
                    "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    r.channel === "tn" ? "bg-violet-100 text-violet-800" : "bg-amber-100 text-amber-800",
                  )}>
                    {r.channel_label}
                  </span>
                </td>
                <td className="text-right tabular-nums py-2 px-2">{r.ordenes}</td>
                <td className="text-right tabular-nums py-2 px-2">{formatCurrency(r.revenue)}</td>
                <td className="text-right tabular-nums py-2 pl-2 font-bold text-success">
                  {formatCurrency(r.ganancia_estimada)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
