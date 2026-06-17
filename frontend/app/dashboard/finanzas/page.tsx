"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, RotateCcw, Receipt, AlertTriangle, ArrowRight,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { DonutChart } from "@/components/donut-chart";
import { DailyMetricChart } from "@/components/daily-metric-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { KpiCard as KpiCardT } from "@/lib/types";

type FinUnit = "total" | "unistore" | "unidrop";

// ── shapes (parciales, solo lo que consumimos) ──────────────────────────────
type Gerencia = {
  consolidado?: { revenue: number; ganancia_neta: number; margen_pct: number; cobertura_costos_unistore_pct: number };
  unistore?: { revenue: number; costo: number; ganancia_neta: number; margen_pct: number; cobertura_costos_pct: number };
  unidrop?: {
    comisiones: number; suscripciones_cobradas: number; ganancia_mayorista: number;
    meta_ads_spend: number; egresos_operativos: number; ganancia_neta: number; margen_pct: number; ingresos_unidrop: number;
  };
  deuda_talo_pendiente?: number;
  generated_at?: string;
};
type Saldos = { por_banco: { nombre: string; saldo: number; tipo: string }[]; total: number };
type Proyeccion = { resumen?: { saldo_final: number; neto_periodo: number; total_egresos: number; dias: number } };
type CashKpis = { atrasadas?: { count: number; total: number }; proximas_7d?: { count: number; total: number } };
type TabTotal = { count: number; monto: number };
type Transfer = { totals: Record<string, TabTotal> };
type MlReturns = { counts_by_bucket?: Record<string, number> };
type RefundReqs = { counts_by_status?: Record<string, number> };
type SubsMeli = { cards?: KpiCardT[]; generated_at?: string };
type Churn = { kpis?: { revenue_churned_arg?: number; revenue_churned_real_arg?: number; pending_refund_arg?: number; total_requests?: number; pending?: number } };
type FacResp = { cards?: KpiCardT[]; generated_at?: string };

// ── helpers locales (replicados de la home) ─────────────────────────────────
function SectionHeader({ emoji, title, subtitle, number, action }: { emoji?: string; title: string; subtitle?: string; number?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 mt-2 flex items-baseline gap-3">
      {number && <div className="text-[11px] font-extrabold tracking-wider tabular-nums text-text-muted">§{number}</div>}
      <div className="flex-1">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-text">
          {emoji && <span>{emoji}</span>}<span>{title}</span>
        </h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function HeroCard({ label, value, hint, variant = "default", icon: Icon }: { label: string; value: string; hint?: string; variant?: "default" | "success" | "warning" | "error"; icon?: React.ComponentType<{ size?: number; className?: string }> }) {
  const styles = {
    default: "from-primary/10 to-accent/10 border-primary/20 text-text",
    success: "from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900",
    warning: "from-amber-50 to-amber-100 border-amber-200 text-amber-900",
    error: "from-rose-50 to-rose-100 border-rose-200 text-rose-900",
  }[variant];
  return (
    <div className={cn("rounded-2xl border bg-gradient-to-br p-5 shadow-sm", styles)}>
      <div className="mb-2 flex items-center gap-2">
        {Icon && <Icon size={14} className="opacity-70" />}
        <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      </div>
      <div className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-2 text-xs opacity-80">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, hint, tone = "default", href }: { label: string; value: string; hint?: string; tone?: "default" | "danger" | "ok"; href?: string }) {
  const toneCls = tone === "danger" ? "text-error" : tone === "ok" ? "text-success" : "text-text";
  const inner = (
    <div className="rounded-xl border border-border bg-surface p-4 transition hover:shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular-nums", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const $ = (n: number | null | undefined) => formatCurrency(n ?? 0);
const N = (n: number | null | undefined) => formatNumber(n ?? 0);
function churnPeriod(p: string): string {
  if (p === "90d") return "90d";
  if (p === "12m") return "1y";
  return "30d";
}

export default function FinanzasPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit] = useState<FinUnit>("total");

  const isUnistore = unit === "unistore";
  const showUnidropStuff = unit !== "unistore"; // devoluciones + suscripciones son Unidrop
  const facUnit = unit === "unidrop" ? "unidrop" : "unistore";

  const ger = useQuery<Gerencia>({ queryKey: ["fin", "gerencia", period, customFrom, customTo], queryFn: () => api(`/api/dashboards/gerencia?${qs}`), staleTime: 120_000 });
  const saldos = useQuery<Saldos>({ queryKey: ["fin", "saldos"], queryFn: () => api(`/api/flujo-fondos/saldos/actual`), staleTime: 120_000 });
  const proy = useQuery<Proyeccion>({ queryKey: ["fin", "proyeccion"], queryFn: () => api(`/api/flujo-fondos/proyeccion?dias=30`), staleTime: 120_000 });
  const cashK = useQuery<CashKpis>({ queryKey: ["fin", "cashkpis"], queryFn: () => api(`/api/flujo-fondos/kpis`), staleTime: 120_000 });
  const trML = useQuery<Transfer>({ queryKey: ["fin", "tr", "ml"], queryFn: () => api(`/api/cresium-payouts/transferencias?source=ml&tab=pendiente`), enabled: showUnidropStuff, staleTime: 60_000 });
  const trSub = useQuery<Transfer>({ queryKey: ["fin", "tr", "sub"], queryFn: () => api(`/api/cresium-payouts/transferencias?source=subscription&tab=pendiente`), enabled: showUnidropStuff, staleTime: 60_000 });
  const mlRet = useQuery<MlReturns>({ queryKey: ["fin", "mlret"], queryFn: () => api(`/api/ml-return-actions?tab=todas&limit=1`), enabled: showUnidropStuff, staleTime: 120_000 });
  const refReq = useQuery<RefundReqs>({ queryKey: ["fin", "refreq"], queryFn: () => api(`/api/refund-requests?limit=1`), enabled: showUnidropStuff, staleTime: 120_000 });
  const subs = useQuery<SubsMeli>({ queryKey: ["fin", "subs", period], queryFn: () => api(`/api/dashboards/subscriptions-meli?${qs}`), enabled: showUnidropStuff, staleTime: 120_000 });
  const churn = useQuery<Churn>({ queryKey: ["fin", "churn", churnPeriod(period)], queryFn: () => api(`/api/dashboards/gerencia/churn-suscripciones?period=${churnPeriod(period)}`), enabled: showUnidropStuff, staleTime: 180_000 });
  const fac = useQuery<FacResp>({ queryKey: ["fin", "fac", facUnit, period, customFrom, customTo], queryFn: () => api(`/api/dashboards/finanzas/${facUnit}?${qs}`), staleTime: 120_000 });

  const g = ger.data;
  const cons = g?.consolidado;
  // totales de devoluciones (Cresium ml + suscripcion)
  const trT = (k: string) => (trML.data?.totals?.[k]?.monto ?? 0) + (trSub.data?.totals?.[k]?.monto ?? 0);
  const trC = (k: string) => (trML.data?.totals?.[k]?.count ?? 0) + (trSub.data?.totals?.[k]?.count ?? 0);
  const reembolsosPend = trT("pendiente");

  return (
    <>
      <Topbar title="Finanzas" subtitle="Tablero financiero del grupo — caja, rentabilidad, devoluciones y suscripciones" />
      <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">
        <DashboardHeader
          generatedAt={g?.generated_at}
          isFetching={ger.isFetching || saldos.isFetching}
          filters={
            <Segmented<FinUnit>
              value={unit}
              onChange={setUnit}
              options={[{ value: "total", label: "Total" }, { value: "unistore", label: "Unistore" }, { value: "unidrop", label: "Unidrop" }]}
            />
          }
        />
        <TodayPanel context="finanzas" title="HOY · Finanzas" />

        {/* ── Pulso financiero ── */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HeroCard icon={Wallet} label="Caja en bancos" value={$(saldos.data?.total)} hint={`${saldos.data?.por_banco?.length ?? 0} cuentas`} />
          <HeroCard icon={TrendingUp} label="Ganancia neta" variant={(cons?.ganancia_neta ?? 0) >= 0 ? "success" : "error"} value={$(cons?.ganancia_neta)} hint={`Margen ${(cons?.margen_pct ?? 0).toFixed(1)}% · revenue ${$(cons?.revenue)}`} />
          <HeroCard icon={Receipt} label="Revenue del período" value={$(cons?.revenue)} hint={`Cobertura costos ${(cons?.cobertura_costos_unistore_pct ?? 0).toFixed(0)}%`} />
          <HeroCard icon={RotateCcw} label="Reembolsos pendientes" variant={reembolsosPend > 0 ? "warning" : "default"} value={showUnidropStuff ? $(reembolsosPend) : "—"} hint={showUnidropStuff ? `${trC("pendiente")} a transferir` : "solo Unidrop"} />
        </div>

        {/* ── §1 Devoluciones & Transferencias ── */}
        {showUnidropStuff && (
          <section className="mb-8">
            <SectionHeader number="1" emoji="🔁" title="Devoluciones & Transferencias" subtitle="Cola de reembolsos vía Cresium (ML + suscripciones)"
              action={<Link href="/dashboard/finanzas/dev-mercadolibre" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ir a transferencias <ArrowRight size={13} /></Link>} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Pendiente de transferir" value={$(trT("pendiente"))} hint={`${trC("pendiente")} reintegros`} tone="danger" href="/dashboard/finanzas/dev-mercadolibre" />
              <Stat label="En curso (Cresium)" value={$(trT("en_cresium"))} hint={`${trC("en_cresium")} esperando acreditación`} />
              <Stat label="Transferido" value={$(trT("realizada"))} hint={`${trC("realizada")} realizadas`} tone="ok" />
              <Stat label="Con error" value={$(trT("error_cliente") + trT("error_cresium"))} hint={`${trC("error_cliente")} datos · ${trC("error_cresium")} Cresium`} tone={trC("error_cliente") + trC("error_cresium") > 0 ? "danger" : "default"} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DonutChart caption="Devoluciones por estado (cantidad)" height={240}
                data={[
                  { name: "Pendiente", value: trC("pendiente") },
                  { name: "En Cresium", value: trC("en_cresium") },
                  { name: "Realizadas", value: trC("realizada") },
                  { name: "Errores", value: trC("error_cliente") + trC("error_cresium") },
                ].filter((d) => d.value > 0)} />
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 text-sm font-bold text-text">Tracking</div>
                <div className="space-y-2 text-sm">
                  <Row label="Devoluciones ML (todas)" value={N(mlRet.data?.counts_by_bucket?.todas)} />
                  <Row label="ML a transferir" value={N(mlRet.data?.counts_by_bucket?.TRANSFERENCIA_PENDIENTE)} />
                  <Row label="Solicitudes suscripción pendientes" value={N(refReq.data?.counts_by_status?.pending)} />
                  <Row label="Suscripción transferidas" value={N(refReq.data?.counts_by_status?.transferred)} />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── §2 Caja / Tesorería ── */}
        <section className="mb-8">
          <SectionHeader number="2" emoji="💵" title="Caja / Tesorería" subtitle="Saldos en bancos + proyección de flujo de fondos (grupo)"
            action={<Link href="/dashboard/finanzas/flujo-fondos" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Flujo de Fondos <ArrowRight size={13} /></Link>} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Saldo en bancos" value={$(saldos.data?.total)} hint={`${saldos.data?.por_banco?.length ?? 0} cuentas`} />
            <Stat label="Saldo proyectado (30d)" value={$(proy.data?.resumen?.saldo_final)} hint={`Neto período ${$(proy.data?.resumen?.neto_periodo)}`} tone={(proy.data?.resumen?.saldo_final ?? 0) < 0 ? "danger" : "default"} />
            <Stat label="Pagos atrasados" value={$(cashK.data?.atrasadas?.total)} hint={`${cashK.data?.atrasadas?.count ?? 0} erogaciones`} tone={(cashK.data?.atrasadas?.total ?? 0) > 0 ? "danger" : "ok"} href="/dashboard/finanzas/flujo-fondos" />
            <Stat label="Próximos 7 días" value={$(cashK.data?.proximas_7d?.total)} hint={`${cashK.data?.proximas_7d?.count ?? 0} a pagar`} />
          </div>
          {(saldos.data?.por_banco?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {saldos.data!.por_banco.map((b) => (
                <span key={b.nombre} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
                  <span className="text-text-muted">{b.nombre}</span> <b className="ml-1 tabular-nums text-text">{$(b.saldo)}</b>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ── §3 Rentabilidad ── */}
        <section className="mb-8">
          <SectionHeader number="3" emoji="📈" title="Rentabilidad" subtitle="Ganancia neta y margen real (costos de lote + retención Unidrop)" />
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {!isUnistore && (
              <>
                <Stat label="Ganancia neta (consolidado)" value={$(cons?.ganancia_neta)} hint={`Margen ${(cons?.margen_pct ?? 0).toFixed(1)}%`} tone={(cons?.ganancia_neta ?? 0) >= 0 ? "ok" : "danger"} />
                <Stat label="Deuda Talo pendiente" value={$(g?.deuda_talo_pendiente)} hint="subs facturadas sin cobrar" tone={(g?.deuda_talo_pendiente ?? 0) > 0 ? "danger" : "default"} />
              </>
            )}
            {unit !== "unidrop" && g?.unistore && (
              <>
                <Stat label="Ganancia Unistore" value={$(g.unistore.ganancia_neta)} hint={`Margen ${g.unistore.margen_pct.toFixed(1)}% · cobertura ${g.unistore.cobertura_costos_pct.toFixed(0)}%`} tone="ok" />
                <Stat label="Revenue Unistore" value={$(g.unistore.revenue)} hint={`Costo ${$(g.unistore.costo)}`} />
              </>
            )}
            {unit !== "unistore" && g?.unidrop && (
              <>
                <Stat label="Ganancia Unidrop" value={$(g.unidrop.ganancia_neta)} hint={`Margen ${g.unidrop.margen_pct.toFixed(1)}%`} tone="ok" />
                <Stat label="Ingresos Unidrop" value={$(g.unidrop.ingresos_unidrop)} hint={`Comis ${$(g.unidrop.comisiones)} · subs ${$(g.unidrop.suscripciones_cobradas)} · Meta -${$(g.unidrop.meta_ads_spend)}`} />
              </>
            )}
          </div>
          <DailyMetricChart defaultVariable="profit" defaultDays={90} />
        </section>

        {/* ── §4 Suscripciones ── */}
        {showUnidropStuff && (
          <section className="mb-8">
            <SectionHeader number="4" emoji="🔄" title="Suscripciones" subtitle="Revenue recurrente MELI + churn"
              action={<Link href="/dashboard/finanzas/dev-suscripciones" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Dev. Suscripciones <ArrowRight size={13} /></Link>} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(subs.data?.cards ?? []).slice(0, 2).map((c) => <KpiCard key={c.label} data={c} />)}
              <Stat label="Revenue churned" value={$(churn.data?.kpis?.revenue_churned_real_arg ?? churn.data?.kpis?.revenue_churned_arg)} hint={`${churn.data?.kpis?.total_requests ?? 0} bajas en el período`} tone="danger" />
              <Stat label="Refund pendiente (churn)" value={$(churn.data?.kpis?.pending_refund_arg)} hint={`${churn.data?.kpis?.pending ?? 0} pendientes`} tone={(churn.data?.kpis?.pending_refund_arg ?? 0) > 0 ? "danger" : "default"} />
            </div>
          </section>
        )}

        {/* ── §5 Facturación vs Ventas ── */}
        <section className="mb-4">
          <SectionHeader number="5" emoji="🧾" title="Facturación vs Ventas"
            subtitle={`Contabilium vs ventas operativas — ${facUnit === "unistore" ? "Unistore" : "Unidrop"}${unit === "total" ? " (cambiá el toggle para ver la otra unidad)" : ""}`} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {fac.isLoading || !fac.data ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[120px] animate-pulse rounded-xl border border-border bg-surface" />)
            ) : (
              (fac.data.cards ?? []).map((c) => <KpiCard key={c.label} data={c} />)
            )}
          </div>
        </section>

        {(ger.error || saldos.error) && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} /> Algunos bloques no cargaron. {(ger.error as Error)?.message || (saldos.error as Error)?.message}
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-1.5 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}
