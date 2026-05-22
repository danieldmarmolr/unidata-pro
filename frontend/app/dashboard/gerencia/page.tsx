"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, Coins, ShieldCheck, Wallet,
  Users, Crown, Package, LineChart as LineIcon, Megaphone, Bell, Headphones, Boxes,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, cn } from "@/lib/utils";

type SkuProfitRow = {
  sku: string;
  units: number;
  revenue: number;
  costo: number;
  ganancia_neta: number;
  margen_pct: number;
  rev_tn: number;
  rev_ml: number;
};

type UnistoreProfit = {
  unit: "unistore";
  revenue: number;
  revenue_con_costo: number;
  costo: number;
  ganancia_neta: number;
  margen_pct: number;
  cobertura_costos_pct: number;
  skus_con_costo: number;
  skus_sin_costo: number;
  top10_skus_by_profit: SkuProfitRow[];
  bottom_skus_low_margin: SkuProfitRow[];
};

type UnidropProfit = {
  unit: "unidrop";
  facturacion: number;
  comisiones: number;
  egresos_operativos: number;
  ganancia_neta: number;
  margen_pct: number;
};

type GerenciaResponse = {
  period: string;
  unistore: UnistoreProfit;
  unidrop: UnidropProfit;
  consolidado: {
    revenue: number;
    ganancia_neta: number;
    margen_pct: number;
    cobertura_costos_unistore_pct: number;
  };
  deuda_talo_pendiente: number;
  profit_series_90d: {
    days: number;
    points: { date: string; ganancia_tn: number; ganancia_ml: number; ganancia_total: number; revenue_total: number }[];
  };
  generated_at: string;
};

type DropshipperRow = {
  user_id: number;
  nombre: string;
  plan?: string;
  canal?: string;
  gmv: number;
  profit_unidrop: number;
  ventas_pagadas: number;
  deuda_pendiente?: number;
};

type Segment = {
  key: string;
  label: string;
  color?: string;
  customers: number;
  pct_total?: number;
  monetary_total?: number;
  ticket_avg?: number;
};

type CohortState = {
  key: string;
  label: string;
  color?: string;
  customers: number;
  ordenes: number;
  facturacion: number;
};

type ForecastRow = {
  sku: string;
  nombre?: string;
  stock_actual: number;
  daily_velocity: number;
  days_until_stockout: number;
  forecast_30d?: number;
  po_sugerida_30d?: number;
  units_30d?: number;
};

type Gerencia360Response = {
  dropshippers: {
    period: string;
    total_dropshippers?: number;
    top10_by_profit: DropshipperRow[];
    bottom5_criticos: DropshipperRow[];
    error: string | null;
  };
  customer_intelligence: {
    rfm?: { totals: { customers?: number; monetary?: number }; segments: Segment[] } | { error: string };
    cohorts_unidrop?: { totals: { customers?: number; facturacion?: number }; states: CohortState[] } | { error: string };
    error?: string | null;
  };
  forecast_stock_health: {
    riesgo_quiebre_30d: ForecastRow[];
    sobre_stock: ForecastRow[];
    summary?: { alerts_30d?: number; total_skus?: number };
    error: string | null;
  };
  cash_flow_30d: {
    saldo_inicial: number;
    saldo_final_30d: number;
    total_ingresos_proyectados: number;
    total_egresos_comprometidos: number;
    neto_30d: number;
    runway_meses: number | null;
    saldo_serie: { date: string; saldo: number }[];
    acuerdos_urgentes: Array<{ id: number; compromiso: string; fecha?: string; monto?: number | null; urgencia?: string; proveedor_nombre?: string }>;
    error: string | null;
  };
  ops_counts: {
    it_alerts_pending: number | null;
    it_alerts_critical: number | null;
    cs_actions_pending: number | null;
    stock_critical_zones: number | null;
    meta_ads_roas: number | null;
    meta_ads_hint?: string | null;
  };
  generated_at: string;
};

function HeroCard({
  label,
  value,
  hint,
  variant = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "success" | "warning" | "error";
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const styles = {
    default: "from-primary/10 to-accent/10 border-primary/20 text-text",
    success: "from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900",
    warning: "from-amber-50 to-amber-100 border-amber-200 text-amber-900",
    error: "from-rose-50 to-rose-100 border-rose-200 text-rose-900",
  }[variant];

  return (
    <div className={cn("bg-gradient-to-br border rounded-2xl p-6 shadow-sm", styles)}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={14} className="opacity-70" />}
        <div className="text-[11px] uppercase tracking-wider font-bold opacity-70">{label}</div>
      </div>
      <div className="text-4xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs mt-2 opacity-80">{hint}</div>}
    </div>
  );
}

function UnitProfitCard({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: { label: string; value: number; prefix?: string; suffix?: string; hint?: string; muted?: boolean; negative?: boolean }[];
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-7 rounded-full" style={{ backgroundColor: color }} />
        <div className="text-sm font-bold text-text">{title}</div>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <div className="text-xs text-text-muted">{r.label}</div>
            <div
              className={cn(
                "text-base font-bold tabular-nums",
                r.muted && "text-text-muted",
                r.negative && "text-error",
              )}
            >
              {r.prefix ?? ""}
              {typeof r.value === "number" ? new Intl.NumberFormat("es-AR").format(Math.round(r.value)) : r.value}
              {r.suffix ?? ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkuProfitTable({
  title,
  rows,
  emphasisColumn = "ganancia_neta",
  negativeStyle = false,
}: {
  title: string;
  rows: SkuProfitRow[];
  emphasisColumn?: "ganancia_neta" | "margen_pct";
  negativeStyle?: boolean;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-2">{title}</div>
        <div className="text-xs text-text-muted italic py-8 text-center">Sin SKUs en el periodo</div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="text-sm font-bold text-text mb-3">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left font-semibold py-2 pr-2">SKU</th>
              <th className="text-right font-semibold py-2 px-2">Uds</th>
              <th className="text-right font-semibold py-2 px-2">Ingreso</th>
              <th className="text-right font-semibold py-2 px-2">Costo</th>
              <th className="text-right font-semibold py-2 px-2">Ganancia</th>
              <th className="text-right font-semibold py-2 pl-2">Margen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ganNeg = r.ganancia_neta < 0;
              return (
                <tr key={r.sku} className="border-b border-border/50 last:border-0 hover:bg-soft/40 transition">
                  <td className="py-2 pr-2">
                    <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`} className="font-medium text-primary hover:underline">
                      {r.sku}
                    </Link>
                    <div className="text-[10px] text-text-muted">
                      TN: {formatCurrency(r.rev_tn)} · ML: {formatCurrency(r.rev_ml)}
                    </div>
                  </td>
                  <td className="text-right tabular-nums py-2 px-2">{r.units}</td>
                  <td className="text-right tabular-nums py-2 px-2">{formatCurrency(r.revenue)}</td>
                  <td className="text-right tabular-nums py-2 px-2 text-text-muted">{formatCurrency(r.costo)}</td>
                  <td
                    className={cn(
                      "text-right tabular-nums py-2 px-2 font-bold",
                      emphasisColumn === "ganancia_neta" && (ganNeg || negativeStyle ? "text-error" : "text-success"),
                    )}
                  >
                    {formatCurrency(r.ganancia_neta)}
                  </td>
                  <td
                    className={cn(
                      "text-right tabular-nums py-2 pl-2 font-bold",
                      emphasisColumn === "margen_pct" && (ganNeg || negativeStyle ? "text-error" : "text-success"),
                    )}
                  >
                    {r.margen_pct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoberturaBadge({ pct }: { pct: number }) {
  const variant = pct >= 75 ? "success" : pct >= 50 ? "warning" : "error";
  const label = pct >= 75 ? "Confiable" : pct >= 50 ? "Parcial" : "Baja cobertura";
  const styles = {
    success: "bg-emerald-100 text-emerald-800 border-emerald-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    error: "bg-rose-100 text-rose-800 border-rose-200",
  }[variant];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", styles)}>
      <ShieldCheck size={10} />
      {label}
    </span>
  );
}

export default function GerenciaPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);
  const [opsOpen, setOpsOpen] = useState(true);

  const { data, isLoading, error, refetch } = useQuery<GerenciaResponse>({
    queryKey: ["dashboards", "gerencia", period, customFrom, customTo],
    queryFn: () => api<GerenciaResponse>(`/api/dashboards/gerencia?${qs}`),
    staleTime: 5 * 60_000,
  });

  // Bloques 360 (Fase 2 + 3) — periodo simple, no usa custom range
  const periodSimple = period === "custom" ? "30d" : period;
  const { data: d360, isLoading: loading360 } = useQuery<Gerencia360Response>({
    queryKey: ["dashboards", "gerencia360", periodSimple],
    queryFn: () => api<Gerencia360Response>(`/api/dashboards/gerencia/360?period=${periodSimple}`),
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <Topbar
        title="Gerencia 360"
        subtitle="Ganancia real cross-organizacion · Unistore + Unidrop · descuenta IVA, IIBB, gateway fees y egresos operativos"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error cargando Gerencia 360: {(error as Error).message}{" "}
            <button onClick={() => refetch()} className="underline ml-2">Reintentar</button>
          </div>
        )}

        {/* Hero KPIs — ganancia neta consolidada */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[140px] bg-surface border border-border rounded-2xl animate-pulse" />
            ))
          ) : (
            <>
              <HeroCard
                label="Ganancia Neta Consolidada"
                value={formatCurrency(data.consolidado.ganancia_neta)}
                hint={`sobre ${formatCurrency(data.consolidado.revenue)} de revenue total`}
                variant={data.consolidado.ganancia_neta >= 0 ? "success" : "error"}
                icon={Coins}
              />
              <HeroCard
                label="Margen Consolidado"
                value={`${data.consolidado.margen_pct.toFixed(1)}%`}
                hint="(ganancia / revenue total)"
                variant={data.consolidado.margen_pct >= 10 ? "success" : data.consolidado.margen_pct >= 0 ? "warning" : "error"}
                icon={data.consolidado.margen_pct >= 0 ? TrendingUp : TrendingDown}
              />
              <HeroCard
                label="Cobertura de Costos Unistore"
                value={`${data.consolidado.cobertura_costos_unistore_pct.toFixed(1)}%`}
                hint={`${data.unistore.skus_con_costo} SKUs con costo · ${data.unistore.skus_sin_costo} sin cargar`}
                variant={data.consolidado.cobertura_costos_unistore_pct >= 75 ? "success" : data.consolidado.cobertura_costos_unistore_pct >= 50 ? "warning" : "error"}
                icon={ShieldCheck}
              />
              <HeroCard
                label="Deuda Talo pendiente"
                value={formatCurrency(data.deuda_talo_pendiente)}
                hint="Subs PaymentIntent en PENDING — por cobrar"
                variant={data.deuda_talo_pendiente > 0 ? "warning" : "default"}
                icon={Wallet}
              />
            </>
          )}
        </div>

        {/* Cobertura warning */}
        {data && data.consolidado.cobertura_costos_unistore_pct < 75 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex items-start gap-2 text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <strong>Cobertura de costos parcial.</strong> Solo el {data.consolidado.cobertura_costos_unistore_pct.toFixed(1)}% del revenue Unistore tiene costo cargado.
              La "ganancia real" es una estimación basada en los SKUs con lote de costo subido.
              <Link href="/dashboard/costos" className="ml-2 underline font-semibold">Cargar costos faltantes →</Link>
            </div>
          </div>
        )}

        {/* Desglose por unidad */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3">
          Desglose por unidad
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[260px] bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <UnitProfitCard
                title="Unistore (TN + ML)"
                color="#5b8def"
                rows={[
                  { label: "Revenue total", value: data.unistore.revenue, prefix: "$ " },
                  { label: "Revenue con costo cargado", value: data.unistore.revenue_con_costo, prefix: "$ ", muted: true },
                  { label: "Costo de mercaderia (con IVA)", value: data.unistore.costo, prefix: "$ ", muted: true },
                  { label: "Ganancia neta", value: data.unistore.ganancia_neta, prefix: "$ ", negative: data.unistore.ganancia_neta < 0 },
                  { label: "Margen", value: data.unistore.margen_pct, suffix: " %", negative: data.unistore.margen_pct < 0 },
                ]}
              />
              <UnitProfitCard
                title="Unidrop (servicios)"
                color="#a855f7"
                rows={[
                  { label: "Facturacion Contabilium", value: data.unidrop.facturacion, prefix: "$ " },
                  { label: "− Comisiones Talo", value: data.unidrop.comisiones, prefix: "$ ", muted: true },
                  { label: "− Egresos operativos", value: data.unidrop.egresos_operativos, prefix: "$ ", muted: true },
                  { label: "Ganancia neta", value: data.unidrop.ganancia_neta, prefix: "$ ", negative: data.unidrop.ganancia_neta < 0 },
                  { label: "Margen", value: data.unidrop.margen_pct, suffix: " %", negative: data.unidrop.margen_pct < 0 },
                ]}
              />
            </>
          )}
        </div>

        {/* Serie 90d ganancia diaria */}
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-text">Ganancia diaria Unistore 90d (TN + ML)</div>
            <div className="text-[10px] text-text-muted">SKUs con costo cargado · neto de IVA/IIBB/fee</div>
          </div>
          {isLoading || !data ? (
            <div className="h-[280px] bg-soft/50 rounded animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.profit_series_90d.points}>
                <defs>
                  <linearGradient id="profitTn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5b8def" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#5b8def" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitMl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#facc15" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                  labelStyle={{ color: "#111" }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="ganancia_tn"
                  name="TN"
                  stackId="1"
                  stroke="#5b8def"
                  fill="url(#profitTn)"
                />
                <Area
                  type="monotone"
                  dataKey="ganancia_ml"
                  name="MELI"
                  stackId="1"
                  stroke="#facc15"
                  fill="url(#profitMl)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top + Bottom SKUs por ganancia */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3">
          Productos Unistore por ganancia
          {data && (
            <span className="ml-3 font-normal text-text-muted normal-case">
              <CoberturaBadge pct={data.consolidado.cobertura_costos_unistore_pct} />
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[360px] bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <SkuProfitTable
                title="Top 10 SKUs por ganancia neta $"
                rows={data.unistore.top10_skus_by_profit}
                emphasisColumn="ganancia_neta"
              />
              <SkuProfitTable
                title="SKUs con margen <5% — revisar precio o costo"
                rows={data.unistore.bottom_skus_low_margin}
                emphasisColumn="margen_pct"
                negativeStyle
              />
            </>
          )}
        </div>

        {/* ============================================================== */}
        {/* FASE 2 — 360 enriquecido                                          */}
        {/* ============================================================== */}

        {/* Dropshippers performance */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
          <Crown size={12} /> Performance Dropshippers
          {d360?.dropshippers?.total_dropshippers ? (
            <span className="font-normal normal-case text-text-muted">· {d360.dropshippers.total_dropshippers} activos</span>
          ) : null}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {loading360 || !d360 ? (
            <>
              <div className="h-[300px] bg-surface border border-border rounded-xl animate-pulse" />
              <div className="h-[300px] bg-surface border border-border rounded-xl animate-pulse" />
            </>
          ) : (
            <>
              <DropshippersList
                title="Top 10 por ganancia Unidrop"
                emptyMsg={d360.dropshippers.error || "Sin dropshippers con ganancia en el periodo"}
                rows={d360.dropshippers.top10_by_profit}
                emphasis="profit"
              />
              <DropshippersList
                title="Criticos — deuda o margen negativo"
                emptyMsg={d360.dropshippers.error || "Sin criticos en el periodo"}
                rows={d360.dropshippers.bottom5_criticos}
                emphasis="deuda"
              />
            </>
          )}
        </div>

        {/* Customer Intelligence */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
          <Users size={12} /> Customer Intelligence
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {loading360 || !d360 ? (
            <>
              <div className="h-[320px] bg-surface border border-border rounded-xl animate-pulse" />
              <div className="h-[320px] bg-surface border border-border rounded-xl animate-pulse" />
            </>
          ) : (
            <>
              <RfmSummary data={d360.customer_intelligence?.rfm} />
              <CohortsSummary data={d360.customer_intelligence?.cohorts_unidrop} />
            </>
          )}
        </div>

        {/* Forecast & Stock health */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
          <Package size={12} /> Forecast & Stock Health
          {d360?.forecast_stock_health?.summary?.alerts_30d ? (
            <span className="font-normal normal-case text-rose-700">· {d360.forecast_stock_health.summary.alerts_30d} alertas 30d</span>
          ) : null}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {loading360 || !d360 ? (
            <>
              <div className="h-[280px] bg-surface border border-border rounded-xl animate-pulse" />
              <div className="h-[280px] bg-surface border border-border rounded-xl animate-pulse" />
            </>
          ) : (
            <>
              <ForecastList
                title="Riesgo quiebre <30d"
                rows={d360.forecast_stock_health.riesgo_quiebre_30d}
                tone="rose"
                emptyMsg={d360.forecast_stock_health.error || "Sin SKUs en riesgo en este momento"}
              />
              <ForecastList
                title="Sobre-stock — DoI alto"
                rows={d360.forecast_stock_health.sobre_stock}
                tone="amber"
                emptyMsg={d360.forecast_stock_health.error || "Sin SKUs con DoI alto"}
              />
            </>
          )}
        </div>

        {/* Cash flow proyectado */}
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
          <LineIcon size={12} /> Cash Flow Proyectado 30d
        </div>
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          {loading360 || !d360 ? (
            <div className="h-[260px] animate-pulse bg-soft/50 rounded" />
          ) : d360.cash_flow_30d.error ? (
            <div className="text-sm text-text-muted py-8 text-center">
              No se pudo construir la proyeccion: {d360.cash_flow_30d.error}.{" "}
              <Link href="/dashboard/finanzas/flujo-fondos" className="text-primary underline">Abrir flujo de fondos</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <CashCell label="Saldo inicial" value={d360.cash_flow_30d.saldo_inicial} />
                <CashCell label="Ingresos proyectados" value={d360.cash_flow_30d.total_ingresos_proyectados} tone="emerald" />
                <CashCell label="Egresos comprometidos" value={-d360.cash_flow_30d.total_egresos_comprometidos} tone="rose" />
                <CashCell label="Neto 30d" value={d360.cash_flow_30d.neto_30d} bold />
                <CashCell label="Saldo final 30d" value={d360.cash_flow_30d.saldo_final_30d} bold />
              </div>
              {d360.cash_flow_30d.runway_meses !== null && d360.cash_flow_30d.runway_meses !== undefined && (
                <div className="mb-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold border border-amber-200">
                  <AlertTriangle size={12} />
                  Runway estimado: {d360.cash_flow_30d.runway_meses} meses al ritmo actual
                </div>
              )}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={d360.cash_flow_30d.saldo_serie}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                  <Line type="monotone" dataKey="saldo" stroke="#a855f7" strokeWidth={2} dot={false} name="Saldo final dia" />
                </LineChart>
              </ResponsiveContainer>
              {d360.cash_flow_30d.acuerdos_urgentes.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Acuerdos urgentes</div>
                  <div className="space-y-1.5">
                    {d360.cash_flow_30d.acuerdos_urgentes.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-soft">
                        <div className="truncate">
                          <span className="font-semibold text-text">{a.compromiso}</span>
                          {a.proveedor_nombre && <span className="text-text-muted"> · {a.proveedor_nombre}</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {a.monto !== null && a.monto !== undefined && (
                            <span className="font-bold tabular-nums">{formatCurrency(a.monto)}</span>
                          )}
                          {a.urgencia && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                              a.urgencia === "vencido" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                            )}>
                              {a.urgencia}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link href="/dashboard/finanzas/flujo-fondos" className="text-xs text-primary underline mt-3 inline-block">
                    Ver flujo de fondos completo →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        {/* ============================================================== */}
        {/* FASE 3 — Centro de operaciones                                    */}
        {/* ============================================================== */}
        {d360?.ops_counts && (
          <div className="bg-surface border border-border rounded-xl mb-6">
            <button
              type="button"
              onClick={() => setOpsOpen((o) => !o)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-soft/30 transition rounded-xl"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600" />
                <span className="text-sm font-bold text-text">Centro de operaciones</span>
                <span className="text-[10px] text-text-muted">contadores rapidos de salud operativa</span>
              </div>
              {opsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {opsOpen && (
              <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                <OpsCard
                  label="Alertas IT"
                  value={d360.ops_counts.it_alerts_pending}
                  hint={d360.ops_counts.it_alerts_critical ? `${d360.ops_counts.it_alerts_critical} criticas` : "salud OK"}
                  icon={Bell}
                  href="/dashboard/notificaciones"
                  tone={d360.ops_counts.it_alerts_critical ? "rose" : "default"}
                />
                <OpsCard
                  label="CS Actions pendientes"
                  value={d360.ops_counts.cs_actions_pending}
                  icon={Headphones}
                  href="/dashboard/cs-acciones"
                  tone={(d360.ops_counts.cs_actions_pending ?? 0) > 10 ? "amber" : "default"}
                />
                <OpsCard
                  label="Zonas stock critico"
                  value={d360.ops_counts.stock_critical_zones}
                  hint="<=5 unidades en Digip"
                  icon={Boxes}
                  href="/dashboard/stock-heatmap"
                  tone={(d360.ops_counts.stock_critical_zones ?? 0) > 0 ? "amber" : "default"}
                />
                <OpsCard
                  label="Meta Ads ROAS"
                  value={d360.ops_counts.meta_ads_roas}
                  hint={d360.ops_counts.meta_ads_hint || "ultimo periodo"}
                  icon={Megaphone}
                  href="/dashboard/marketing"
                  tone="default"
                  isCurrency={false}
                />
              </div>
            )}
          </div>
        )}

        {data && (
          <div className="text-[10px] text-text-muted text-right">
            Generado: {new Date(data.generated_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================
// FASE 2 — Subcomponentes
// ============================================================

function DropshippersList({
  title,
  rows,
  emptyMsg,
  emphasis,
}: {
  title: string;
  rows: DropshipperRow[];
  emptyMsg: string;
  emphasis: "profit" | "deuda";
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-2">{title}</div>
        <div className="text-xs text-text-muted italic py-8 text-center">{emptyMsg}</div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="text-sm font-bold text-text mb-3">{title}</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <Link
            key={r.user_id}
            href={`/dashboard/dropshipper/${r.user_id}`}
            className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-soft hover:bg-soft/70 transition group"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-text truncate group-hover:text-primary">{r.nombre}</div>
              <div className="text-[10px] text-text-muted truncate">
                {r.plan && <span>{r.plan}</span>}
                {r.canal && <span> · {r.canal}</span>}
                <span> · {r.ventas_pagadas} ventas</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              {emphasis === "profit" ? (
                <>
                  <div className="font-bold text-success tabular-nums">{formatCurrency(r.profit_unidrop)}</div>
                  <div className="text-[10px] text-text-muted">gmv {formatCurrency(r.gmv)}</div>
                </>
              ) : (
                <>
                  <div className="font-bold text-error tabular-nums">{formatCurrency(r.deuda_pendiente ?? 0)}</div>
                  <div className="text-[10px] text-text-muted">
                    {r.profit_unidrop < 0 ? `prof ${formatCurrency(r.profit_unidrop)}` : `gmv ${formatCurrency(r.gmv)}`}
                  </div>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function RfmSummary({ data }: { data: Gerencia360Response["customer_intelligence"]["rfm"] }) {
  if (!data || "error" in data) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-2">RFM — Unistore</div>
        <div className="text-xs text-text-muted italic py-8 text-center">
          {data && "error" in data ? `Error: ${data.error}` : "Sin datos RFM"}
        </div>
      </div>
    );
  }
  const totalCustomers = (data as any).totals?.customers ?? 0;
  const segments = (data as any).segments as Segment[];
  const maxCustomers = Math.max(1, ...segments.map((s) => s.customers));
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-text">RFM — Unistore (12m)</div>
        <Link href="/dashboard/rfm" className="text-[10px] text-primary underline">Ver detalle →</Link>
      </div>
      <div className="text-[10px] text-text-muted mb-3">
        {totalCustomers.toLocaleString("es-AR")} clientes · {formatCurrency((data as any).totals?.monetary ?? 0)} revenue
      </div>
      <div className="space-y-1.5">
        {segments.slice(0, 8).map((s) => (
          <div key={s.key} className="text-xs">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="font-medium text-text truncate max-w-[180px]">{s.label}</span>
              <span className="tabular-nums font-bold" style={{ color: s.color || "#5b8def" }}>
                {s.customers.toLocaleString("es-AR")}
              </span>
            </div>
            <div className="h-1.5 bg-soft rounded overflow-hidden">
              <div
                className="h-full"
                style={{ background: s.color || "#5b8def", width: `${(s.customers / maxCustomers) * 100}%` }}
              />
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {formatCurrency(s.monetary_total ?? 0)} · ticket {formatCurrency(s.ticket_avg ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohortsSummary({ data }: { data: Gerencia360Response["customer_intelligence"]["cohorts_unidrop"] }) {
  if (!data || "error" in data) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-2">Cohorts — Unidrop</div>
        <div className="text-xs text-text-muted italic py-8 text-center">
          {data && "error" in data ? `Error: ${data.error}` : "Sin cohorts Unidrop"}
        </div>
      </div>
    );
  }
  const totalCustomers = (data as any).totals?.customers ?? 0;
  const states = (data as any).states as CohortState[];
  const maxCustomers = Math.max(1, ...states.map((s) => s.customers));
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-text">Cohorts dropshippers — Unidrop (90d)</div>
        <Link href="/dashboard/cohortes" className="text-[10px] text-primary underline">Ver detalle →</Link>
      </div>
      <div className="text-[10px] text-text-muted mb-3">
        {totalCustomers.toLocaleString("es-AR")} dropshippers · {formatCurrency((data as any).totals?.facturacion ?? 0)} facturacion
      </div>
      <div className="space-y-1.5">
        {states.map((s) => (
          <div key={s.key} className="text-xs">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="font-medium text-text truncate max-w-[180px]">{s.label}</span>
              <span className="tabular-nums font-bold" style={{ color: s.color || "#a855f7" }}>
                {s.customers.toLocaleString("es-AR")}
              </span>
            </div>
            <div className="h-1.5 bg-soft rounded overflow-hidden">
              <div
                className="h-full"
                style={{ background: s.color || "#a855f7", width: `${(s.customers / maxCustomers) * 100}%` }}
              />
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {s.ordenes} ordenes · {formatCurrency(s.facturacion)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastList({
  title,
  rows,
  tone,
  emptyMsg,
}: {
  title: string;
  rows: ForecastRow[];
  tone: "rose" | "amber";
  emptyMsg: string;
}) {
  const accent = tone === "rose" ? "text-rose-800" : "text-amber-800";
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className={cn("text-sm font-bold", accent)}>{title}</div>
        <div className="text-xs text-text-muted italic py-8 text-center">{emptyMsg}</div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className={cn("text-sm font-bold mb-3", accent)}>{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.sku}
            href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
            className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-soft hover:bg-soft/70 transition"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-primary truncate">{r.sku}</div>
              {r.nombre && <div className="text-[10px] text-text-muted truncate">{r.nombre}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className={cn("font-bold tabular-nums", accent)}>
                {tone === "rose"
                  ? `${r.days_until_stockout.toFixed(0)} d`
                  : `${r.days_until_stockout.toFixed(0)} d`}
              </div>
              <div className="text-[10px] text-text-muted">
                stock {r.stock_actual} · {r.daily_velocity.toFixed(1)}/dia
                {tone === "rose" && r.po_sugerida_30d ? ` · PO ${Math.round(r.po_sugerida_30d)}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CashCell({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose";
  bold?: boolean;
}) {
  const colorClass = tone === "emerald" ? "text-success" : tone === "rose" ? "text-error" : "text-text";
  return (
    <div className="bg-soft rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</div>
      <div className={cn("mt-1 tabular-nums", colorClass, bold ? "text-xl font-extrabold" : "text-base font-bold")}>
        {formatCurrency(value)}
      </div>
    </div>
  );
}

function OpsCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone,
  isCurrency = false,
}: {
  label: string;
  value: number | null;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  tone: "default" | "amber" | "rose";
  isCurrency?: boolean;
}) {
  const styles = {
    default: "bg-soft border-border text-text",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  }[tone];
  const display =
    value === null || value === undefined
      ? "—"
      : isCurrency
        ? formatCurrency(value)
        : value.toLocaleString("es-AR");
  return (
    <Link href={href} className={cn("border rounded-lg p-3 hover:shadow-md transition", styles)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className="opacity-70" />
        <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">{label}</div>
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{display}</div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5 truncate">{hint}</div>}
    </Link>
  );
}
