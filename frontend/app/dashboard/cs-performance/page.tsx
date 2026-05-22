"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Send, Reply, Trophy, DollarSign, Target, Filter,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Bucket = {
  value: string;
  actions: number;
  total: number;
  contacted: number;
  responded: number;
  converted: number;
  revenue: number;
  contact_rate: number;
  response_rate: number;
  conversion_rate: number;
};

type PerformanceResp = {
  days: number;
  overall: Omit<Bucket, "value"> & { actions: number };
  by_source_type: Bucket[];
  by_unit: Bucket[];
  by_status: Bucket[];
};

export default function CsPerformancePage() {
  const [days, setDays] = useState<number>(60);
  const { data, isLoading } = useQuery<PerformanceResp>({
    queryKey: ["cs-performance", days],
    queryFn: () => api(`/api/cs-actions/performance/summary?days=${days}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="CS Performance"
        subtitle="Funnel + ROI por origen + breakdown · ventana configurable"
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border">
            {[7, 30, 60, 90, 180].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                  days === d ? "bg-surface shadow text-text" : "text-text-muted hover:text-text"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <div className="text-[11px] text-text-muted">
            <Filter size={11} className="inline mr-1" />
            Acciones creadas en los ultimos <strong className="text-text">{days}</strong> dias
          </div>
        </div>

        {isLoading || !data ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-surface border border-border rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Overall funnel */}
            <Funnel data={data.overall} title={`Ventana ${days}d · ${data.overall.actions} acciones creadas`} />

            {/* Breakdown grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
              <BreakdownCard
                caption="Por origen (source_type)"
                subtitle="Donde se generan las acciones que mejor convierten"
                items={data.by_source_type}
                dimLabel="Origen"
              />
              <BreakdownCard
                caption="Por unidad"
                subtitle="Conversion por Unistore vs Unidrop"
                items={data.by_unit}
                dimLabel="Unit"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 mt-4">
              <BreakdownCard
                caption="Por status"
                subtitle="Cuantas pasaron de pending a hechas/canceladas"
                items={data.by_status}
                dimLabel="Status"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Funnel({ data, title }: { data: PerformanceResp["overall"]; title: string }) {
  const stages = [
    { label: "Targets generados", value: data.total, icon: <Users size={14} />, color: "from-violet-500 to-violet-700" },
    { label: "Contactados", value: data.contacted, icon: <Send size={14} />, color: "from-blue-500 to-blue-700" },
    { label: "Respondieron", value: data.responded, icon: <Reply size={14} />, color: "from-amber-500 to-amber-600" },
    { label: "Convirtieron", value: data.converted, icon: <Trophy size={14} />, color: "from-emerald-500 to-emerald-700" },
  ];
  const max = data.total || 1;

  return (
    <div className="bg-surface border-2 border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-text">Funnel CS</div>
          <div className="text-xs text-text-muted">{title}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Revenue recuperado</div>
          <div className="text-xl font-extrabold text-emerald-700 tabular-nums">{formatCurrency(data.revenue)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {stages.map((s, i) => {
          const pct = (s.value / max) * 100;
          const fromPrev = i > 0 ? (stages[i - 1].value > 0 ? (s.value / stages[i - 1].value) * 100 : 0) : 100;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-md bg-gradient-to-br ${s.color}`}>
                {s.icon}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-baseline text-xs">
                  <div className="font-bold text-text">{s.label}</div>
                  <div className="flex items-baseline gap-2 tabular-nums">
                    <span className="text-base font-extrabold text-text">{formatNumber(s.value)}</span>
                    {i > 0 && (
                      <span className="text-[10px] text-text-muted">
                        {fromPrev.toFixed(1)}% del paso anterior · {pct.toFixed(1)}% del total
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1 h-2 bg-soft rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${s.color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
        <Stat label="Contact rate" value={`${data.contact_rate}%`} color="text-blue-700" />
        <Stat label="Response rate" value={`${data.response_rate}%`} color="text-amber-700" />
        <Stat label="Conversion rate" value={`${data.conversion_rate}%`} color="text-emerald-700" />
      </div>
    </div>
  );
}

function BreakdownCard({
  caption, subtitle, items, dimLabel,
}: {
  caption: string;
  subtitle: string;
  items: Bucket[];
  dimLabel: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-bold text-text">{caption}</div>
        <div className="text-[11px] text-text-muted">{subtitle}</div>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-text-muted text-sm">Sin datos en la ventana</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">{dimLabel}</th>
              <th className="text-right px-2 py-2">Acciones</th>
              <th className="text-right px-2 py-2">Targets</th>
              <th className="text-right px-2 py-2">Contactados</th>
              <th className="text-right px-2 py-2">Convirtieron</th>
              <th className="text-right px-2 py-2">Conv %</th>
              <th className="text-right px-3 py-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.value} className="border-t border-border">
                <td className="px-3 py-2 font-semibold text-text">{b.value}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(b.actions)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(b.total)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(b.contacted)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-700 font-bold">{formatNumber(b.converted)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{b.conversion_rate}%</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{formatCurrency(b.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
