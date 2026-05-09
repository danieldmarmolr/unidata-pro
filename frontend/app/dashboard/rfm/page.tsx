"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users,
  DollarSign,
  Calendar,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Segment = {
  key: string;
  label: string;
  color: string;
  icon: string;
  desc: string;
  customers: number;
  pct_total: number;
  monetary_total: number;
  frequency_total: number;
  ticket_avg: number;
};

type Customer = {
  customer_id: number;
  nombre: string;
  recency_days: number;
  frequency: number;
  monetary: number;
  r_score: number;
  f_score: number;
  m_score: number;
  segment: string;
};

type RfmResponse = {
  period_days: number;
  totals: {
    customers: number;
    monetary: number;
    frequency: number;
    avg_recency_days: number;
  };
  segments: Segment[];
  top_by_segment: Record<string, Customer[]>;
  generated_at: string;
};

type Unit = "unistore" | "unidrop";

export default function RfmPage() {
  const [period, setPeriod] = useState(365);
  const [unit, setUnit] = useState<Unit>("unistore");
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<RfmResponse>({
    queryKey: ["rfm", period, unit],
    queryFn: () => api(`/api/dashboards/rfm?period_days=${period}`),
    staleTime: 60_000,
    enabled: unit === "unistore",
  });

  return (
    <>
      <Topbar
        title="Segmentación RFM"
        subtitle="Recency · Frequency · Monetary · Champions hasta Lost · réplica del PowerBI"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <div className="flex items-center gap-2 flex-wrap">
              <Segmented<Unit>
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "unistore", label: "Unistore (clientes finales)" },
                  { value: "unidrop", label: "Unidrop (dropshippers)" },
                ]}
              />
              <select
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
              >
                <option value={90}>Últimos 90 días</option>
                <option value={180}>Últimos 180 días</option>
                <option value={365}>Último año</option>
                <option value={730}>Últimos 2 años</option>
              </select>
            </div>
          }
        />

        {unit === "unidrop" && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm">
            <div className="font-bold text-amber-900 mb-1">RFM de dropshippers Unidrop</div>
            <div className="text-amber-800 text-xs">
              Para análisis de actividad/recurrencia de operadores Unidrop usa{" "}
              <a href="/dashboard/cohortes?unit=unidrop" className="font-semibold underline">
                Cohortes (modo Unidrop)
              </a>
              . Allí se clasifican por Nuevo/Recurrente/Posible churn/Perdidos en base a sus ventas MELI + TN.
              <br />
              El scoring RFM clásico (Recency × Frequency × Monetary con quintiles) está disponible solo para clientes finales Unistore por ahora.
            </div>
          </div>
        )}

        {/* KPIs cabecera */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <KpiBox icon={Users} label="Clientes activos" value={formatNumber(data.totals.customers)} accent="primary" />
              <KpiBox icon={DollarSign} label="Volumen total" value={formatCurrency(data.totals.monetary)} accent="emerald" />
              <KpiBox icon={TrendingUp} label="Ordenes totales" value={formatNumber(data.totals.frequency)} accent="amber" />
              <KpiBox icon={Calendar} label="Recencia promedio" value={`${data.totals.avg_recency_days.toFixed(0)} días`} accent="rose" />
            </>
          )}
        </div>

        {/* Segments grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-44 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            data.segments.map((s) => (
              <button
                key={s.key}
                onClick={() => setSelectedSeg(s.key)}
                className="bg-surface border-2 rounded-xl p-4 hover:shadow-lg transition text-left group"
                style={{ borderColor: `${s.color}30` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-base shadow-md flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${s.color}, ${s.color}dd)` }}
                  >
                    {s.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-text">{s.label}</div>
                    <div className="text-[10px] text-text-muted truncate">{s.desc}</div>
                  </div>
                </div>

                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-2xl font-extrabold text-text tabular-nums">
                    {formatNumber(s.customers)}
                  </div>
                  <div className="text-xs font-semibold" style={{ color: s.color }}>
                    {s.pct_total.toFixed(1)}%
                  </div>
                </div>

                <div className="space-y-1 text-[11px] pt-2 border-t border-border">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Volumen</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(s.monetary_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Ticket avg</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(s.ticket_avg)}</span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition" style={{ color: s.color }}>
                  Ver clientes <ChevronRight size={11} />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Drilldown clientes */}
        {selectedSeg && data && data.top_by_segment[selectedSeg] && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-text">
                  Top 10 — {data.segments.find((s) => s.key === selectedSeg)?.label}
                </h3>
                <p className="text-[11px] text-text-muted">Ordenados por volumen</p>
              </div>
              <button
                onClick={() => setSelectedSeg(null)}
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
                    <th className="text-right px-2 py-2.5">R</th>
                    <th className="text-right px-2 py-2.5">F</th>
                    <th className="text-right px-2 py-2.5">M</th>
                    <th className="text-right px-2 py-2.5">Días desde compra</th>
                    <th className="text-right px-2 py-2.5">Ordenes</th>
                    <th className="text-right px-2 py-2.5">Volumen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_by_segment[selectedSeg].map((c) => (
                    <tr key={c.customer_id} className="border-t border-border hover:bg-soft/40 transition">
                      <td className="px-3 py-2.5">
                        <Link href={`/dashboard/customer/${c.customer_id}`} className="text-primary hover:underline font-medium">
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-bold text-emerald-600">{c.r_score}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-bold text-blue-600">{c.f_score}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-bold text-amber-600">{c.m_score}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c.recency_days}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c.frequency}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-bold">{formatCurrency(c.monetary)}</td>
                    </tr>
                  ))}
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
    <div className="bg-surface border border-border rounded-xl p-4">
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
