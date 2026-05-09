"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Sparkles,
  Repeat,
  Users,
  TrendingUp,
  RotateCcw,
  ShoppingBag,
  DollarSign,
  ChevronRight,
  Receipt,
  Star,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

type StateKey = "nuevo" | "segunda_compra" | "conv_recurrente" | "recurrente" | "recuperado";

type StateBlock = {
  key: StateKey;
  label: string;
  color: string;
  customers: number;
  ordenes: number;
  facturacion: number;
  ticket_promedio: number;
};

type Customer = {
  customer_id: number;
  nombre: string;
  ordenes_total: number;
  ordenes_periodo: number;
  facturacion_periodo: number;
  primera_compra: string | null;
  ultima_compra: string | null;
};

type CohortsResponse = {
  totals: {
    customers: number;
    ordenes: number;
    facturacion: number;
    ticket_promedio: number;
  };
  states: StateBlock[];
  top_by_state: Record<StateKey, Customer[]>;
  generated_at: string;
};

const STATE_ICON: Record<StateKey, any> = {
  nuevo: Sparkles,
  segunda_compra: Repeat,
  conv_recurrente: TrendingUp,
  recurrente: Star,
  recuperado: RotateCcw,
};

const STATE_DESC: Record<StateKey, string> = {
  nuevo: "Primera compra del cliente",
  segunda_compra: "2da orden del historial",
  conv_recurrente: "3ra orden = transición a recurrente",
  recurrente: "4+ ordenes activas",
  recuperado: "Cliente con compra >180d que volvió",
};

export default function CohortesPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [selectedState, setSelectedState] = useState<StateKey | null>(null);

  const { data, isLoading, isFetching } = useQuery<CohortsResponse>({
    queryKey: ["cohorts", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/cohorts?${_qs}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Análisis de Cohortes"
        subtitle="Distribución de clientes por estado · Nuevo → 2da → Recurrente → Recuperado · Unistore"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <DashboardHeader generatedAt={data?.generated_at} isFetching={isFetching} filters={null} />

        {/* KPIs cabecera */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <KpiBox icon={Users} label="Clientes en periodo" value={formatNumber(data.totals.customers)} accent="primary" />
              <KpiBox icon={ShoppingBag} label="Ordenes" value={formatNumber(data.totals.ordenes)} accent="emerald" />
              <KpiBox icon={DollarSign} label="Facturación" value={formatCurrency(data.totals.facturacion)} accent="amber" />
              <KpiBox icon={Receipt} label="Ticket promedio" value={formatCurrency(data.totals.ticket_promedio)} accent="rose" />
            </>
          )}
        </div>

        {/* Cards de estados (cohortes) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-48 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            data.states.map((s) => {
              const Icon = STATE_ICON[s.key];
              const pct = data.totals.customers ? (s.customers / data.totals.customers) * 100 : 0;
              return (
                <button
                  key={s.key}
                  onClick={() => setSelectedState(s.key)}
                  className="bg-surface border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-lg transition text-left group"
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
                      <div className="text-[10px] text-text-muted truncate">{STATE_DESC[s.key]}</div>
                    </div>
                  </div>

                  <div className="text-3xl font-extrabold text-text tabular-nums mb-1">
                    {formatNumber(s.customers)}
                  </div>
                  <div className="text-[11px] text-text-muted mb-3">
                    clientes ({pct.toFixed(1)}%)
                  </div>

                  <div className="space-y-1.5 text-xs pt-3 border-t border-border">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Ordenes</span>
                      <span className="font-semibold tabular-nums">{formatNumber(s.ordenes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Facturación</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(s.facturacion)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Ticket prom.</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(s.ticket_promedio)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-primary font-semibold opacity-0 group-hover:opacity-100 transition">
                    Ver clientes <ChevronRight size={11} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Drilldown lista clientes (cuando se selecciona un estado) */}
        {selectedState && data && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-text">
                  Top 10 clientes — {data.states.find((s) => s.key === selectedState)?.label}
                </h3>
                <p className="text-[11px] text-text-muted">
                  Ordenados por facturación en el periodo
                </p>
              </div>
              <button
                onClick={() => setSelectedState(null)}
                className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border"
              >
                Cerrar
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2.5">Cliente</th>
                    <th className="text-right px-2 py-2.5">Ordenes (todas)</th>
                    <th className="text-right px-2 py-2.5">Ordenes periodo</th>
                    <th className="text-right px-2 py-2.5">Facturación periodo</th>
                    <th className="text-left px-2 py-2.5">Primera compra</th>
                    <th className="text-left px-2 py-2.5">Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.top_by_state[selectedState] ?? []).map((c) => (
                    <tr key={c.customer_id} className="border-t border-border hover:bg-soft/40 transition">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/dashboard/customer/${c.customer_id}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-text-muted">{c.ordenes_total}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c.ordenes_periodo}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-bold">{formatCurrency(c.facturacion_periodo)}</td>
                      <td className="px-2 py-2.5 text-xs text-text-muted">{c.primera_compra ?? "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-text-muted">{c.ultima_compra ?? "—"}</td>
                    </tr>
                  ))}
                  {(!data.top_by_state[selectedState] || data.top_by_state[selectedState].length === 0) && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-text-muted text-sm">
                        Sin clientes en este estado para el periodo seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
