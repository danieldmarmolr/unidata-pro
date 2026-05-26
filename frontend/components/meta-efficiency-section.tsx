"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Megaphone, TrendingUp, Users, DollarSign, ArrowUpRight, AlertTriangle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

type MetaExplainResponse = {
  period: string;
  spend: number;
  models: {
    period_based: {
      name: string;
      spend_assigned: number;
      revenue_total_period: number;
      roas: number;
      description: string;
      drawback: string;
    };
    cohort_attributed: {
      name: string;
      spend_assigned: number;
      cohort_size: number;
      users_with_revenue: number;
      activation_rate_pct: number;
      revenue_attributed: number;
      ltv_first_30d: number;
      roas: number;
      rev_attribution_pct: number;
      description: string;
      drawback: string;
    };
  };
  funnel: {
    impressions: number;
    clicks: number;
    new_signups: number;
    new_subscriptions: number;
    users_with_revenue: number;
    cac_signup: number;
    cac_subscription: number;
    cpc: number;
  };
  recommendation: string;
  daily_overlay: { d: string; spend: number; clicks: number; signups: number; revenue: number }[];
};

export function MetaEfficiencySection({
  period,
  onExplainSpend,
}: {
  period: string;
  onExplainSpend: () => void;
}) {
  const { data, isLoading, error } = useQuery<MetaExplainResponse>({
    queryKey: ["meta-explain", period],
    queryFn: () => api(`/api/dashboards/gerencia/meta-explain?period=${period}`),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="h-[360px] bg-surface border border-border rounded-xl animate-pulse" />
    );
  }
  if (error || !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
        Error cargando eficiencia Meta Ads: {(error as Error | undefined)?.message ?? "sin datos"}
      </div>
    );
  }

  const { models, funnel, recommendation } = data;
  const periodModel = models.period_based;
  const cohortModel = models.cohort_attributed;
  const recommendsCohort = recommendation.toLowerCase().includes("cohort") || cohortModel.roas > periodModel.roas;

  return (
    <div className="space-y-4">
      {/* KPI cards de Eficiencia */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EffKpiCard
          icon={Users}
          label="CAC dropshipper"
          value={funnel.cac_signup > 0 ? formatCurrency(funnel.cac_signup) : "—"}
          hint={`${formatNumber(funnel.new_signups)} signups · ${formatCurrency(data.spend)} spend`}
          tone="primary"
        />
        <EffKpiCard
          icon={Users}
          label="CAC suscripción"
          value={funnel.cac_subscription > 0 ? formatCurrency(funnel.cac_subscription) : "—"}
          hint={`${formatNumber(funnel.new_subscriptions)} subs nuevas · activación ${cohortModel.activation_rate_pct.toFixed(1)}%`}
          tone="amber"
        />
        <EffKpiCard
          icon={DollarSign}
          label="LTV inicial 30d"
          value={cohortModel.ltv_first_30d > 0 ? formatCurrency(cohortModel.ltv_first_30d) : "—"}
          hint={`Revenue cohort en sus primeros 30 días`}
          tone="emerald"
        />
        <EffKpiCard
          icon={TrendingUp}
          label="ROAS cohort-attributed"
          value={cohortModel.roas > 0 ? `${cohortModel.roas.toFixed(2)}×` : "—"}
          hint={`vs ROAS period-based ${periodModel.roas.toFixed(2)}× (revenue total / spend)`}
          tone={cohortModel.roas >= 1 ? "emerald" : "rose"}
        />
      </div>

      {/* Comparativa side-by-side de los 2 modelos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ModelCard
          title="Modelo period-based"
          subtitle="Lo que hoy se resta en Gerencia"
          model={{
            spend: periodModel.spend_assigned,
            revenue: periodModel.revenue_total_period,
            roas: periodModel.roas,
            description: periodModel.description,
            drawback: periodModel.drawback,
          }}
          recommended={!recommendsCohort}
          tone="amber"
          onExplain={onExplainSpend}
          rows={[
            { label: "Spend del período", value: periodModel.spend_assigned, format: "currency" },
            { label: "Revenue total del período (todos los users)", value: periodModel.revenue_total_period, format: "currency" },
            { label: "ROAS gross", value: periodModel.roas, format: "x" },
          ]}
        />
        <ModelCard
          title="Modelo cohort-attributed"
          subtitle="Atribución por ventana de creación"
          model={{
            spend: cohortModel.spend_assigned,
            revenue: cohortModel.revenue_attributed,
            roas: cohortModel.roas,
            description: cohortModel.description,
            drawback: cohortModel.drawback,
          }}
          recommended={recommendsCohort}
          tone="emerald"
          rows={[
            { label: "Spend del período", value: cohortModel.spend_assigned, format: "currency" },
            { label: "Cohort capturada (signups)", value: cohortModel.cohort_size, format: "number" },
            { label: "Cohort que pagó", value: cohortModel.users_with_revenue, format: "number" },
            { label: "Activation rate", value: cohortModel.activation_rate_pct, format: "percent" },
            { label: "Revenue de la cohort en 30d", value: cohortModel.revenue_attributed, format: "currency" },
            { label: "LTV 30d (cohort)", value: cohortModel.ltv_first_30d, format: "currency" },
            { label: "% del revenue period atribuido", value: cohortModel.rev_attribution_pct, format: "percent" },
            { label: "ROAS atribuido", value: cohortModel.roas, format: "x" },
          ]}
        />
      </div>

      {/* Recomendación */}
      <div className="bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-primary font-bold mb-1">
              Recomendación
            </div>
            <p className="text-sm text-text leading-relaxed">{recommendation}</p>
            <div className="mt-3">
              <Link
                href="/dashboard/marketing/meta"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
              >
                Ver detalle completo de Meta Ads <ArrowUpRight size={11} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EffKpiCard({
  icon: Icon, label, value, hint, tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  hint: string;
  tone: "primary" | "emerald" | "amber" | "rose";
}) {
  const accent = {
    primary: "from-primary/10 to-accent/10 border-primary/20 text-primary",
    emerald: "from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-700",
    amber: "from-amber-50 to-amber-100 border-amber-200 text-amber-700",
    rose: "from-rose-50 to-rose-100 border-rose-200 text-rose-700",
  }[tone];
  return (
    <div className={cn("bg-gradient-to-br border rounded-xl p-3.5 shadow-sm", accent)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={11} className="opacity-80" />
        <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">{label}</div>
      </div>
      <div className="text-xl font-extrabold tabular-nums text-text">{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 truncate">{hint}</div>
    </div>
  );
}

function ModelCard({
  title, subtitle, model, recommended, tone, onExplain, rows,
}: {
  title: string;
  subtitle: string;
  model: { spend: number; revenue: number; roas: number; description: string; drawback: string };
  recommended: boolean;
  tone: "amber" | "emerald";
  onExplain?: () => void;
  rows: { label: string; value: number; format: "currency" | "number" | "percent" | "x" }[];
}) {
  const accent = tone === "emerald"
    ? "border-emerald-200 bg-emerald-50/30"
    : "border-amber-200 bg-amber-50/30";
  const fmt = (v: number, f: string) => {
    if (!Number.isFinite(v)) return "—";
    if (f === "currency") return formatCurrency(v);
    if (f === "percent") return `${v.toFixed(1)}%`;
    if (f === "x") return v > 0 ? `${v.toFixed(2)}×` : "—";
    return formatNumber(v);
  };
  return (
    <div className={cn("border-2 rounded-xl p-4 relative", accent)}>
      {recommended && (
        <div className="absolute -top-2.5 left-3 px-2 py-0.5 bg-primary text-white text-[9px] uppercase tracking-wider font-bold rounded-full shadow">
          Recomendado
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-bold text-text">{title}</div>
          <div className="text-[10px] text-text-muted">{subtitle}</div>
        </div>
        {onExplain && (
          <button
            onClick={onExplain}
            className="text-[10px] text-primary hover:underline shrink-0"
          >
            cálc →
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-muted leading-relaxed mb-3">{model.description}</p>

      <div className="space-y-1 mb-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-text-muted truncate">{r.label}</span>
            <span className="font-bold tabular-nums text-text">{fmt(r.value, r.format)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-1.5 bg-amber-100/60 border border-amber-200 rounded px-2 py-1.5 text-[10px] text-amber-900">
        <AlertTriangle size={10} className="mt-0.5 shrink-0" />
        <span>{model.drawback}</span>
      </div>
    </div>
  );
}
