"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LabelList,
} from "recharts";
import { TrendingDown, TrendingUp, ArrowRight, AlertTriangle, DollarSign, CheckCircle2, XCircle, Clock, ExternalLink, Sparkles, X, Loader2 } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { api } from "@/lib/api";

type Period = "30d" | "90d" | "6m" | "1y";
type Granularity = "day" | "week" | "month" | "quarter" | "year";

type Status = "pending" | "transferred" | "integration_cancelled" | "rejected";

type RequestRow = {
  id: number; dropshipper_user_id: number; dni: string;
  name: string; fantasy_name: string | null; plan: string | null;
  abandonment_reason: string; reason: string | null; status: Status;
  refund_amount_arg: number | null;
  paid_subscription_total_arg: number | null;
  paid_subscription_count: number | null;
  bank_name: string; bank_holder_name: string; bank_cbu_last4: string | null;
  created_at: string;
  transferred_at: string | null;
  integration_cancelled_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
};

type EvolutionBucket = {
  period_start: string; period_end: string;
  pending: number; transferred: number;
  integration_cancelled: number; rejected: number;
  total: number; paid_total_arg: number;
};

type ChurnResp = {
  period: Period;
  granularity: Granularity;
  kpis: {
    total_requests: number;
    pending: number;
    transferred: number;
    integration_cancelled: number;
    rejected: number;
    total_form_errors: number;
    distinct_failed_users: number;
    form_completion_rate_pct: number | null;
    pending_refund_arg: number;
    revenue_churned_arg: number;
    revenue_churned_real_arg: number;
  };
  by_status: Record<string, number>;
  by_reason: Array<{ reason: string; count: number }>;
  by_plan: Array<{ plan: string; count: number; paid_total_arg: number }>;
  evolution: {
    series: EvolutionBucket[];
    stats: {
      peak: number;
      peak_period_start: string | null;
      peak_period_end: string | null;
      average: number;
      trend: "up" | "down" | "flat";
      bucket_count: number;
    };
  };
  telemetry_by_kind: Array<{ kind: string; count: number; distinct_incidents: number }>;
  failed_users: Array<{
    dni: string; email: string | null; kind: string;
    last_seen: string; attempts: number; messages: string | null;
  }>;
  recent_requests: RequestRow[];
};

type InsightPattern = {
  title: string;
  evidence: string;
  severity: "high" | "medium" | "low";
  metric?: string;
};

type InsightTaxonomy = {
  category: string;
  subcategory?: string;
  count: number;
  examples?: string[];
};

type InsightAction = {
  scope: "dropshipper" | "segment" | "product" | "process";
  target_label: string;
  target_dropshipper_id?: number;
  target_dni?: string;
  action: string;
  urgency: "urgent" | "this_week" | "monitor";
  reasoning: string;
  expected_impact_arg?: number;
};

type InsightPayload = {
  summary: string;
  patterns: InsightPattern[];
  taxonomy_breakdown: InsightTaxonomy[];
  action_recommendations: InsightAction[];
  _meta?: { model: string | null; duration_ms: number; saved_id: number | null };
};

type InsightResp =
  | { has_insight: false; period: Period; granularity: Granularity }
  | {
      has_insight: true;
      id: number;
      period: Period;
      granularity: Granularity;
      payload: InsightPayload;
      model: string | null;
      generated_by_email: string | null;
      duration_ms: number | null;
      created_at: string;
    };

type DrillDownResp = {
  period_start: string;
  period_end: string;
  total_requests: number;
  revenue_churned_arg: number;
  pending_refund_arg: number;
  by_status: Record<string, number>;
  by_reason: Array<{ reason: string; count: number }>;
  requests: RequestRow[];
};

const ABANDONMENT_LABELS: Record<string, string> = {
  costo_muy_alto:               "Costo muy alto",
  sin_ventas_suficientes:       "Sin ventas suficientes",
  mala_experiencia_meli:        "Mala experiencia MELI",
  solo_tn:                      "Solo opera por TN",
  cierro_emprendimiento:        "Cierra emprendimiento",
  problemas_tecnicos_unidrop:   "Problemas técnicos Unidrop",
  otra:                         "Otra",
  no_especificada:              "No especificada",
};

const REASON_COLORS = [
  "#a259ff", "#7c3aed", "#3b82f6", "#0ea5e9",
  "#10b981", "#f59e0b", "#ef4444", "#64748b",
];

const TELEMETRY_LABELS: Record<string, string> = {
  network_error:     "Error de red (Failed to fetch)",
  http_error:        "Error HTTP backend (5xx)",
  parse_error:       "Respuesta JSON inválida",
  validation_error:  "Validación rechazada",
  client_exception:  "Excepción JS no esperada",
};

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string; text: string }> = {
  pending:               { label: "Pendiente",          color: "#f59e0b", bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-700" },
  transferred:           { label: "Transferido",        color: "#3b82f6", bg: "bg-blue-50",    border: "border-blue-300",    text: "text-blue-700" },
  integration_cancelled: { label: "Cancelado MELI",     color: "#059669", bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700" },
  rejected:              { label: "Rechazada",          color: "#94a3b8", bg: "bg-zinc-50",    border: "border-zinc-300",    text: "text-zinc-700" },
};

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtBucket(iso: string, granularity: Granularity): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const tz = "America/Argentina/Buenos_Aires";
    switch (granularity) {
      case "day":
        return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: tz });
      case "week":
        return `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: tz })}`;
      case "month":
        return d.toLocaleDateString("es-AR", { month: "short", year: "2-digit", timeZone: tz });
      case "quarter": {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q} ${String(d.getFullYear()).slice(-2)}`;
      }
      case "year":
        return String(d.getFullYear());
      default:
        return iso;
    }
  } catch {
    return iso;
  }
}

function fmtBucketLong(iso: string, granularity: Granularity): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const tz = "America/Argentina/Buenos_Aires";
    switch (granularity) {
      case "day":
        return d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: tz });
      case "week":
        return `Semana del ${d.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric", timeZone: tz })}`;
      case "month":
        return d.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: tz });
      case "quarter": {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q} de ${d.getFullYear()}`;
      }
      case "year":
        return String(d.getFullYear());
      default:
        return iso;
    }
  } catch {
    return iso;
  }
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "6m",  label: "6 meses" },
  { value: "1y",  label: "12 meses" },
];

const GRANULARITIES: Array<{ value: Granularity; label: string }> = [
  { value: "day",     label: "Día"     },
  { value: "week",    label: "Sem"     },
  { value: "month",   label: "Mes"     },
  { value: "quarter", label: "Q"       },
  { value: "year",    label: "Año"     },
];

const GRAN_UNIT: Record<Granularity, string> = {
  day:     "día",
  week:    "semana",
  month:   "mes",
  quarter: "trimestre",
  year:    "año",
};

export default function ChurnSuscripcionesPage() {
  const [period, setPeriod] = useState<Period>("90d");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [drillRange, setDrillRange] = useState<{ start: string; end: string } | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ChurnResp>({
    queryKey: ["gerencia-churn", period, granularity],
    queryFn: () => api<ChurnResp>(`/api/dashboards/gerencia/churn-suscripciones?period=${period}&granularity=${granularity}`),
    staleTime: 120_000,
  });

  const { data: drillData, isLoading: drillLoading } = useQuery<DrillDownResp>({
    queryKey: ["gerencia-churn-drill", drillRange?.start, drillRange?.end],
    queryFn: () => api<DrillDownResp>(
      `/api/dashboards/gerencia/churn-suscripciones/drill-down?period_start=${drillRange!.start}&period_end=${drillRange!.end}`,
    ),
    enabled: !!drillRange,
    staleTime: 120_000,
  });

  const queryClient = useQueryClient();

  const { data: insight } = useQuery<InsightResp>({
    queryKey: ["gerencia-churn-insight", period, granularity],
    queryFn: () => api<InsightResp>(
      `/api/dashboards/gerencia/churn-suscripciones/insights?period=${period}&granularity=${granularity}`,
    ),
    staleTime: 300_000,
  });

  const analyzeMutation = useMutation<InsightPayload, Error, { force: boolean }>({
    mutationFn: async ({ force }) => {
      return api<InsightPayload>(
        `/api/dashboards/gerencia/churn-suscripciones/analyze?period=${period}&granularity=${granularity}&force=${force}`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gerencia-churn-insight", period, granularity] });
    },
  });

  return (
    <>
      <Topbar title="Churn de Suscripciones" subtitle="Cancelaciones MELI y fricción del form" hidePeriod />
      <TodayPanel />
      <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-text flex items-center gap-2">
              <TrendingDown className="w-6 h-6 text-primary" />
              Churn de Suscripciones MELI
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Cancelaciones formales · revenue real Talo · análisis IA con Gemini · click en una barra del chart para drill-down al período.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-sm font-medium transition ${
                    period === p.value
                      ? "bg-primary text-white"
                      : "bg-white text-text-muted hover:bg-bg"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-muted hover:bg-bg transition disabled:opacity-60"
            >
              {isFetching ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="p-12 text-center text-text-muted bg-white rounded-xl border border-border">
            Cargando datos de churn...
          </div>
        )}

        {isError && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            Error cargando datos: {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                icon={<XCircle className="w-4 h-4" />}
                label="Solicitudes"
                value={String(data.kpis.total_requests)}
                accent="primary"
              />
              <KpiCard
                icon={<DollarSign className="w-4 h-4" />}
                label="Revenue churned"
                value={fmtMoney(data.kpis.revenue_churned_real_arg ?? data.kpis.revenue_churned_arg)}
                accent="rose"
                hint={
                  data.kpis.revenue_churned_real_arg != null
                    ? `Real Talo · declarado ${fmtMoney(data.kpis.revenue_churned_arg)}${
                        data.kpis.revenue_churned_arg > 0
                          ? ` (${((data.kpis.revenue_churned_real_arg / data.kpis.revenue_churned_arg - 1) * 100).toFixed(1)}%)`
                          : ""
                      }`
                    : "Acumulado declarado al solicitar baja"
                }
              />
              <KpiCard
                icon={<Clock className="w-4 h-4" />}
                label="Pendiente reembolso"
                value={fmtMoney(data.kpis.pending_refund_arg)}
                accent="amber"
                hint="Suma de refund_amount_arg solicitado"
              />
              <KpiCard
                icon={<CheckCircle2 className="w-4 h-4" />}
                label="Tasa éxito form"
                value={data.kpis.form_completion_rate_pct != null ? `${data.kpis.form_completion_rate_pct}%` : "—"}
                accent={(data.kpis.form_completion_rate_pct ?? 100) >= 90 ? "emerald" : (data.kpis.form_completion_rate_pct ?? 100) >= 70 ? "amber" : "rose"}
                hint="submits exitosos vs errores telemetría"
              />
              <KpiCard
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Errores form"
                value={String(data.kpis.total_form_errors)}
                accent="rose"
                hint={`${data.kpis.distinct_failed_users} usuarios distintos afectados`}
              />
              <KpiCard
                icon={<CheckCircle2 className="w-4 h-4" />}
                label="Cancel. completas"
                value={String(data.kpis.integration_cancelled)}
                accent="emerald"
                hint="Integración MELI ya dada de baja"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5">
                <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-text">
                      Evolución de cancelaciones · click en una barra para ver detalle
                    </h2>
                    <EvolutionSubtitle stats={data.evolution.stats} granularity={data.granularity} />
                  </div>
                  <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                    {GRANULARITIES.map((g) => (
                      <button
                        key={g.value}
                        onClick={() => setGranularity(g.value)}
                        className={`px-2.5 py-1 text-xs font-medium transition ${
                          granularity === g.value
                            ? "bg-primary text-white"
                            : "bg-white text-text-muted hover:bg-bg"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-64">
                  {data.evolution.series.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-text-muted">Sin datos</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.evolution.series} style={{ cursor: "pointer" }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="period_start"
                          tickFormatter={(v) => fmtBucket(String(v), data.granularity)}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          labelFormatter={(label) => fmtBucketLong(String(label), data.granularity)}
                          cursor={{ fill: "rgba(162, 89, 255, 0.08)" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {(() => {
                          const handleBarClick = (entry: unknown) => {
                            const p = (entry as { payload?: EvolutionBucket; period_start?: string; period_end?: string });
                            const ps = p?.payload?.period_start ?? p?.period_start;
                            const pe = p?.payload?.period_end ?? p?.period_end;
                            if (ps && pe) setDrillRange({ start: ps, end: pe });
                          };
                          return (
                            <>
                              <Bar dataKey="pending"               stackId="s" name="Pendiente"     fill={STATUS_META.pending.color}               onClick={handleBarClick} style={{ cursor: "pointer" }} />
                              <Bar dataKey="transferred"           stackId="s" name="Transferido"   fill={STATUS_META.transferred.color}           onClick={handleBarClick} style={{ cursor: "pointer" }} />
                              <Bar dataKey="integration_cancelled" stackId="s" name="Cancel. MELI"  fill={STATUS_META.integration_cancelled.color} onClick={handleBarClick} style={{ cursor: "pointer" }} />
                              <Bar dataKey="rejected"              stackId="s" name="Rechazada"     fill={STATUS_META.rejected.color}              onClick={handleBarClick} style={{ cursor: "pointer" }}>
                                <LabelList
                                  dataKey="total"
                                  position="top"
                                  fill="#0f172a"
                                  fontSize={11}
                                  fontWeight={600}
                                  formatter={(v) => (typeof v === "number" && v > 0 ? String(v) : "")}
                                />
                              </Bar>
                            </>
                          );
                        })()}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-border p-5">
                <h2 className="text-sm font-semibold text-text mb-4">Razones de cancelación</h2>
                <div className="h-64">
                  {data.by_reason.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-text-muted">Sin datos</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.by_reason.map((r) => ({ name: ABANDONMENT_LABELS[r.reason] || r.reason, value: r.count }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={85}
                          paddingAngle={2}
                        >
                          {data.by_reason.map((_, i) => (
                            <Cell key={i} fill={REASON_COLORS[i % REASON_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-xs max-h-32 overflow-auto">
                  {data.by_reason.map((r, i) => (
                    <div key={r.reason} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: REASON_COLORS[i % REASON_COLORS.length] }} />
                        <span className="text-text-muted truncate">{ABANDONMENT_LABELS[r.reason] || r.reason}</span>
                      </span>
                      <span className="font-mono font-semibold text-text">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-text flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Errores del formulario (telemetría)
                  </h2>
                </div>
                {data.telemetry_by_kind.length === 0 ? (
                  <div className="py-8 text-center text-sm text-text-muted">Sin errores registrados</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-text-muted border-b border-border">
                        <th className="text-left py-2 font-semibold">Tipo</th>
                        <th className="text-right py-2 font-semibold">Eventos</th>
                        <th className="text-right py-2 font-semibold">Usuarios</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.telemetry_by_kind.map((t) => (
                        <tr key={t.kind} className="border-b border-border last:border-0">
                          <td className="py-2 text-text">{TELEMETRY_LABELS[t.kind] || t.kind}</td>
                          <td className="py-2 text-right font-mono font-semibold text-text">{t.count}</td>
                          <td className="py-2 text-right font-mono text-text-muted">{t.distinct_incidents}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {data.failed_users.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2">
                      Usuarios con errores recientes ({data.failed_users.length})
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-auto">
                      {data.failed_users.map((u, i) => (
                        <div key={`${u.dni}-${u.kind}-${i}`} className="text-xs flex items-start justify-between gap-2 p-2 rounded bg-bg">
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-text">DNI {u.dni}</div>
                            {u.email && <div className="text-text-muted truncate">{u.email}</div>}
                            {u.messages && <div className="text-text-muted truncate text-[10px] mt-0.5">{u.messages}</div>}
                          </div>
                          <div className="text-right text-text-muted text-[10px] shrink-0">
                            <div>{u.attempts}×</div>
                            <div>{fmtDateTime(u.last_seen)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-border p-5">
                <h2 className="text-sm font-semibold text-text mb-3">Distribución por plan</h2>
                {data.by_plan.length === 0 ? (
                  <div className="py-8 text-center text-sm text-text-muted">Sin datos</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-text-muted border-b border-border">
                        <th className="text-left py-2 font-semibold">Plan</th>
                        <th className="text-right py-2 font-semibold">Cancelaciones</th>
                        <th className="text-right py-2 font-semibold">$ histórico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_plan.map((p) => (
                        <tr key={p.plan} className="border-b border-border last:border-0">
                          <td className="py-2 text-text truncate max-w-[180px]">{p.plan}</td>
                          <td className="py-2 text-right font-mono font-semibold text-text">{p.count}</td>
                          <td className="py-2 text-right font-mono text-text-muted">{fmtMoney(p.paid_total_arg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <AIInsightCard
              insight={insight}
              loading={analyzeMutation.isPending}
              error={analyzeMutation.error}
              onAnalyze={(force: boolean) => analyzeMutation.mutate({ force })}
              freshResult={analyzeMutation.data}
            />

            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">Solicitudes recientes ({data.recent_requests.length})</h2>
                <Link
                  href="/dashboard/finanzas/dev-suscripciones"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Ver bandeja Finanzas <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg">
                    <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                      <th className="text-left px-3 py-2 font-semibold">Dropshipper</th>
                      <th className="text-left px-3 py-2 font-semibold">Plan</th>
                      <th className="text-left px-3 py-2 font-semibold">Motivo</th>
                      <th className="text-right px-3 py-2 font-semibold">$ Solicitado</th>
                      <th className="text-right px-3 py-2 font-semibold">$ Histórico</th>
                      <th className="text-left px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_requests.map((r) => {
                      const meta = STATUS_META[r.status];
                      return (
                        <tr key={r.id} className="border-t border-border hover:bg-bg/50">
                          <td className="px-3 py-2 text-text-muted font-mono text-xs whitespace-nowrap">
                            {fmtDate(r.created_at)}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/dashboard/dropshipper/${r.dropshipper_user_id}`}
                              className="text-text hover:text-primary hover:underline font-medium"
                            >
                              {r.name}
                            </Link>
                            {r.fantasy_name && (
                              <div className="text-xs text-text-muted truncate max-w-[200px]">{r.fantasy_name}</div>
                            )}
                            <div className="text-[10px] text-text-muted font-mono">DNI {r.dni}</div>
                          </td>
                          <td className="px-3 py-2 text-text-muted text-xs">{r.plan || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="text-xs text-text">{ABANDONMENT_LABELS[r.abandonment_reason] || r.abandonment_reason}</div>
                            {r.reason && (
                              <div className="text-[10px] text-text-muted truncate max-w-[280px] italic mt-0.5">
                                "{r.reason}"
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-text whitespace-nowrap">
                            {fmtMoney(r.refund_amount_arg)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-text-muted whitespace-nowrap">
                            {fmtMoney(r.paid_subscription_total_arg)}
                            {r.paid_subscription_count != null && (
                              <div className="text-[10px]">({r.paid_subscription_count} cobros)</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.bg} ${meta.border} ${meta.text}`}>
                              {meta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {drillRange && (
          <DrillDownModal
            range={drillRange}
            granularity={data?.granularity ?? "month"}
            data={drillData}
            loading={drillLoading}
            onClose={() => setDrillRange(null)}
          />
        )}
      </div>
    </>
  );
}

function EvolutionSubtitle({
  stats, granularity,
}: {
  stats: ChurnResp["evolution"]["stats"];
  granularity: Granularity;
}) {
  const unit = GRAN_UNIT[granularity];
  const trendIcon = stats.trend === "up" ? (
    <TrendingUp className="w-3.5 h-3.5 text-rose-500 inline" />
  ) : stats.trend === "down" ? (
    <TrendingDown className="w-3.5 h-3.5 text-emerald-500 inline" />
  ) : (
    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 inline" />
  );
  const trendLabel = stats.trend === "up" ? "tendencia ↗ subiendo" : stats.trend === "down" ? "tendencia ↘ bajando" : "tendencia → estable";
  const peakText = stats.peak > 0 && stats.peak_period_start
    ? `Pico: ${stats.peak} cancelaciones · ${fmtBucketLong(stats.peak_period_start, granularity)}`
    : "Sin cancelaciones en el rango";
  return (
    <div className="text-xs text-text-muted mt-1 flex items-center gap-2 flex-wrap">
      <span className="font-medium text-text">{peakText}</span>
      <span className="text-zinc-300">·</span>
      <span>Media: <span className="font-semibold text-text">{stats.average}/{unit}</span></span>
      <span className="text-zinc-300">·</span>
      <span className="flex items-center gap-1">{trendIcon} {trendLabel}</span>
    </div>
  );
}

function DrillDownModal({
  range, granularity, data, loading, onClose,
}: {
  range: { start: string; end: string };
  granularity: Granularity;
  data: DrillDownResp | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted font-semibold">Detalle del período</div>
            <h2 className="text-lg font-bold text-text mt-0.5">{fmtBucketLong(range.start, granularity)}</h2>
            {data && (
              <div className="text-xs text-text-muted mt-1">
                {data.total_requests} solicitudes · {fmtMoney(data.revenue_churned_arg)} histórico · {fmtMoney(data.pending_refund_arg)} pendiente
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg text-text-muted hover:text-text transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-12 text-center text-text-muted">Cargando detalle...</div>
          )}

          {data && data.requests.length === 0 && (
            <div className="p-12 text-center text-text-muted">Sin solicitudes en este período.</div>
          )}

          {data && data.requests.length > 0 && (
            <>
              {data.by_reason.length > 0 && (
                <div className="px-5 py-3 bg-bg border-b border-border flex flex-wrap gap-2">
                  {data.by_reason.map((r) => (
                    <span
                      key={r.reason}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-border text-xs"
                    >
                      <span className="text-text-muted">{ABANDONMENT_LABELS[r.reason] || r.reason}</span>
                      <span className="font-mono font-bold text-text">{r.count}</span>
                    </span>
                  ))}
                </div>
              )}
              <table className="w-full text-sm">
                <thead className="bg-bg sticky top-0">
                  <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                    <th className="text-left px-4 py-2 font-semibold">Fecha</th>
                    <th className="text-left px-4 py-2 font-semibold">Dropshipper</th>
                    <th className="text-left px-4 py-2 font-semibold">Plan</th>
                    <th className="text-left px-4 py-2 font-semibold">Motivo / Comentario</th>
                    <th className="text-right px-4 py-2 font-semibold">$ Solicitado</th>
                    <th className="text-right px-4 py-2 font-semibold">$ Histórico</th>
                    <th className="text-left px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-bg/50">
                        <td className="px-4 py-2 text-text-muted font-mono text-xs whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/dashboard/dropshipper/${r.dropshipper_user_id}`}
                            className="text-text hover:text-primary hover:underline font-medium"
                            target="_blank"
                          >
                            {r.name}
                          </Link>
                          {r.fantasy_name && <div className="text-xs text-text-muted truncate max-w-[200px]">{r.fantasy_name}</div>}
                          <div className="text-[10px] text-text-muted font-mono">DNI {r.dni}</div>
                        </td>
                        <td className="px-4 py-2 text-text-muted text-xs">{r.plan || "—"}</td>
                        <td className="px-4 py-2">
                          <div className="text-xs text-text">{ABANDONMENT_LABELS[r.abandonment_reason] || r.abandonment_reason}</div>
                          {r.reason && <div className="text-[10px] text-text-muted italic mt-0.5 max-w-[280px]">&quot;{r.reason}&quot;</div>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-text whitespace-nowrap">{fmtMoney(r.refund_amount_arg)}</td>
                        <td className="px-4 py-2 text-right font-mono text-text-muted whitespace-nowrap">{fmtMoney(r.paid_subscription_total_arg)}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.bg} ${meta.border} ${meta.text}`}>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SEVERITY_META: Record<"high" | "medium" | "low", { label: string; bg: string; border: string; text: string; dot: string }> = {
  high:   { label: "Alta",   bg: "bg-rose-50",    border: "border-rose-300",    text: "text-rose-700",    dot: "bg-rose-500"   },
  medium: { label: "Media",  bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-700",   dot: "bg-amber-500"  },
  low:    { label: "Baja",   bg: "bg-zinc-50",    border: "border-zinc-300",    text: "text-zinc-700",    dot: "bg-zinc-400"   },
};

const URGENCY_META: Record<"urgent" | "this_week" | "monitor", { label: string; bg: string; text: string }> = {
  urgent:    { label: "Urgente",       bg: "bg-rose-100",    text: "text-rose-700" },
  this_week: { label: "Esta semana",   bg: "bg-amber-100",   text: "text-amber-700" },
  monitor:   { label: "Monitorear",    bg: "bg-zinc-100",    text: "text-zinc-700" },
};

function AIInsightCard({
  insight, loading, error, onAnalyze, freshResult,
}: {
  insight: InsightResp | undefined;
  loading: boolean;
  error: Error | null;
  onAnalyze: (force: boolean) => void;
  freshResult: InsightPayload | undefined;
}) {
  const payload: InsightPayload | null =
    freshResult ??
    (insight && insight.has_insight ? insight.payload : null);
  const meta = insight && insight.has_insight ? insight : null;
  const hasContent = !!payload && (!!payload.summary || (payload.patterns?.length ?? 0) > 0 || (payload.action_recommendations?.length ?? 0) > 0);

  return (
    <div className="bg-gradient-to-br from-violet-50 via-white to-violet-50/30 rounded-xl border border-violet-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-md shadow-primary/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">Análisis IA del churn</h2>
            <p className="text-xs text-text-muted">
              {meta
                ? `Generado ${fmtDateTime(meta.created_at)} por ${meta.generated_by_email ?? "—"} · modelo ${meta.model ?? "—"}${meta.duration_ms ? ` · ${(meta.duration_ms / 1000).toFixed(1)}s` : ""}`
                : "Gemini 2.5 Flash clasifica las razones libres y sugiere acciones por dropshipper."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (
            <button
              onClick={() => onAnalyze(true)}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg border border-violet-300 text-primary hover:bg-violet-50 transition disabled:opacity-60 font-semibold"
            >
              {loading ? (<><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Re-analizando...</>) : "Re-analizar"}
            </button>
          )}
          {!hasContent && (
            <button
              onClick={() => onAnalyze(false)}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold shadow-md shadow-primary/30 hover:shadow-lg transition disabled:opacity-60"
            >
              {loading ? (<><Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Analizando con Gemini...</>) : "Analizar con IA"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2">
          Falló el análisis: {error.message}
        </div>
      )}

      {!hasContent && !loading && !error && (
        <div className="rounded-lg bg-white/60 border border-violet-100 p-4 text-sm text-text-muted">
          Todavía no hay análisis IA para este período + granularidad. Apretá <span className="font-semibold text-primary">Analizar con IA</span> para generar uno con las cancelaciones actuales. El resultado se persiste para verlo después sin re-generar.
        </div>
      )}

      {payload?.summary && (
        <div className="rounded-lg bg-white/80 border border-violet-100 p-4">
          <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Resumen ejecutivo</div>
          <p className="text-sm text-text leading-relaxed">{payload.summary}</p>
        </div>
      )}

      {(payload?.patterns?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Hallazgos ({payload!.patterns.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {payload!.patterns.map((p, i) => {
              const sev = SEVERITY_META[p.severity];
              return (
                <div key={i} className={`rounded-lg border p-3 ${sev.bg} ${sev.border}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                      <span className="text-sm font-semibold text-text">{p.title}</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${sev.text}`}>{sev.label}</span>
                  </div>
                  <p className="text-xs text-text-muted">{p.evidence}</p>
                  {p.metric && <div className="text-[10px] text-text-muted mt-1 font-mono">{p.metric}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(payload?.taxonomy_breakdown?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Taxonomía (clasificación LLM del campo libre)
          </div>
          <div className="space-y-1.5">
            {payload!.taxonomy_breakdown.map((t, i) => (
              <div key={i} className="bg-white/60 rounded-lg border border-violet-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">
                    {t.category}
                    {t.subcategory && <span className="text-text-muted font-normal"> · {t.subcategory}</span>}
                  </span>
                  <span className="text-sm font-mono font-bold text-primary">{t.count}</span>
                </div>
                {t.examples && t.examples.length > 0 && (
                  <div className="text-[11px] text-text-muted italic mt-0.5">
                    {t.examples.slice(0, 2).map((e) => `"${e.slice(0, 80)}"`).join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(payload?.action_recommendations?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Recomendaciones de acción ({payload!.action_recommendations.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-muted border-b border-violet-100">
                  <th className="text-left py-2 px-2 font-semibold">Urgencia</th>
                  <th className="text-left py-2 px-2 font-semibold">Target</th>
                  <th className="text-left py-2 px-2 font-semibold">Acción · razón</th>
                  <th className="text-right py-2 px-2 font-semibold">Impacto $</th>
                </tr>
              </thead>
              <tbody>
                {payload!.action_recommendations.map((a, i) => {
                  const urg = URGENCY_META[a.urgency];
                  return (
                    <tr key={i} className="border-b border-violet-100 last:border-0">
                      <td className="py-2 px-2 align-top">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${urg.bg} ${urg.text}`}>
                          {urg.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 align-top">
                        <div className="text-[10px] uppercase tracking-wider text-text-muted">{a.scope}</div>
                        {a.target_dropshipper_id ? (
                          <Link
                            href={`/dashboard/dropshipper/${a.target_dropshipper_id}`}
                            target="_blank"
                            className="text-text hover:text-primary hover:underline font-medium text-sm"
                          >
                            {a.target_label} <ExternalLink className="w-3 h-3 inline" />
                          </Link>
                        ) : (
                          <span className="text-text font-medium text-sm">{a.target_label}</span>
                        )}
                        {a.target_dni && <div className="text-[10px] text-text-muted font-mono">DNI {a.target_dni}</div>}
                      </td>
                      <td className="py-2 px-2 align-top">
                        <div className="text-sm text-text">{a.action}</div>
                        <div className="text-[11px] text-text-muted mt-0.5 italic">{a.reasoning}</div>
                      </td>
                      <td className="py-2 px-2 text-right align-top font-mono text-text-muted text-sm whitespace-nowrap">
                        {a.expected_impact_arg != null && a.expected_impact_arg > 0 ? fmtMoney(a.expected_impact_arg) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon, label, value, accent, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "primary" | "rose" | "amber" | "emerald";
  hint?: string;
}) {
  const accentMap: Record<string, string> = {
    primary: "bg-violet-100 text-primary",
    rose:    "bg-rose-100 text-rose-600",
    amber:   "bg-amber-100 text-amber-600",
    emerald: "bg-emerald-100 text-emerald-600",
  };
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${accentMap[accent]}`}>
          {icon}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">{label}</span>
      </div>
      <div className="text-xl font-bold text-text leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1 leading-snug">{hint}</div>}
    </div>
  );
}
