"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Truck, Package, MapPin, Bike, Mail, ShoppingBag } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Canal = {
  canal: string;
  ordenes: number;
  gmv: number;
  pagadas: number;
  entregadas: number;
  pct_ordenes: number;
  fulfillment_rate: number;
};

type Resp = {
  period: string;
  days: number;
  totals: {
    ordenes: number;
    gmv: number;
    canales: number;
  };
  canales: Canal[];
  generated_at: string;
};

const CHANNEL_META: Record<string, { icon: any; color: string; bg: string; border: string }> = {
  "OCA": { icon: Mail, color: "text-blue-700", bg: "from-blue-50 to-blue-100", border: "border-blue-300" },
  "Correo Argentino": { icon: Mail, color: "text-sky-700", bg: "from-sky-50 to-sky-100", border: "border-sky-300" },
  "Unifast": { icon: Truck, color: "text-orange-700", bg: "from-orange-50 to-orange-100", border: "border-orange-300" },
  "Retiro presencial": { icon: MapPin, color: "text-emerald-700", bg: "from-emerald-50 to-emerald-100", border: "border-emerald-300" },
  "Moto / Cadeteria": { icon: Bike, color: "text-violet-700", bg: "from-violet-50 to-violet-100", border: "border-violet-300" },
  "Andreani": { icon: Mail, color: "text-indigo-700", bg: "from-indigo-50 to-indigo-100", border: "border-indigo-300" },
  "Personalizado": { icon: Package, color: "text-amber-700", bg: "from-amber-50 to-amber-100", border: "border-amber-300" },
  "(sin metodo)": { icon: Package, color: "text-zinc-500", bg: "from-zinc-50 to-zinc-100", border: "border-zinc-300" },
  "Otro": { icon: Truck, color: "text-zinc-700", bg: "from-zinc-50 to-zinc-100", border: "border-zinc-300" },
};

export default function EnviosUnistorePage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [drillCanal, setDrillCanal] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<Resp>({
    queryKey: ["envios-unistore", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/envios-unistore?${_qs}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Envíos Unistore por canal"
        subtitle="Distribución de órdenes por carrier · OCA / Correo Argentino / Unifast / Retiro / Moto / Andreani / Personalizado"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <DashboardHeader generatedAt={data?.generated_at} isFetching={isFetching} filters={null} />

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <KpiBox icon={ShoppingBag} label="Órdenes totales" value={formatNumber(data?.totals.ordenes ?? 0)} accent="primary" />
          <KpiBox icon={Truck} label="GMV total" value={formatCurrency(data?.totals.gmv ?? 0)} accent="emerald" />
          <KpiBox icon={Mail} label="Canales activos" value={formatNumber(data?.totals.canales ?? 0)} accent="amber" />
        </div>

        {/* Cards de canal */}
        {isLoading || !data ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : data.canales.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 text-center text-text-muted">
            Sin órdenes en el período seleccionado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {data.canales.map((c) => {
              const meta = CHANNEL_META[c.canal] ?? CHANNEL_META["Otro"];
              const Icon = meta.icon;
              return (
                <button
                  key={c.canal}
                  onClick={() => setDrillCanal(c.canal)}
                  className={`bg-gradient-to-br ${meta.bg} border-2 ${meta.border} rounded-xl p-5 hover:shadow-lg transition text-left group`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl bg-white border ${meta.border} flex items-center justify-center shadow-sm ${meta.color}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-base font-bold ${meta.color}`}>{c.canal}</div>
                      <div className="text-[10px] text-text-muted">{c.pct_ordenes.toFixed(1)}% del total</div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(c.ordenes)}</div>
                    <div className="text-[11px] text-text-muted">órdenes en el período</div>
                  </div>

                  <div className="space-y-1.5 text-xs pt-3 border-t border-white/60">
                    <div className="flex justify-between">
                      <span className="text-text-muted">GMV</span>
                      <span className="font-bold tabular-nums">{formatCurrency(c.gmv)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Pagadas</span>
                      <span className="font-semibold tabular-nums">{formatNumber(c.pagadas)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Entregadas</span>
                      <span className="font-semibold tabular-nums">{formatNumber(c.entregadas)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Fulfillment rate</span>
                      <span className={`font-bold tabular-nums ${c.fulfillment_rate > 80 ? "text-emerald-700" : c.fulfillment_rate > 50 ? "text-amber-700" : "text-rose-700"}`}>
                        {c.fulfillment_rate.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className={`mt-3 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition ${meta.color} text-right`}>
                    Ver órdenes →
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Tabla resumen */}
        {data && data.canales.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text">Comparativo por canal</h3>
              <p className="text-[11px] text-text-muted">Ordenado por cantidad de órdenes · click una fila para drill</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2.5">Canal</th>
                    <th className="text-right px-3 py-2.5">Órdenes</th>
                    <th className="text-right px-3 py-2.5">% Total</th>
                    <th className="text-right px-3 py-2.5">GMV</th>
                    <th className="text-right px-3 py-2.5">Pagadas</th>
                    <th className="text-right px-3 py-2.5">Entregadas</th>
                    <th className="text-right px-3 py-2.5">Fulfillment</th>
                  </tr>
                </thead>
                <tbody>
                  {data.canales.map((c) => {
                    const meta = CHANNEL_META[c.canal] ?? CHANNEL_META["Otro"];
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={c.canal}
                        onClick={() => setDrillCanal(c.canal)}
                        className="border-t border-border hover:bg-soft transition cursor-pointer"
                      >
                        <td className="px-3 py-2.5">
                          <div className="inline-flex items-center gap-2">
                            <Icon size={14} className={meta.color} />
                            <span className="font-medium">{c.canal}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold">{formatNumber(c.ordenes)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{c.pct_ordenes.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(c.gmv)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(c.pagadas)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(c.entregadas)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${c.fulfillment_rate > 80 ? "text-emerald-700" : c.fulfillment_rate > 50 ? "text-amber-700" : "text-rose-700"}`}>
                          {c.fulfillment_rate.toFixed(1)}%
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

      {/* Drilldown del canal seleccionado */}
      {drillCanal && (
        <DrillDownModal
          title={`Órdenes Unistore · canal ${drillCanal}`}
          subtitle={`Período actual · click una fila para ver detalle de la orden`}
          endpoint={`/api/drilldowns/orders/all?${_qs}`}
          filename={`envios_${drillCanal.toLowerCase().replace(/\W+/g, "_")}.csv`}
          onClose={() => setDrillCanal(null)}
        />
      )}
    </>
  );
}

function KpiBox({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: "primary" | "emerald" | "amber" }) {
  const accentClasses = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
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
