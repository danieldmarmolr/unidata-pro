"use client";

/**
 * Gerencia — vista unificada del grupo Unistore.
 *
 * Reemplaza la home anterior + Gerencia 360 en una sola pagina, organizada por
 * temas: Pulso HOY · Rentabilidad · Salud por unidad · Comercial · Clientes ·
 * Operaciones · Analisis post-venta.
 *
 * Endpoints consumidos:
 *  - /api/dashboards/executive               (KPIs originales, salud por unidad, mix)
 *  - /api/dashboards/gerencia                (ganancia real Unistore + Unidrop)
 *  - /api/dashboards/gerencia/360            (dropshippers, RFM, cohorts, forecast, cash, ops)
 *  - /api/dashboards/gerencia/profit-consolidated (serie diaria multi-unit + forecast multi-metodo)
 *  - /api/dashboards/customers-vip/overview  (tier cards VIP)
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  FileDown, TrendingUp, TrendingDown, AlertTriangle, Coins, ShieldCheck, Wallet,
  Users, Crown, Package, LineChart as LineIcon, Megaphone, Bell, Headphones, Boxes,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { RevenueChart, DONUT_COLORS, DONUT_TO_SERIES } from "@/components/revenue-chart";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { IntegrationHealthList } from "@/components/integration-health";
import { AlertsPanel } from "@/components/alerts-panel";
import { DrillDownModal } from "@/components/drilldown-modal";
import { CalcExplainModal } from "@/components/calc-explain-modal";
import { MetaEfficiencySection } from "@/components/meta-efficiency-section";
import { DailyMetricChart } from "@/components/daily-metric-chart";
import { CommercialSection } from "@/components/commercial-section";
import { api, getToken } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { ExecutiveOverview, CategoryValue, KpiCard as KpiCardT } from "@/lib/types";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { fmtArDateTime, todayArIso } from "@/lib/dates";

// =============================================================================
// TYPES (reutilizan los de la home original + los nuevos de gerencia 360)
// =============================================================================

type UnitMetric = {
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  delta?: number | null;
};

type UnitHealth = {
  unit: string;
  label: string;
  color: string;
  metrics: UnitMetric[];
};

type ExtendedExec = ExecutiveOverview & {
  revenue_mix?: CategoryValue[];
  unit_health?: UnitHealth[];
  top_products_cross?: CategoryValue[];
  lifecycle_mix?: CategoryValue[];
  unidev_analysis?: {
    top_motivos: CategoryValue[];
    top_resoluciones: CategoryValue[];
    top_skus: CategoryValue[];
  };
};

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

type MayoristaBreakdown = {
  precio_mayorista_total: number;
  costo_lote_total: number;
  ganancia_tn: number;
  ganancia_ml: number;
  precio_mayorista_tn: number;
  precio_mayorista_ml: number;
  costo_tn: number;
  costo_ml: number;
  skus_con_costo: number;
  skus_sin_costo: number;
  revenue_sin_costo: number;
  cobertura_pct: number;
  error: string | null;
};

type UnidropProfit = {
  unit: "unidrop";
  volumen_plataforma: number;
  volumen_tn: number;
  volumen_ml: number;
  costo_mercaderia: number;
  costo_tn: number;
  costo_ml: number;
  ordenes_pagadas: number;
  margen_bruto_plataforma: number;
  comisiones: number;
  suscripciones_cobradas: number;
  ganancia_mayorista: number;
  mayorista_breakdown: MayoristaBreakdown;
  ingresos_unidrop: number;
  meta_ads_spend: number;
  egresos_operativos: number;
  ganancia_neta: number;
  margen_pct: number;
  facturacion: number;
  facturacion_contabilium: number;
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

type Segment = { key: string; label: string; color?: string; customers: number; pct_total?: number; monetary_total?: number; ticket_avg?: number };
type CohortState = { key: string; label: string; color?: string; customers: number; ordenes: number; facturacion: number };
type ForecastRow = { sku: string; nombre?: string; stock_actual: number; daily_velocity: number; days_until_stockout: number; forecast_30d?: number; po_sugerida_30d?: number; units_30d?: number };

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

// =============================================================================
// SUBCOMPONENTES — Section header + bloques reutilizables
// =============================================================================

function SectionHeader({
  emoji,
  title,
  subtitle,
  number,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  number?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4 mt-2">
      {number && (
        <div className="text-[11px] font-extrabold text-text-muted tracking-wider tabular-nums">
          §{number}
        </div>
      )}
      <div>
        <h2 className="text-base font-extrabold text-text flex items-center gap-2">
          {emoji && <span>{emoji}</span>}
          <span>{title}</span>
        </h2>
        {subtitle && <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function HeroCard({
  label, value, hint, variant = "default", icon: Icon, onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "success" | "warning" | "error";
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void;
}) {
  const styles = {
    default: "from-primary/10 to-accent/10 border-primary/20 text-text",
    success: "from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900",
    warning: "from-amber-50 to-amber-100 border-amber-200 text-amber-900",
    error: "from-rose-50 to-rose-100 border-rose-200 text-rose-900",
  }[variant];
  const content = (
    <>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={14} className="opacity-70" />}
        <div className="text-[11px] uppercase tracking-wider font-bold opacity-70">{label}</div>
        {onClick && <span className="ml-auto text-[10px] opacity-50 group-hover:opacity-100 transition">cálc →</span>}
      </div>
      <div className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs mt-2 opacity-80">{hint}</div>}
    </>
  );
  if (!onClick) {
    return (
      <div className={cn("bg-gradient-to-br border rounded-2xl p-5 shadow-sm", styles)}>
        {content}
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={cn(
        "bg-gradient-to-br border rounded-2xl p-5 shadow-sm text-left group hover:shadow-md hover:-translate-y-0.5 transition cursor-pointer w-full",
        styles,
      )}
      title="Click para ver el cálculo detallado"
    >
      {content}
    </button>
  );
}

type ProfitRow = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  muted?: boolean;
  negative?: boolean;
  explainMetric?: string;
};

function UnitProfitCard({
  title, color, rows, onExplain,
}: {
  title: string;
  color: string;
  rows: ProfitRow[];
  onExplain?: (metric: string) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-7 rounded-full" style={{ backgroundColor: color }} />
        <div className="text-sm font-bold text-text">{title}</div>
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const isClickable = !!r.explainMetric && !!onExplain;
          const valueText = (r.prefix ?? "") +
            (typeof r.value === "number" ? new Intl.NumberFormat("es-AR").format(Math.round(r.value)) : r.value) +
            (r.suffix ?? "");
          const body = (
            <>
              <div className="text-xs text-text-muted flex items-center gap-1.5">
                {r.label}
                {isClickable && <span className="text-[9px] text-primary/70 opacity-0 group-hover/row:opacity-100 transition">cálc →</span>}
              </div>
              <div className={cn("text-base font-bold tabular-nums", r.muted && "text-text-muted", r.negative && "text-error")}>
                {valueText}
              </div>
            </>
          );
          if (!isClickable) {
            return (
              <div key={r.label} className="flex items-baseline justify-between gap-3 px-1.5 py-1">
                {body}
              </div>
            );
          }
          return (
            <button
              key={r.label}
              onClick={() => onExplain!(r.explainMetric!)}
              className="group/row w-full flex items-baseline justify-between gap-3 px-1.5 py-1 rounded hover:bg-soft/70 transition text-left cursor-pointer"
              title="Click para ver el cálculo detallado"
            >
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkuProfitTable({
  title, rows, emphasisColumn = "ganancia_neta", negativeStyle = false,
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
                  <td className={cn("text-right tabular-nums py-2 px-2 font-bold", emphasisColumn === "ganancia_neta" && (ganNeg || negativeStyle ? "text-error" : "text-success"))}>
                    {formatCurrency(r.ganancia_neta)}
                  </td>
                  <td className={cn("text-right tabular-nums py-2 pl-2 font-bold", emphasisColumn === "margen_pct" && (ganNeg || negativeStyle ? "text-error" : "text-success"))}>
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

function UnitHealthCardCmp({ u, drillCtx }: { u: UnitHealth; drillCtx: Parameters<typeof getCardDrill>[1] }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-8 rounded-full" style={{ backgroundColor: u.color }} />
        <div className="text-sm font-bold text-text">{u.label}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {u.metrics.map((m) => {
          const drill = getCardDrill(m.label, drillCtx);
          return <UnitMetricCell key={m.label} m={m} drill={drill} />;
        })}
      </div>
    </div>
  );
}

function UnitMetricCell({ m, drill }: { m: UnitMetric; drill: ReturnType<typeof getCardDrill> }) {
  const [open, setOpen] = useState(false);
  const interactive = !!drill;
  const content = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{m.label}</div>
      <div className="font-extrabold text-text mt-1 text-base tabular-nums">
        {m.prefix ?? ""}
        {typeof m.value === "number" ? formatNumber(m.value) : m.value}
        {m.suffix ?? ""}
      </div>
      {m.delta !== null && m.delta !== undefined && (
        <div className={cn("text-[10px] font-semibold mt-0.5", m.delta >= 0 ? "text-emerald-600" : "text-error")}>
          {m.delta >= 0 ? "+" : ""}
          {m.delta.toFixed(1)}% vs mes ant
        </div>
      )}
    </>
  );
  if (!interactive) {
    return <div className="bg-soft rounded-lg p-3">{content}</div>;
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="bg-soft rounded-lg p-3 text-left hover:bg-soft/70 transition cursor-pointer w-full">
        {content}
      </button>
      {open && drill && (
        <DrillDownModal
          title={drill.title ?? m.label}
          subtitle={drill.subtitle ?? ""}
          endpoint={drill.endpoint}
          filename={drill.filename ?? `${m.label.toLowerCase().replace(/\W+/g, "_")}.csv`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
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

function DropshippersList({
  title, rows, emptyMsg, emphasis,
}: {
  title: string; rows: DropshipperRow[]; emptyMsg: string; emphasis: "profit" | "deuda";
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
          <Link key={r.user_id} href={`/dashboard/dropshipper/${r.user_id}`}
                className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-soft hover:bg-soft/70 transition group">
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
  const totalCustomers = (data as { totals?: { customers?: number; monetary?: number } }).totals?.customers ?? 0;
  const segments = (data as { segments: Segment[] }).segments;
  const maxCustomers = Math.max(1, ...segments.map((s) => s.customers));
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-text">RFM — Unistore (12m)</div>
        <Link href="/dashboard/rfm" className="text-[10px] text-primary underline">Ver detalle →</Link>
      </div>
      <div className="text-[10px] text-text-muted mb-3">
        {totalCustomers.toLocaleString("es-AR")} clientes · {formatCurrency((data as { totals?: { monetary?: number } }).totals?.monetary ?? 0)} revenue
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
              <div className="h-full" style={{ background: s.color || "#5b8def", width: `${(s.customers / maxCustomers) * 100}%` }} />
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
  const totalCustomers = (data as { totals?: { customers?: number; facturacion?: number } }).totals?.customers ?? 0;
  const states = (data as { states: CohortState[] }).states;
  const maxCustomers = Math.max(1, ...states.map((s) => s.customers));
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-text">Cohorts dropshippers — Unidrop (90d)</div>
        <Link href="/dashboard/cohortes" className="text-[10px] text-primary underline">Ver detalle →</Link>
      </div>
      <div className="text-[10px] text-text-muted mb-3">
        {totalCustomers.toLocaleString("es-AR")} dropshippers · {formatCurrency((data as { totals?: { facturacion?: number } }).totals?.facturacion ?? 0)} facturacion
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
              <div className="h-full" style={{ background: s.color || "#a855f7", width: `${(s.customers / maxCustomers) * 100}%` }} />
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
  title, rows, tone, emptyMsg,
}: { title: string; rows: ForecastRow[]; tone: "rose" | "amber"; emptyMsg: string }) {
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
          <Link key={r.sku} href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-soft hover:bg-soft/70 transition">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-primary truncate">{r.sku}</div>
              {r.nombre && <div className="text-[10px] text-text-muted truncate">{r.nombre}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className={cn("font-bold tabular-nums", accent)}>{r.days_until_stockout.toFixed(0)} d</div>
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

function CashCell({ label, value, tone, bold }: { label: string; value: number; tone?: "emerald" | "rose"; bold?: boolean }) {
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
  label, value, hint, icon: Icon, href, tone, isCurrency = false,
}: {
  label: string; value: number | null; hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string; tone: "default" | "amber" | "rose"; isCurrency?: boolean;
}) {
  const styles = {
    default: "bg-soft border-border text-text",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  }[tone];
  const display = value === null || value === undefined ? "—" : isCurrency ? formatCurrency(value) : value.toLocaleString("es-AR");
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

function UnidevMiniTable({
  title, rows, color, suffix, extraKey, extraLabel,
}: {
  title: string; rows: CategoryValue[]; color: string; suffix?: string; extraKey?: string; extraLabel?: string;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">{title}</div>
        <div className="text-xs text-text-muted italic py-6 text-center">Sin datos en el periodo</div>
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-3">{title}</div>
      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r, i) => {
          const extra = (r as { extra?: Record<string, unknown> }).extra ?? {};
          const extraVal = extraKey ? (extra as Record<string, unknown>)[extraKey] : undefined;
          return (
            <div key={String(r.category) + i} className="text-xs">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-medium text-text truncate max-w-[200px]" title={String(r.category)}>{r.category}</span>
                <span className="tabular-nums font-bold" style={{ color }}>{formatNumber(r.value)}{suffix ?? ""}</span>
              </div>
              <div className="h-1.5 bg-soft rounded overflow-hidden">
                <div className="h-full" style={{ background: color, width: `${(r.value / max) * 100}%` }} />
              </div>
              {extraVal !== undefined && extraLabel && (
                <div className="text-[10px] text-text-muted mt-0.5">
                  {extraLabel}: <strong className="text-text">{String(extraVal)}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// VIP section (de la home original)
// =============================================================================

type VipOverview = {
  total_vips: number;
  tiers: {
    gold: { count: number; lifetime_total: number };
    silver: { count: number; lifetime_total: number };
    bronze: { count: number; lifetime_total: number };
  };
  lifetime_total: number;
  rules: Record<string, number>;
};

function VipKpiSection() {
  const [drillTier, setDrillTier] = useState<"all" | "gold" | "silver" | "bronze" | null>(null);
  const { data, isLoading } = useQuery<VipOverview>({
    queryKey: ["vip-overview"],
    queryFn: () => api<VipOverview>("/api/dashboards/customers-vip/overview"),
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-surface border border-border rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: "Total VIPs", count: data.total_vips, lifetime: data.lifetime_total, tier: "all" as const, icon: "★", bg: "from-violet-500 to-fuchsia-600", border: "border-violet-300" },
    { label: "VIP Gold", count: data.tiers.gold.count, lifetime: data.tiers.gold.lifetime_total, tier: "gold" as const, icon: "👑", bg: "from-yellow-400 to-amber-500", border: "border-amber-300" },
    { label: "VIP Silver", count: data.tiers.silver.count, lifetime: data.tiers.silver.lifetime_total, tier: "silver" as const, icon: "💎", bg: "from-slate-400 to-zinc-500", border: "border-slate-300" },
    { label: "VIP Bronze", count: data.tiers.bronze.count, lifetime: data.tiers.bronze.lifetime_total, tier: "bronze" as const, icon: "⭐", bg: "from-orange-400 to-amber-500", border: "border-amber-300" },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {cards.map((c) => (
          <button key={c.tier} onClick={() => setDrillTier(c.tier)}
                  className={`bg-surface border-2 ${c.border} rounded-xl p-4 hover:shadow-lg transition text-left group`}>
            <div className="flex items-start justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{c.label}</div>
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${c.bg} text-white flex items-center justify-center shadow-md text-lg`}>{c.icon}</div>
            </div>
            <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(c.count)}</div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Lifetime total: <span className="font-bold text-text">{formatCurrency(c.lifetime)}</span>
            </div>
          </button>
        ))}
      </div>
      {drillTier && (
        <DrillDownModal
          title={drillTier === "all" ? "Todos los clientes VIP" : `Clientes VIP · ${drillTier.toUpperCase()}`}
          subtitle="Click un cliente para abrir su perfil 360"
          endpoint={`/api/dashboards/customers-vip?tier=${drillTier}`}
          filename={`vip_${drillTier}.csv`}
          onClose={() => setDrillTier(null)}
        />
      )}
    </>
  );
}

function MayoristaDetailBlock({ breakdown, totalGanancia }: { breakdown: MayoristaBreakdown; totalGanancia: number }) {
  const [open, setOpen] = useState(false);
  const marginPct = breakdown.precio_mayorista_total > 0
    ? (totalGanancia / breakdown.precio_mayorista_total) * 100
    : 0;
  return (
    <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-200 rounded-xl mb-6">
      <button onClick={() => setOpen((o) => !o)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-purple-100/40 transition rounded-xl">
        <div className="flex items-center gap-2">
          <Boxes size={14} className="text-purple-700" />
          <span className="text-sm font-bold text-purple-900">Ganancia mayorista mercadería · Unidrop</span>
          <span className="text-[10px] font-normal text-purple-700">
            (precio que paga el dropshipper − costo último lote)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold text-purple-900 tabular-nums">{formatCurrency(totalGanancia)}</span>
          <span className="text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-bold">
            {marginPct.toFixed(1)}% margen
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          {/* Resumen total */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
              <div className="text-[10px] uppercase tracking-wider text-purple-700 font-bold">Precio mayorista total</div>
              <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{formatCurrency(breakdown.precio_mayorista_total)}</div>
              <div className="text-[10px] text-text-muted mt-0.5">lo que pagaron los dropshippers a Unidrop</div>
            </div>
            <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
              <div className="text-[10px] uppercase tracking-wider text-purple-700 font-bold">− Costo último lote</div>
              <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{formatCurrency(breakdown.costo_lote_total)}</div>
              <div className="text-[10px] text-text-muted mt-0.5">costo con IVA del último lote importado por SKU</div>
            </div>
            <div className="bg-white/70 rounded-lg p-3 border-2 border-purple-300">
              <div className="text-[10px] uppercase tracking-wider text-purple-700 font-bold">Ganancia bruta</div>
              <div className={cn("text-xl font-extrabold mt-1 tabular-nums", totalGanancia >= 0 ? "text-success" : "text-error")}>
                {formatCurrency(totalGanancia)}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">margen {marginPct.toFixed(1)}% sobre precio mayorista</div>
            </div>
          </div>

          {/* Desglose por canal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Unidrop · Tienda Nube</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-text-muted">Precio mayorista</span><span className="tabular-nums font-semibold">{formatCurrency(breakdown.precio_mayorista_tn)}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">− Costo lote</span><span className="tabular-nums text-text-muted">{formatCurrency(breakdown.costo_tn)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="font-bold">Ganancia TN</span><span className={cn("tabular-nums font-bold", breakdown.ganancia_tn >= 0 ? "text-success" : "text-error")}>{formatCurrency(breakdown.ganancia_tn)}</span></div>
              </div>
            </div>
            <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Unidrop · Mercado Libre</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-text-muted">Precio mayorista</span><span className="tabular-nums font-semibold">{formatCurrency(breakdown.precio_mayorista_ml)}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">− Costo lote</span><span className="tabular-nums text-text-muted">{formatCurrency(breakdown.costo_ml)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="font-bold">Ganancia ML</span><span className={cn("tabular-nums font-bold", breakdown.ganancia_ml >= 0 ? "text-success" : "text-error")}>{formatCurrency(breakdown.ganancia_ml)}</span></div>
              </div>
            </div>
          </div>

          {/* Cobertura y warnings */}
          <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-text-muted">Cobertura de costos:</span>
              <span className={cn("font-bold px-2 py-0.5 rounded-full",
                breakdown.cobertura_pct >= 75 ? "bg-emerald-100 text-emerald-800" :
                breakdown.cobertura_pct >= 50 ? "bg-amber-100 text-amber-800" :
                "bg-rose-100 text-rose-800",
              )}>
                {breakdown.cobertura_pct.toFixed(1)}%
              </span>
              <span className="text-text-muted">
                {breakdown.skus_con_costo} SKUs con costo · {breakdown.skus_sin_costo} sin cargar
              </span>
            </div>
            {breakdown.revenue_sin_costo > 0 && (
              <div className="text-amber-700 bg-amber-50 px-3 py-1 rounded-lg border border-amber-200 text-[11px]">
                ⚠ {formatCurrency(breakdown.revenue_sin_costo)} sin atribución de costo —{" "}
                <Link href="/dashboard/costos" className="underline font-semibold">Cargar lotes faltantes</Link>
              </div>
            )}
          </div>

          {breakdown.error && (
            <div className="text-xs text-error bg-rose-50 border border-rose-200 rounded p-2">
              Error calculando: {breakdown.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN PAGE — secciones tematicas
// =============================================================================

export default function GerenciaUnificadaPage() {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [opsOpen, setOpsOpen] = useState(false);
  const [explainMetric, setExplainMetric] = useState<string | null>(null);

  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);
  const periodSimple = period === "custom" ? "30d" : period;
  const periodLabel: string = ({
    today: "HOY", yesterday: "AYER", "7d": "7 dias", "30d": "30 dias",
    "90d": "90 dias", "12m": "12 meses",
    custom: customFrom && customTo ? `${customFrom} → ${customTo}` : "rango",
  } as Record<string, string>)[period] || period;

  // ---- Queries ----
  const { data: exec, isLoading: loadingExec, error: errorExec, refetch: refetchExec } = useQuery<ExtendedExec>({
    queryKey: ["dashboards", "executive", period, customFrom, customTo],
    queryFn: () => api<ExtendedExec>(`/api/dashboards/executive?${qs}`),
    staleTime: 60_000,
  });

  const { data: gerencia, isLoading: loadingGerencia, error: errorGerencia, refetch: refetchGerencia } = useQuery<GerenciaResponse>({
    queryKey: ["dashboards", "gerencia", period, customFrom, customTo],
    queryFn: () => api<GerenciaResponse>(`/api/dashboards/gerencia?${qs}`),
    staleTime: 5 * 60_000,
  });

  const { data: d360, isLoading: loading360 } = useQuery<Gerencia360Response>({
    queryKey: ["dashboards", "gerencia360", periodSimple],
    queryFn: () => api<Gerencia360Response>(`/api/dashboards/gerencia/360?period=${periodSimple}`),
    staleTime: 5 * 60_000,
    enabled: !!gerencia,
  });

  async function downloadMonthlyPdf() {
    setGenerating(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${apiUrl}/api/reports/monthly`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ym = todayArIso().slice(0, 7);
      a.href = url;
      a.download = `unidata_reporte_${ym}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Error generando PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <Topbar
        title="Gerencia"
        subtitle="Vista unificada del grupo Unistore · Pulso · Rentabilidad · Comercial · Clientes · Operaciones"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto space-y-8">

        {/* CTA reporte PDF */}
        <div className="flex items-center justify-end">
          <button onClick={downloadMonthlyPdf} disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 transition disabled:opacity-50">
            <FileDown size={14} />
            {generating ? "Generando PDF..." : "Reporte ejecutivo (PDF)"}
          </button>
        </div>

        {(errorExec || errorGerencia) && (
          <div className="bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error cargando datos: {(errorExec || errorGerencia)?.message}{" "}
            <button onClick={() => { refetchExec(); refetchGerencia(); }} className="underline ml-2">Reintentar</button>
          </div>
        )}

        {/* ============== § 1. PULSO HOY ============== */}
        <section>
          <SectionHeader number="1" emoji="⚡" title="Pulso HOY" subtitle="Comparador cross-app + KPIs de volumen del periodo seleccionado" />
          <TodayPanel title="Comparador HOY" allowCrossToggle={false} />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mt-4">
            {loadingExec || !exec
              ? Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
                ))
              : exec.cards.map((c) => (
                  <KpiCard key={c.label} data={c as KpiCardT} drill={getCardDrill(c.label, { period, customFrom, customTo })} />
                ))}
          </div>
        </section>

        {/* ============== § 2. RENTABILIDAD ============== */}
        <section>
          <SectionHeader number="2" emoji="💰" title="Rentabilidad consolidada" subtitle="Ganancia real cross-org descuenta IVA, IIBB, gateway fees, Meta Ads y egresos operativos" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {loadingGerencia || !gerencia ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[140px] bg-surface border border-border rounded-2xl animate-pulse" />
              ))
            ) : (
              <>
                <HeroCard
                  label="Ganancia Neta Consolidada"
                  value={formatCurrency(gerencia.consolidado.ganancia_neta)}
                  hint={`sobre ${formatCurrency(gerencia.consolidado.revenue)} de revenue real`}
                  variant={gerencia.consolidado.ganancia_neta >= 0 ? "success" : "error"}
                  icon={Coins}
                  onClick={() => setExplainMetric("ganancia-consolidada")}
                />
                <HeroCard
                  label="Margen Consolidado"
                  value={`${gerencia.consolidado.margen_pct.toFixed(1)}%`}
                  hint="(ganancia / revenue real)"
                  variant={gerencia.consolidado.margen_pct >= 10 ? "success" : gerencia.consolidado.margen_pct >= 0 ? "warning" : "error"}
                  icon={gerencia.consolidado.margen_pct >= 0 ? TrendingUp : TrendingDown}
                  onClick={() => setExplainMetric("margen-consolidado")}
                />
                <HeroCard
                  label="Cobertura Costos Unistore"
                  value={`${gerencia.consolidado.cobertura_costos_unistore_pct.toFixed(1)}%`}
                  hint={`${gerencia.unistore.skus_con_costo} con costo · ${gerencia.unistore.skus_sin_costo} sin cargar`}
                  variant={gerencia.consolidado.cobertura_costos_unistore_pct >= 75 ? "success" : gerencia.consolidado.cobertura_costos_unistore_pct >= 50 ? "warning" : "error"}
                  icon={ShieldCheck}
                  onClick={() => setExplainMetric("cobertura-costos")}
                />
                <HeroCard
                  label="Deuda Talo pendiente"
                  value={formatCurrency(gerencia.deuda_talo_pendiente)}
                  hint="Subs PaymentIntent en PENDING"
                  variant={gerencia.deuda_talo_pendiente > 0 ? "warning" : "default"}
                  icon={Wallet}
                  onClick={() => setExplainMetric("deuda-talo")}
                />
              </>
            )}
          </div>

          {gerencia && gerencia.consolidado.cobertura_costos_unistore_pct < 75 && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex items-start gap-2 text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <strong>Cobertura de costos parcial.</strong> Solo el {gerencia.consolidado.cobertura_costos_unistore_pct.toFixed(1)}% del revenue Unistore tiene costo cargado.
                <Link href="/dashboard/costos" className="ml-2 underline font-semibold">Cargar costos faltantes →</Link>
              </div>
            </div>
          )}

          {/* Desglose por unidad (3 cards) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {loadingGerencia || !gerencia ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[300px] bg-surface border border-border rounded-xl animate-pulse" />
              ))
            ) : (
              <>
                <UnitProfitCard
                  title="Unistore (TN + ML)"
                  color="#5b8def"
                  onExplain={(m) => setExplainMetric(m)}
                  rows={[
                    { label: "Revenue total", value: gerencia.unistore.revenue, prefix: "$ ", explainMetric: "unistore-revenue" },
                    { label: "Revenue con costo cargado", value: gerencia.unistore.revenue_con_costo, prefix: "$ ", muted: true, explainMetric: "cobertura-costos" },
                    { label: "Costo de mercaderia (con IVA)", value: gerencia.unistore.costo, prefix: "$ ", muted: true, explainMetric: "unistore-costo" },
                    { label: "Ganancia neta", value: gerencia.unistore.ganancia_neta, prefix: "$ ", negative: gerencia.unistore.ganancia_neta < 0, explainMetric: "unistore-ganancia" },
                    { label: "Margen", value: gerencia.unistore.margen_pct, suffix: " %", negative: gerencia.unistore.margen_pct < 0, explainMetric: "unistore-margen" },
                  ]}
                />
                <UnitProfitCard
                  title="Unidrop · volumen plataforma (ref)"
                  color="#94a3b8"
                  onExplain={(m) => setExplainMetric(m)}
                  rows={[
                    { label: "Facturacion TN paid", value: gerencia.unidrop.volumen_tn, prefix: "$ ", muted: true, explainMetric: "unidrop-volumen" },
                    { label: "Facturacion ML paid", value: gerencia.unidrop.volumen_ml, prefix: "$ ", muted: true, explainMetric: "unidrop-volumen" },
                    { label: "Volumen total", value: gerencia.unidrop.volumen_plataforma, prefix: "$ ", explainMetric: "unidrop-volumen" },
                    { label: "− Costo mercaderia (con IVA)", value: gerencia.unidrop.costo_mercaderia, prefix: "$ ", muted: true, explainMetric: "unidrop-costo-mercaderia" },
                    { label: "Margen bruto plataforma", value: gerencia.unidrop.margen_bruto_plataforma, prefix: "$ ", explainMetric: "unidrop-margen-bruto" },
                    { label: "Ordenes pagadas", value: gerencia.unidrop.ordenes_pagadas, muted: true },
                  ]}
                />
                <UnitProfitCard
                  title="Unidrop · retencion neta"
                  color="#a855f7"
                  onExplain={(m) => setExplainMetric(m)}
                  rows={[
                    { label: "Comisiones Talo cobradas", value: gerencia.unidrop.comisiones, prefix: "$ ", explainMetric: "unidrop-comisiones" },
                    { label: "Suscripciones MELI cobradas", value: gerencia.unidrop.suscripciones_cobradas, prefix: "$ ", explainMetric: "unidrop-subs-meli" },
                    { label: "Ganancia mayorista mercadería", value: gerencia.unidrop.ganancia_mayorista, prefix: "$ ", explainMetric: "unidrop-mayorista" },
                    { label: "Ingresos Unidrop", value: gerencia.unidrop.ingresos_unidrop, prefix: "$ ", explainMetric: "unidrop-ingresos" },
                    { label: "− Meta Ads Unidrop", value: gerencia.unidrop.meta_ads_spend, prefix: "$ ", muted: true, explainMetric: "unidrop-meta-ads" },
                    { label: "− Egresos operativos", value: gerencia.unidrop.egresos_operativos, prefix: "$ ", muted: true, explainMetric: "unidrop-egresos" },
                    { label: "Ganancia neta", value: gerencia.unidrop.ganancia_neta, prefix: "$ ", negative: gerencia.unidrop.ganancia_neta < 0, explainMetric: "unidrop-ganancia-neta" },
                    { label: "Margen sobre retencion", value: gerencia.unidrop.margen_pct, suffix: " %", negative: gerencia.unidrop.margen_pct < 0, explainMetric: "unidrop-margen" },
                  ]}
                />
              </>
            )}
          </div>

          {/* Detalle ganancia mayorista Unidrop */}
          {gerencia && gerencia.unidrop.ganancia_mayorista !== 0 && (
            <MayoristaDetailBlock breakdown={gerencia.unidrop.mayorista_breakdown} totalGanancia={gerencia.unidrop.ganancia_mayorista} />
          )}

          {/* Chart consolidado multi-variable con forecast */}
          <div className="mb-6">
            <DailyMetricChart defaultVariable="revenue" defaultDays={90} horizon={28} />
          </div>
        </section>

        {/* ============== § 2.5 EFICIENCIA META ADS · UNIDROP ============== */}
        <section>
          <SectionHeader
            number="2.5"
            emoji="📣"
            title="Eficiencia Meta Ads · UNIDROP"
            subtitle="Cruce spend × adquisición × revenue de la cohort · period-based vs cohort-attributed"
          />
          <MetaEfficiencySection
            period={periodSimple}
            onExplainSpend={() => setExplainMetric("unidrop-meta-ads")}
          />
        </section>

        <section>
          {/* Top SKUs por ganancia / margen */}
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3">
            Productos Unistore por ganancia
            {gerencia && (
              <span className="ml-3 font-normal text-text-muted normal-case">
                <CoberturaBadge pct={gerencia.consolidado.cobertura_costos_unistore_pct} />
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {loadingGerencia || !gerencia ? (
              <>
                <div className="h-[360px] bg-surface border border-border rounded-xl animate-pulse" />
                <div className="h-[360px] bg-surface border border-border rounded-xl animate-pulse" />
              </>
            ) : (
              <>
                <SkuProfitTable title="Top 10 SKUs por ganancia neta $" rows={gerencia.unistore.top10_skus_by_profit} emphasisColumn="ganancia_neta" />
                <SkuProfitTable title="SKUs con margen <5% — revisar precio o costo" rows={gerencia.unistore.bottom_skus_low_margin} emphasisColumn="margen_pct" negativeStyle />
              </>
            )}
          </div>
        </section>

        {/* ============== § 3. SALUD POR UNIDAD ============== */}
        {exec?.unit_health && exec.unit_health.length > 0 && (
          <section>
            <SectionHeader number="3" emoji="🏥" title="Salud por unidad de negocio" subtitle={`Unistore · Unidrop · Unidev · ${periodLabel}`} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {exec.unit_health.map((u) => (
                <UnitHealthCardCmp key={u.unit} u={u} drillCtx={{ period, customFrom, customTo }} />
              ))}
            </div>
          </section>
        )}

        {/* ============== § 4. COMERCIAL ============== */}
        <section>
          <SectionHeader number="4" emoji="📈" title="Comercial" subtitle="Revenue cross-org granular · share por canal y unidad · top SKUs y clientes por ganancia · performance dropshippers" />

          {/* Componente nuevo con controles de granularidad, ventana, modo vista,
              + share por canal/unidad, + tabla SKUs por ganancia, + tabla clientes por ganancia */}
          <CommercialSection />

          {/* Lifecycle de customers (Unistore) — info legacy de la home */}
          {exec?.lifecycle_mix && (
            <div className="mt-6">
              <CategoryTable
                caption="Lifecycle de customers Unistore"
                subtitle="Nuevo · 2da compra · Convertido a recurrente · Recurrente — basado en historico TN"
                data={exec.lifecycle_mix ?? []}
                formatter="number"
                extraColumns={[{ key: "revenue", label: "Revenue total", format: "currency" }]}
              />
            </div>
          )}

          {/* Dropshippers performance */}
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
              <Crown size={12} /> Performance Dropshippers
              {d360?.dropshippers?.total_dropshippers ? (
                <span className="font-normal normal-case text-text-muted">· {d360.dropshippers.total_dropshippers} activos</span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {loading360 || !d360 ? (
                <>
                  <div className="h-[300px] bg-surface border border-border rounded-xl animate-pulse" />
                  <div className="h-[300px] bg-surface border border-border rounded-xl animate-pulse" />
                </>
              ) : (
                <>
                  <DropshippersList title="Top 10 por ganancia Unidrop" emptyMsg={d360.dropshippers.error || "Sin dropshippers con ganancia"} rows={d360.dropshippers.top10_by_profit} emphasis="profit" />
                  <DropshippersList title="Criticos — deuda o margen negativo" emptyMsg={d360.dropshippers.error || "Sin criticos en el periodo"} rows={d360.dropshippers.bottom5_criticos} emphasis="deuda" />
                </>
              )}
            </div>
          </div>
        </section>

        {/* ============== § 5. CLIENTES ============== */}
        <section>
          <SectionHeader number="5" emoji="👥" title="Clientes" subtitle="VIPs · RFM Unistore · Cohorts dropshippers Unidrop" />

          <VipKpiSection />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
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
        </section>

        {/* ============== § 6. OPERACIONES ============== */}
        <section>
          <SectionHeader number="6" emoji="🛠️" title="Operaciones" subtitle="Cash flow · forecast stock · alertas · centro de operaciones" />

          {/* Cash flow 30d */}
          <div className="bg-surface border border-border rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <LineIcon size={14} className="text-text-muted" />
              <div className="text-sm font-bold text-text">Cash Flow Proyectado 30d</div>
            </div>
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
                    <XAxis dataKey="date" tickFormatter={(v) => (v ? v.slice(5) : "")} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                    <Line type="monotone" dataKey="saldo" stroke="#a855f7" strokeWidth={2} dot={false} name="Saldo final dia" />
                  </LineChart>
                </ResponsiveContainer>
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
                <ForecastList title="Riesgo quiebre <30d" rows={d360.forecast_stock_health.riesgo_quiebre_30d} tone="rose" emptyMsg={d360.forecast_stock_health.error || "Sin SKUs en riesgo"} />
                <ForecastList title="Sobre-stock — DoI alto" rows={d360.forecast_stock_health.sobre_stock} tone="amber" emptyMsg={d360.forecast_stock_health.error || "Sin SKUs con DoI alto"} />
              </>
            )}
          </div>

          {/* Alertas + Integration health (de la home original) */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div>
              {loadingExec || !exec ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
              ) : (
                <AlertsPanel alerts={exec.top_alerts} />
              )}
            </div>
            <div className="xl:col-span-2">
              {loadingExec || !exec ? (
                <div className="bg-surface border border-border rounded-xl p-5 h-[200px] animate-pulse" />
              ) : (
                <IntegrationHealthList items={exec.integration_health} />
              )}
            </div>
          </div>

          {/* Centro de operaciones (counts) */}
          {d360?.ops_counts && (
            <div className="bg-surface border border-border rounded-xl">
              <button onClick={() => setOpsOpen((o) => !o)}
                      className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-soft/30 transition rounded-xl">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-600" />
                  <span className="text-sm font-bold text-text">Centro de operaciones</span>
                  <span className="text-[10px] text-text-muted">contadores rapidos</span>
                </div>
                {opsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {opsOpen && (
                <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <OpsCard label="Alertas IT" value={d360.ops_counts.it_alerts_pending}
                           hint={d360.ops_counts.it_alerts_critical ? `${d360.ops_counts.it_alerts_critical} criticas` : "salud OK"}
                           icon={Bell} href="/dashboard/notificaciones"
                           tone={d360.ops_counts.it_alerts_critical ? "rose" : "default"} />
                  <OpsCard label="CS Actions pendientes" value={d360.ops_counts.cs_actions_pending}
                           icon={Headphones} href="/dashboard/cs-acciones"
                           tone={(d360.ops_counts.cs_actions_pending ?? 0) > 10 ? "amber" : "default"} />
                  <OpsCard label="Zonas stock critico" value={d360.ops_counts.stock_critical_zones}
                           hint="<=5 unidades en Digip" icon={Boxes} href="/dashboard/stock-heatmap"
                           tone={(d360.ops_counts.stock_critical_zones ?? 0) > 0 ? "amber" : "default"} />
                  <OpsCard label="Meta Ads ROAS" value={d360.ops_counts.meta_ads_roas}
                           hint={d360.ops_counts.meta_ads_hint || "ultimo periodo"}
                           icon={Megaphone} href="/dashboard/marketing" tone="default" />
                </div>
              )}
            </div>
          )}
        </section>

        {/* ============== § 7. ANALISIS POST-VENTA (Unidev) ============== */}
        {exec?.unidev_analysis && (
          <section>
            <SectionHeader number="7" emoji="🔍" title="Analisis post-venta" subtitle="Causas de falla · tipo de resolucion · SKUs con mas devoluciones (Unidev)" />
            <div className="bg-rose-50/30 border border-rose-200 rounded-xl p-5">
              {exec.unit_health && (() => {
                const unidev = exec.unit_health.find((u: UnitHealth) => u.unit === "unidev");
                if (!unidev) return null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {unidev.metrics.map((m) => (
                      <div key={m.label} className="bg-white/70 rounded-lg p-3 border border-rose-100">
                        <div className="text-[9px] uppercase tracking-wider text-rose-700/70 font-bold truncate">{m.label}</div>
                        <div className="text-base font-extrabold text-rose-900 mt-0.5 tabular-nums">
                          {m.prefix ?? ""}{typeof m.value === "number" ? formatNumber(m.value) : m.value}{m.suffix ?? ""}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <UnidevMiniTable title="Top causas (motivos de falla)" rows={exec.unidev_analysis.top_motivos} color="#f43f5e" suffix=" unid" extraKey="items" extraLabel="items" />
                <UnidevMiniTable title="Tipo de resolucion preferida" rows={exec.unidev_analysis.top_resoluciones} color="#fb923c" suffix=" devs" />
                <UnidevMiniTable title="SKUs mas devueltos" rows={exec.unidev_analysis.top_skus} color="#ef4444" suffix=" u" extraKey="items" extraLabel="items" />
              </div>
            </div>
          </section>
        )}

        {/* Footer timestamp */}
        {(exec || gerencia) && (
          <div className="text-[10px] text-text-muted text-right pt-2 border-t border-border">
            Datos generados: {fmtArDateTime((gerencia ?? exec)?.generated_at ?? "")}
          </div>
        )}
      </div>

      {explainMetric && (
        <CalcExplainModal
          metric={explainMetric}
          period={periodSimple}
          customFrom={customFrom}
          customTo={customTo}
          onClose={() => setExplainMetric(null)}
        />
      )}
    </>
  );
}
