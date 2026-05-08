"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { MultiLineChart } from "@/components/multi-line-chart";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Mail, Search, AlertTriangle, ExternalLink } from "lucide-react";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type Plan = "all" | "1" | "2" | "3" | "4";
type View = "dashboard" | "crm";
type Riesgo = "all" | "alto" | "medio" | "bajo" | "vencido";

const PLAN_LABEL: Record<string, string> = {
  "1": "Emprendedor",
  "2": "Crecimiento",
  "3": "Escala",
  "4": "XXL",
};

const PLAN_NAME_TO_ID = (name: string): string => {
  const lc = name.toLowerCase();
  if (lc.includes("emprendedor")) return "1";
  if (lc.includes("crecimiento")) return "2";
  if (lc.includes("escala")) return "3";
  if (lc.includes("xxl")) return "4";
  return "all";
};

type Resp = {
  period: string;
  plan: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  by_plan: CategoryValue[];
  status_dist: CategoryValue[];
  origin_dist: CategoryValue[];
  top_subscribers: CategoryValue[];
  generated_at: string;
};

type Subscriber = {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
  dni: string;
  plan: string;
  plan_precio: number;
  vence: string | null;
  dias_al_vencimiento: number | null;
  riesgo: string;
  lifecycle_stage: string;
  intents_ok: number;
  intents_pendientes: number;
  intents_cancelados: number;
  revenue_total: number;
  ultima_orden: string | null;
  orders_paid: number;
};

type CrmResp = {
  items: Subscriber[];
  total: number;
  stats: { activos: number; vencidos: number; riesgo_alto: number; riesgo_medio: number; al_dia: number };
};

const RIESGO_BADGE: Record<string, string> = {
  riesgo_alto: "bg-red-100 text-red-700 border-red-200",
  riesgo_medio: "bg-amber-100 text-amber-800 border-amber-200",
  al_dia: "bg-emerald-100 text-emerald-700 border-emerald-200",
  vencido: "bg-zinc-200 text-zinc-700 border-zinc-300",
  sin_suscripcion: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

const STAGE_BADGE: Record<string, string> = {
  vendiendo: "bg-emerald-50 text-emerald-700",
  publicando_ml: "bg-violet-50 text-violet-700",
  conecta_ml: "bg-amber-50 text-amber-700",
  conecta_tn: "bg-blue-50 text-blue-700",
  signup: "bg-zinc-50 text-zinc-600",
};

function waLink(phone: string): string | null {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("549")) return `https://wa.me/${d}`;
  if (d.startsWith("54")) return `https://wa.me/549${d.slice(2)}`;
  if (d.startsWith("0")) return `https://wa.me/549${d.slice(1)}`;
  if (d.length === 10) return `https://wa.me/549${d}`;
  return `https://wa.me/${d}`;
}

export default function SubscriptionsMeliPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [plan, setPlan] = useState<Plan>("all");
  const [view, setView] = useState<View>("dashboard");
  const [drill, setDrill] = useState<{ endpoint: string; title: string; filename: string } | null>(null);

  const { data, isLoading, isFetching, error } = useQuery<Resp>({
    queryKey: ["dashboards", "subs-meli", period, customFrom, customTo, plan],
    queryFn: () => api(`/api/dashboards/subscriptions-meli?${_qs}&plan=${plan}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Suscripciones MELI · Unidrop"
        subtitle="Cobros + CRM de suscriptores · 4 planes (Combo lanzamiento + XXL)"
      />
      
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <>
              <Segmented<View>
                value={view}
                onChange={setView}
                options={[
                  { value: "dashboard", label: "Dashboard" },
                  { value: "crm", label: "CRM Suscriptores" },
                ]}
              />
        <TodayPanel compact={period !== "today"} />
              <Segmented<Plan>
                value={plan}
                onChange={setPlan}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "1", label: "Emprendedor" },
                  { value: "2", label: "Crecimiento" },
                  { value: "3", label: "Escala" },
                  { value: "4", label: "XXL" },
                ]}
              />
            </>
          }
        />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        {view === "dashboard" ? (
          <DashboardView data={data} isLoading={isLoading} setDrill={setDrill} plan={plan} />
        ) : (
          <CrmView setDrill={setDrill} />
        )}
      </div>

      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle="Click ESC o fuera del modal para cerrar"
          endpoint={drill.endpoint}
          filename={drill.filename}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

// ============================================================
// Dashboard view (existente, ahora con drills en celdas + donuts)
// ============================================================
function DashboardView({
  data,
  isLoading,
  setDrill,
  plan,
}: {
  data?: Resp;
  isLoading: boolean;
  setDrill: (d: { endpoint: string; title: string; filename: string } | null) => void;
  plan: string;
}) {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);

  const openIntentDrill = (planId: string, status: string, label: string) => {
    setDrill({
      endpoint: `/api/drilldowns/subs-meli/intents?plan=${planId}&status=${status}`,
      title: label,
      filename: `intents_${planId}_${status}.csv`,
    });
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {isLoading || !data ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
          ))
        ) : (
          data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, plan, customFrom, customTo })} />)
        )}
      </div>

      <div className="mb-6">
        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
        ) : (
          <MultiLineChart
            series={data.trends}
            caption="Volumen mensual (12 meses)"
            subtitle="Cobrado · Intents creados · Cancelados"
            formatter="number"
          />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        {isLoading || !data ? (
          <>
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
          </>
        ) : (
          <>
            {/* Performance por plan con celdas clickeables */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-sm font-bold text-text">Performance por plan</div>
              <div className="text-xs text-text-muted mt-0.5 mb-3">Click en cualquier valor numerico para ver el detalle</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      <th className="py-2">Plan</th>
                      <th className="py-2 text-right pr-3">Precio</th>
                      <th className="py-2 text-right pr-3">Pub.</th>
                      <th className="py-2 text-right pr-3">OK</th>
                      <th className="py-2 text-right pr-3">Pend</th>
                      <th className="py-2 text-right pr-3">Canc</th>
                      <th className="py-2 text-right pr-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_plan.map((row, i) => {
                      const planId = PLAN_NAME_TO_ID(row.category);
                      const e = row.extra ?? {};
                      const cell = (val: number, st: string, label: string) => (
                        <button
                          onClick={() => openIntentDrill(planId, st, `${label} · ${row.category}`)}
                          className="font-semibold text-primary hover:underline tabular-nums disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
                          disabled={!val || planId === "all"}
                        >
                          {formatNumber(val ?? 0)}
                        </button>
                      );
                      return (
                        <tr key={i} className="border-t border-border hover:bg-soft transition">
                          <td className="py-2 pr-3 font-medium text-text">{row.category}</td>
                          <td className="py-2 pr-3 text-right text-text-muted text-xs">
                            {formatCurrency(Number(e.precio ?? 0))}
                          </td>
                          <td className="py-2 pr-3 text-right">{cell(Number(e.publicaciones ?? 0), "all", "Publicaciones")}</td>
                          <td className="py-2 pr-3 text-right">{cell(Number(e.processed ?? 0), "PROCESSED", "Cobrados")}</td>
                          <td className="py-2 pr-3 text-right">{cell(Number(e.pending ?? 0), "PENDING", "Pendientes")}</td>
                          <td className="py-2 pr-3 text-right">{cell(Number(e.cancelled ?? 0), "CANCELLED", "Cancelados")}</td>
                          <td className="py-2 pr-2 text-right font-bold tabular-nums">{formatCurrency(row.value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <DonutChart
              caption="Distribucion estados"
              data={data.status_dist.map((p) => ({ name: p.category, value: p.value }))}
              onSliceClick={(d) => {
                const status = d.name.toUpperCase();
                openIntentDrill(plan, status, `Intents en estado ${status}`);
              }}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {isLoading || !data ? (
          <>
            <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
            <div className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse xl:col-span-2" />
          </>
        ) : (
          <>
            <DonutChart
              caption="Origen del intent"
              data={data.origin_dist.map((p) => ({ name: p.category, value: p.value }))}
            />
            <div className="xl:col-span-2">
              <CategoryTable
                caption="Top suscriptores por revenue"
                subtitle="Click para ver el customer 360"
                data={data.top_subscribers}
                formatter="currency"
                extraColumns={[{ key: "subs", label: "Subs OK", format: "number" }]}
                onRowClick={(r) => {
                  const id = r.extra?.user_id;
                  if (typeof id === "number" && id > 0) {
                    window.open(`/dashboard/customer/${id}`, "_blank");
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ============================================================
// CRM view - tabla maestra de suscriptores con filtros
// ============================================================
function CrmView({
  setDrill,
}: {
  setDrill: (d: { endpoint: string; title: string; filename: string } | null) => void;
}) {
  const [riesgo, setRiesgo] = useState<Riesgo>("all");
  const [planFilter, setPlanFilter] = useState<Plan>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<CrmResp>({
    queryKey: ["crm-subs", riesgo, planFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("riesgo", riesgo);
      qs.set("plan", planFilter);
      if (search) qs.set("search", search);
      return api(`/api/drilldowns/crm/subscribers?${qs.toString()}`);
    },
    staleTime: 60_000,
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <CrmStatChip label="Activos"    value={data?.stats.activos ?? 0}    onClick={() => setRiesgo("all")} active={riesgo === "all"} color="bg-soft" />
        <CrmStatChip label="Al dia"     value={data?.stats.al_dia ?? 0}     onClick={() => setRiesgo("bajo")} active={riesgo === "bajo"} color="bg-emerald-50 border-emerald-200" />
        <CrmStatChip label="Riesgo medio" value={data?.stats.riesgo_medio ?? 0} onClick={() => setRiesgo("medio")} active={riesgo === "medio"} color="bg-amber-50 border-amber-200" />
        <CrmStatChip label="Riesgo alto" value={data?.stats.riesgo_alto ?? 0} onClick={() => setRiesgo("alto")} active={riesgo === "alto"} color="bg-red-50 border-red-200" />
        <CrmStatChip label="Vencidos"   value={data?.stats.vencidos ?? 0}   onClick={() => setRiesgo("vencido")} active={riesgo === "vencido"} color="bg-zinc-100 border-zinc-200" />
      </div>

      <div className="bg-surface border border-border rounded-xl">
        <div className="p-4 flex items-center gap-3 flex-wrap border-b border-border">
          <div className="relative flex-1 min-w-[280px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nombre, email, dni..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <Segmented<Plan>
            value={planFilter}
            onChange={setPlanFilter}
            options={[
              { value: "all", label: "Todos" },
              { value: "1", label: "Emprendedor" },
              { value: "2", label: "Crecimiento" },
              { value: "3", label: "Escala" },
              { value: "4", label: "XXL" },
            ]}
          />
          {data && (
            <div className="text-xs text-text-muted ml-auto">
              {formatNumber(data.total)} suscriptores · click telefono para WhatsApp
            </div>
          )}
        </div>

        <div className="overflow-x-auto max-h-[calc(100vh-360px)] overflow-y-auto">
          {isLoading ? (
            <div className="p-12 text-center text-text-muted text-sm">Cargando...</div>
          ) : !data?.items.length ? (
            <div className="p-12 text-center text-text-muted text-sm">Sin coincidencias.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2">Riesgo</th>
                  <th className="text-left px-3 py-2">Subscriptor</th>
                  <th className="text-left px-3 py-2">Plan</th>
                  <th className="text-left px-3 py-2">Lifecycle</th>
                  <th className="text-right px-3 py-2">Vence en</th>
                  <th className="text-right px-3 py-2">Revenue</th>
                  <th className="text-right px-3 py-2">Intents</th>
                  <th className="text-right px-3 py-2">Ord paid</th>
                  <th className="text-center px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="border-t border-border hover:bg-soft transition">
                    <td className="px-3 py-2">
                      <span className={"inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border " + (RIESGO_BADGE[s.riesgo] ?? "bg-zinc-100")}>
                        {s.riesgo === "riesgo_alto" && <AlertTriangle size={9} />}
                        {s.riesgo.replace("riesgo_", "").replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-text">{s.nombre}</div>
                      <div className="text-[11px] text-text-muted">{s.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-text">{s.plan}</div>
                      <div className="text-[10px] text-text-muted">{formatCurrency(s.plan_precio)}/mes</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={"inline-block text-[10px] font-semibold px-2 py-0.5 rounded " + (STAGE_BADGE[s.lifecycle_stage] ?? "bg-zinc-50 text-zinc-600")}>
                        {s.lifecycle_stage.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.dias_al_vencimiento === null ? (
                        <span className="text-text-muted text-xs">—</span>
                      ) : s.dias_al_vencimiento < 0 ? (
                        <span className="text-error text-xs font-bold">{Math.abs(s.dias_al_vencimiento)}d vencido</span>
                      ) : (
                        <span className={s.dias_al_vencimiento < 7 ? "text-error font-bold" : s.dias_al_vencimiento < 15 ? "text-amber-700 font-semibold" : "text-text"}>
                          {s.dias_al_vencimiento}d
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatCurrency(s.revenue_total)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      <span className="text-emerald-700">{s.intents_ok}</span>
                      {" / "}
                      <span className="text-amber-700">{s.intents_pendientes}</span>
                      {" / "}
                      <span className="text-error">{s.intents_cancelados}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(s.orders_paid)}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        {s.telefono && waLink(s.telefono) && (
                          <a
                            href={waLink(s.telefono)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition"
                            title={`WhatsApp ${s.telefono}`}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.32A8 8 0 0 0 4.16 17.32L3 22l4.86-1.27a8 8 0 0 0 11.86-7A7.9 7.9 0 0 0 17.6 6.32zM12 20.13a6.6 6.6 0 0 1-3.36-.92l-.24-.14L5.5 19.7l.78-2.85-.16-.25A6.6 6.6 0 1 1 18.6 12a6.6 6.6 0 0 1-6.6 8.13zm3.62-4.95c-.2-.1-1.18-.58-1.36-.65s-.32-.1-.45.1-.51.65-.63.78-.23.15-.43.05a5.4 5.4 0 0 1-1.6-1 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4.09-.1.2-.23.3-.35a1.4 1.4 0 0 0 .2-.33.36.36 0 0 0 0-.35c-.05-.1-.45-1.08-.62-1.48s-.33-.34-.45-.34h-.38a.74.74 0 0 0-.54.25 2.25 2.25 0 0 0-.7 1.66 3.9 3.9 0 0 0 .82 2.07 9 9 0 0 0 3.45 3.04c.48.21.86.34 1.15.43a2.78 2.78 0 0 0 1.27.08 2.07 2.07 0 0 0 1.36-.96 1.69 1.69 0 0 0 .12-.96c-.05-.1-.18-.15-.38-.25z"/></svg>
                          </a>
                        )}
                        {s.email && (
                          <a
                            href={`mailto:${s.email}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-soft text-text-muted hover:text-primary hover:bg-primary/10 transition"
                            title={`Email ${s.email}`}
                          >
                            <Mail size={12} />
                          </a>
                        )}
                        <a
                          href={`/dashboard/customer/${s.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-soft text-text-muted hover:text-primary hover:bg-primary/10 transition"
                          title="Abrir 360"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function CrmStatChip({
  label,
  value,
  onClick,
  active,
  color,
}: {
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border p-3 text-left transition " +
        color +
        " " +
        (active ? "ring-2 ring-primary border-primary" : "hover:border-primary/40")
      }
    >
      <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">{label}</div>
      <div className="text-2xl font-extrabold text-text tabular-nums mt-0.5">{formatNumber(value)}</div>
    </button>
  );
}
