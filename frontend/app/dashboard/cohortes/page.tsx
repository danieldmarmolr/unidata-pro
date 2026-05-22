"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles, Repeat, Users, TrendingUp, RotateCcw, ShoppingBag, DollarSign,
  ChevronRight, Receipt, Star, AlertTriangle, Skull,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { CohortInlineTable } from "@/components/cohort-inline-table";
import { api } from "@/lib/api";
import { X } from "lucide-react";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { useUnitFromQuery, type Unit } from "@/lib/use-unit-from-query";
import { formatCurrency, formatNumber } from "@/lib/utils";

type StateKey =
  | "nuevo"
  | "segunda_compra"
  | "conv_recurrente"
  | "recurrente"
  | "recuperado"
  | "posible_churn"
  | "perdidos";

type StateBlock = {
  key: StateKey;
  label: string;
  color: string;
  description?: string;
  customers: number;
  ordenes: number;
  facturacion: number;
  ticket_promedio: number;
};

type CohortsResponse = {
  unit: string;
  totals: {
    customers: number;
    ordenes: number;
    facturacion: number;
    ticket_promedio: number;
  };
  states: StateBlock[];
  generated_at: string;
};

const STATE_ICON: Record<StateKey, any> = {
  nuevo: Sparkles,
  segunda_compra: Repeat,
  conv_recurrente: TrendingUp,
  recurrente: Star,
  recuperado: RotateCcw,
  posible_churn: AlertTriangle,
  perdidos: Skull,
};

export default function CohortesPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [unit, setUnit, unitLocked] = useUnitFromQuery("unistore");
  const [drillState, setDrillState] = useState<{ state: StateKey; label: string; color: string } | null>(null);

  const { data, isLoading, isFetching } = useQuery<CohortsResponse>({
    queryKey: ["cohorts", period, customFrom, customTo, unit],
    queryFn: () => api(`/api/dashboards/cohorts?${_qs}&unit=${unit}`),
    staleTime: 60_000,
  });

  // Separar los estados de actividad de los de alerta
  const activeStates = (data?.states ?? []).filter((s) =>
    !["posible_churn", "perdidos"].includes(s.key)
  );
  const alertStates = (data?.states ?? []).filter((s) =>
    ["posible_churn", "perdidos"].includes(s.key)
  );

  const labelClientes = unit === "unidrop" ? "dropshippers" : "clientes";

  return (
    <>
      <Topbar
        title="Análisis de Cohortes"
        subtitle={
          unit === "unistore"
            ? "Distribución de clientes finales · Nuevo → 2da → Recurrente → Recuperado · alertas Posible churn / Perdidos"
            : "Distribución de dropshippers Unidrop por actividad de ventas · alertas Posible churn / Perdidos"
        }
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <TodayPanel unit={unit} context="clientes" title="HOY · Cohortes" />
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <Segmented<Unit>
              value={unit}
              onChange={setUnit}
              disabled={unitLocked}
              lockedHint={unitLocked ? `Fijado a ${unit}` : undefined}
              options={[
                { value: "unistore", label: "Unistore (clientes finales)" },
                { value: "unidrop", label: "Unidrop (dropshippers)" },
              ]}
            />
          }
        />

        {/* KPIs cabecera */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <KpiBox icon={Users} label={`${labelClientes} en periodo`} value={formatNumber(data.totals.customers)} accent="primary" />
              <KpiBox icon={ShoppingBag} label={unit === "unidrop" ? "Ventas totales" : "Ordenes"} value={formatNumber(data.totals.ordenes)} accent="emerald" />
              {unit === "unistore" ? (
                <>
                  <KpiBox icon={DollarSign} label="Facturación" value={formatCurrency(data.totals.facturacion)} accent="amber" />
                  <KpiBox icon={Receipt} label="Ticket promedio" value={formatCurrency(data.totals.ticket_promedio)} accent="rose" />
                </>
              ) : (
                <>
                  <KpiBox icon={AlertTriangle} label="Posible churn" value={formatNumber(alertStates.find((s) => s.key === "posible_churn")?.customers ?? 0)} accent="rose" />
                  <KpiBox icon={Skull} label="Perdidos" value={formatNumber(alertStates.find((s) => s.key === "perdidos")?.customers ?? 0)} accent="rose" />
                </>
              )}
            </>
          )}
        </div>

        {/* Banner alertas (Posible churn + Perdidos) */}
        {data && alertStates.length > 0 && (alertStates.some((s) => s.customers > 0)) && (
          <div className="bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border border-rose-200 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
            <AlertTriangle size={18} className="text-rose-600 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-rose-900">Alertas de retención</div>
              <div className="text-rose-700/80">
                Hay {labelClientes} que se pasaron de su valor esperado entre días — accionalos para evitar churn.
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {alertStates.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setDrillState({ state: s.key, label: s.label, color: s.color })}
                  className="bg-white/80 border border-rose-300 rounded-lg px-3 py-1.5 hover:bg-white hover:shadow-sm transition text-left"
                  style={{ borderColor: s.color + "60" }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</div>
                  <div className="text-base font-extrabold tabular-nums">{formatNumber(s.customers)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tabla inline cuando hay etiqueta seleccionada (aparece arriba de las cards) */}
        {drillState && (
          <CohortInlineTable
            state={drillState.state}
            stateLabel={drillState.label}
            color={drillState.color}
            unit={unit}
            qs={_qs}
            onClose={() => setDrillState(null)}
          />
        )}

        {/* Cards de estados activos (cohortes) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          {isLoading || !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-48 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            activeStates.map((s) => {
              const Icon = STATE_ICON[s.key];
              const pct = data.totals.customers ? (s.customers / data.totals.customers) * 100 : 0;
              return (
                <button
                  key={s.key}
                  onClick={() => setDrillState({ state: s.key, label: s.label, color: s.color })}
                  className="bg-surface border-2 border-border rounded-xl p-4 hover:shadow-lg transition text-left group"
                  style={{ borderColor: `${s.color}30` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-md flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${s.color}, ${s.color}dd)` }}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-text">{s.label}</div>
                      <div className="text-[10px] text-text-muted truncate">{s.description}</div>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between mb-1">
                    <div className="text-3xl font-extrabold text-text tabular-nums">
                      {formatNumber(s.customers)}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: s.color }}>
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-[11px] text-text-muted mb-3">{labelClientes}</div>

                  <div className="space-y-1.5 text-xs pt-2 border-t border-border">
                    <div className="flex justify-between">
                      <span className="text-text-muted">{unit === "unidrop" ? "Ventas" : "Ordenes"}</span>
                      <span className="font-semibold tabular-nums">{formatNumber(s.ordenes)}</span>
                    </div>
                    {unit === "unistore" && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-text-muted">Facturación</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(s.facturacion)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-text-muted">Ticket prom.</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(s.ticket_promedio)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition" style={{ color: s.color }}>
                    Ver {labelClientes} <ChevronRight size={11} />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

    </>
  );
}

function KpiBox({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: "primary" | "emerald" | "amber" | "rose" }) {
  const accentClasses = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-pink-500",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:shadow-md transition">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accentClasses[accent]} text-white flex items-center justify-center shadow-md`}>
          <Icon size={14} />
        </div>
      </div>
      <div className="text-xl font-extrabold text-text tabular-nums">{value}</div>
    </div>
  );
}
