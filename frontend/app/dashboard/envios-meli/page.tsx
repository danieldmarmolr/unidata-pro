"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck, Package, ShoppingBag, AlertCircle, Sparkles } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Modo = {
  modo: string;
  ordenes: number;
  gmv: number;
  pagadas: number;
  entregadas: number;
  enviadas: number;
  canceladas: number;
  pct_ordenes: number;
  fulfillment_rate: number;
};

type Resp = {
  available: boolean;
  message?: string;
  totals: { ordenes: number; gmv: number; modos: number };
  modos: Modo[];
  generated_at: string;
};

const MODO_META: Record<string, { color: string; bg: string; border: string }> = {
  "Mercado Envios FULL": { color: "text-yellow-700", bg: "from-yellow-50 to-amber-100", border: "border-amber-300" },
  "Mercado Envios ME2": { color: "text-yellow-700", bg: "from-yellow-50 to-yellow-100", border: "border-yellow-300" },
  "Mercado Envios ME1": { color: "text-yellow-700", bg: "from-yellow-50 to-yellow-100", border: "border-yellow-300" },
  "Cross Docking": { color: "text-violet-700", bg: "from-violet-50 to-violet-100", border: "border-violet-300" },
  "Drop Off (sucursal)": { color: "text-blue-700", bg: "from-blue-50 to-blue-100", border: "border-blue-300" },
  "Flex / Self Service": { color: "text-orange-700", bg: "from-orange-50 to-orange-100", border: "border-orange-300" },
  "Pickup": { color: "text-emerald-700", bg: "from-emerald-50 to-emerald-100", border: "border-emerald-300" },
  "Personalizado": { color: "text-cyan-700", bg: "from-cyan-50 to-cyan-100", border: "border-cyan-300" },
  "Sin especificar": { color: "text-zinc-500", bg: "from-zinc-50 to-zinc-100", border: "border-zinc-300" },
  "Otro": { color: "text-zinc-700", bg: "from-zinc-50 to-zinc-100", border: "border-zinc-300" },
};

export default function EnviosMeliPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);

  const { data, isLoading, isFetching } = useQuery<Resp>({
    queryKey: ["envios-meli-unidrop", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/envios-meli-unidrop?${_qs}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Envíos MELI Unidrop por modo"
        subtitle="Distribución de órdenes Mercado Libre · FULL / Cross Docking / Drop Off / Flex / Pickup"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <DashboardHeader generatedAt={data?.generated_at} isFetching={isFetching} filters={null} />

        {data && !data.available && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 mb-6 flex items-start gap-3">
            <AlertCircle size={22} className="text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-bold text-amber-900 mb-1">Datos de modo de envío no disponibles</div>
              <div className="text-amber-800 text-xs">{data.message}</div>
              <div className="mt-2 text-[11px] text-amber-700/80">
                Para habilitar este dashboard necesitas que el sync de MELI traiga el campo{" "}
                <code className="bg-white px-1 rounded">shipping_logistic_type</code> o{" "}
                <code className="bg-white px-1 rounded">shipping_mode</code> en la tabla{" "}
                <code className="bg-white px-1 rounded">meli.meli_orders</code>.
              </div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <KpiBox icon={ShoppingBag} label="Órdenes MELI" value={formatNumber(data?.totals.ordenes ?? 0)} accent="primary" />
          <KpiBox icon={Truck} label="GMV total MELI" value={formatCurrency(data?.totals.gmv ?? 0)} accent="emerald" />
          <KpiBox icon={Sparkles} label="Modos activos" value={formatNumber(data?.totals.modos ?? 0)} accent="amber" />
        </div>

        {/* Cards de modo */}
        {isLoading || !data ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : data.modos.length === 0 ? null : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {data.modos.map((m) => {
              const meta = MODO_META[m.modo] ?? MODO_META["Otro"];
              return (
                <div
                  key={m.modo}
                  className={`bg-gradient-to-br ${meta.bg} border-2 ${meta.border} rounded-xl p-5`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl bg-white border ${meta.border} flex items-center justify-center shadow-sm ${meta.color}`}>
                      <Package size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-base font-bold ${meta.color}`}>{m.modo}</div>
                      <div className="text-[10px] text-text-muted">{m.pct_ordenes.toFixed(1)}% del total</div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(m.ordenes)}</div>
                    <div className="text-[11px] text-text-muted">órdenes en el período</div>
                  </div>

                  <div className="space-y-1.5 text-xs pt-3 border-t border-white/60">
                    <div className="flex justify-between">
                      <span className="text-text-muted">GMV</span>
                      <span className="font-bold tabular-nums">{formatCurrency(m.gmv)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Pagadas</span>
                      <span className="font-semibold tabular-nums">{formatNumber(m.pagadas)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Enviadas</span>
                      <span className="font-semibold tabular-nums">{formatNumber(m.enviadas)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Entregadas</span>
                      <span className="font-semibold tabular-nums">{formatNumber(m.entregadas)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Fulfillment</span>
                      <span className={`font-bold tabular-nums ${m.fulfillment_rate > 80 ? "text-emerald-700" : m.fulfillment_rate > 50 ? "text-amber-700" : "text-rose-700"}`}>
                        {m.fulfillment_rate.toFixed(1)}%
                      </span>
                    </div>
                    {m.canceladas > 0 && (
                      <div className="flex justify-between">
                        <span className="text-text-muted">Canceladas</span>
                        <span className="font-semibold tabular-nums text-rose-700">{m.canceladas}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
