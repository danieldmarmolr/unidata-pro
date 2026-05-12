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
import { ActionableFooter } from "@/components/actionable-footer";
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

type SegmentAction = { que_es: string; que_hacer: string };

type RfmResponse = {
  period_days: number;
  unit?: "unistore" | "unidrop";
  totals: {
    customers: number;
    monetary: number;
    frequency: number;
    avg_recency_days: number;
  };
  segments: Segment[];
  top_by_segment: Record<string, Customer[]>;
  actions?: Record<string, SegmentAction>;
  generated_at: string;
};

type Unit = "unistore" | "unidrop";

export default function RfmPage() {
  const [period, setPeriod] = useState(365);
  const [unit, setUnit] = useState<Unit>("unistore");
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<RfmResponse>({
    queryKey: ["rfm", period, unit],
    queryFn: () => api(`/api/dashboards/rfm?period_days=${period}&unit=${unit}`),
    staleTime: 60_000,
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
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4 text-xs leading-relaxed">
            <div className="font-bold text-violet-900 mb-1">RFM aplicado a dropshippers Unidrop</div>
            <div className="text-violet-800">
              <strong>Recency</strong> = dias desde su ultima venta · <strong>Frequency</strong> = total ventas MELI + TN en periodo ·
              <strong> Monetary</strong> = GMV total (totalAmount MELI + total TN paid).
              Los segmentos miden cuan saludables son tus dropshippers como clientes de la plataforma.
              Tocá cualquier card para ver qué hacer con ese segmento.
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

        {/* Modal con accion + lista del segmento seleccionado */}
        {selectedSeg && data && (
          <SegmentPopup
            seg={data.segments.find((s) => s.key === selectedSeg)!}
            action={data.actions?.[selectedSeg]}
            customers={data.top_by_segment[selectedSeg] ?? []}
            unit={unit}
            period={period}
            onClose={() => setSelectedSeg(null)}
          />
        )}
      </div>
    </>
  );
}

type SegmentCustomersResp = {
  segment: string;
  total: number;
  customers: (Customer & { email?: string; phone?: string; dni?: string })[];
  suggested_action?: SegmentAction;
};

function SegmentPopup({
  seg, action, customers, unit, period, onClose,
}: {
  seg: Segment;
  action?: SegmentAction;
  customers: Customer[];
  unit: Unit;
  period: number;
  onClose: () => void;
}) {
  const labelEntidad = unit === "unidrop" ? "Dropshipper" : "Cliente";

  // Lazy fetch lista COMPLETA para CSV / accion CS
  const { data: fullData, isLoading: loadingFull } = useQuery<SegmentCustomersResp>({
    queryKey: ["rfm-segment-customers", seg.key, unit, period],
    queryFn: () => api(`/api/dashboards/rfm/segment-customers?segment=${encodeURIComponent(seg.key)}&unit=${unit}&period_days=${period}`),
    staleTime: 60_000,
  });

  const fullList = fullData?.customers ?? [];
  const csvHeaders = unit === "unidrop"
    ? ["ID", "Nombre", "Email", "DNI", "R", "F", "M", "Dias recencia", "Ventas", "Volumen", "Ultima compra"]
    : ["ID", "Nombre", "Email", "Telefono", "R", "F", "M", "Dias recencia", "Ordenes", "Volumen", "Ultima compra"];
  const csvRows = fullList.map((c: any) => unit === "unidrop"
    ? [c.customer_id, c.nombre, c.email || "", c.dni || "", c.r_score, c.f_score, c.m_score, c.recency_days, c.frequency, c.monetary, c.ultima_compra || ""]
    : [c.customer_id, c.nombre, c.email || "", c.phone || "", c.r_score, c.f_score, c.m_score, c.recency_days, c.frequency, c.monetary, c.ultima_compra || ""]
  );
  const targetIds = fullList.map((c) => c.customer_id);
  const suggestedActionText = action ? `${action.que_es}\n\nAccion: ${action.que_hacer}` : "";
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border-2 rounded-2xl shadow-2xl w-[min(820px,95vw)] max-h-[90vh] overflow-hidden flex flex-col"
        style={{ borderColor: seg.color + "60" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start gap-3" style={{ background: `linear-gradient(90deg, ${seg.color}20, transparent)` }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl shadow-md flex-shrink-0" style={{ background: `linear-gradient(135deg, ${seg.color}, ${seg.color}dd)` }}>
            {seg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-extrabold text-text">{seg.label}</div>
            <div className="text-xs text-text-muted">{seg.desc}</div>
            <div className="mt-1.5 text-[11px] text-text-muted">
              <strong className="text-text">{seg.customers}</strong> {unit === "unidrop" ? "dropshippers" : "clientes"} · <strong className="text-text">{formatCurrency(seg.monetary_total)}</strong> volumen · ticket prom <strong className="text-text">{formatCurrency(seg.ticket_avg)}</strong>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text px-2 py-1 rounded">✕</button>
        </div>

        {/* Action explanation */}
        {action && (
          <div className="px-5 py-4 border-y border-border bg-soft/30 space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">Que significa este segmento</div>
              <div className="text-sm text-text mt-1">{action.que_es}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: seg.color }}>Que hacer (accion recomendada)</div>
              <div className="text-sm text-text mt-1">{action.que_hacer}</div>
            </div>
          </div>
        )}

        {/* Top customers */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="text-xs font-bold text-text">Top 10 por volumen</div>
          {fullData && (
            <div className="text-[10px] text-text-muted">
              {fullData.total} total en segmento {loadingFull && "· cargando..."}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {customers.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">Sin {unit === "unidrop" ? "dropshippers" : "clientes"} en este segmento</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">{labelEntidad}</th>
                  <th className="text-right px-2 py-2">R</th>
                  <th className="text-right px-2 py-2">F</th>
                  <th className="text-right px-2 py-2">M</th>
                  <th className="text-right px-2 py-2">Dias</th>
                  <th className="text-right px-2 py-2">{unit === "unidrop" ? "Ventas" : "Ordenes"}</th>
                  <th className="text-right px-2 py-2">Volumen</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customer_id} className="border-t border-border hover:bg-soft/40">
                    <td className="px-4 py-2">
                      <Link href={unit === "unidrop" ? `/dashboard/dropshipper/${c.customer_id}` : `/dashboard/customer/${c.customer_id}`} className="text-primary hover:underline font-medium">
                        {c.nombre}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-emerald-600">{c.r_score}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-blue-600">{c.f_score}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-amber-600">{c.m_score}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.recency_days}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.frequency}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(c.monetary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer accionable: Exportar CSV + Generar accion CS */}
        <ActionableFooter
          sourceType="rfm_segment"
          sourceKey={seg.key}
          unit={unit}
          title={`RFM ${unit} · ${seg.label}`}
          suggestedAction={suggestedActionText}
          targetIds={targetIds}
          csvFilename={`rfm_${unit}_${seg.key}_${new Date().toISOString().slice(0,10)}`}
          csvHeaders={csvHeaders}
          csvRows={csvRows}
          accentColor={seg.color}
        />
      </div>
    </div>
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
