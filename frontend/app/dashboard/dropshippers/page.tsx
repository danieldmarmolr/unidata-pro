"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { Segmented } from "@/components/segmented";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Mail, Search, ExternalLink, AlertTriangle, Sparkles, ArrowUp, ArrowDown, Info } from "lucide-react";

type Plan = "all" | "1" | "2" | "3" | "4";
type Riesgo = "all" | "sin_publicar" | "sin_vender" | "con_deuda" | "token_expira";
type Actividad = "all" | "activo" | "inactivo";
type Canal = "all" | "meli" | "tn" | "ambos" | "sin_canal";

type DS = {
  user_id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  dni: string | null;
  fantasy_name: string | null;
  personeria: string | null;
  activo: boolean;
  creado_en: string;
  plan: string | null;
  plan_precio: number | null;
  plan_pub_max: number | null;
  sub_vence: string | null;
  dias_al_vencimiento: number | null;
  cuenta_meli_id: number | null;
  nickname_meli: string | null;
  requiere_reauth: boolean | null;
  cant_referidos: number;
  pub_activas: number;
  pub_totales: number;
  ultima_publicacion: string | null;
  ventas_pagadas: number;
  ordenes_totales: number;
  ultima_venta: string | null;
  gmv: number;
  costo_mercaderia: number;
  profit_unidrop: number;
  canceladas: number;
  canceladas_staff: number;
  sku_faltante: number;
  pagos_procesados: number;
  pago_unidrop_total: number;
  ultimo_pago: string | null;
  deuda_pendiente: number;
  // Suscripciones cobradas en el periodo (segunda pata del revenue Unidrop)
  subs_cobradas?: number;
  subs_pagadas?: number;
  // Ganancia neta para Unidrop = profit por orden + suscripciones cobradas
  ganancia_unidrop_neta?: number;
  // Canal
  tiene_meli?: boolean;
  tiene_tn?: boolean;
  canal?: "meli" | "tn" | "ambos" | "sin_canal";
  tn_ordenes_totales?: number;
  tn_ventas_pagadas?: number;
  tn_gmv?: number;
  tn_ultima_venta?: string | null;
  tn_tiendas?: number;
  gmv_total?: number;
};

type PlanSlot = {
  plan_id: number | null;
  plan_precio: number;
  count: number;
  ganancia_unidrop: number;
  subs_cobradas: number;
  profit_unidrop: number;
  gmv_total: number;
};

type MetaSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  cac_dropshipper: number | null;
  roas_ganancia_unidrop: number | null;
  period: string;
};

type Resp = {
  items: DS[];
  total: number;
  stats: {
    total: number; gmv: number; profit_unidrop: number; pago_unidrop: number; deuda_pendiente: number;
    tn_gmv?: number; gmv_total?: number;
    sin_publicar: number; sin_vender: number; con_deuda: number; token_expira: number;
    activos_30d?: number; inactivos?: number;
    subs_cobradas?: number;
    ganancia_unidrop_total?: number;
    nuevos_periodo?: number;
    by_plan?: Record<string, PlanSlot>;
    meta?: MetaSummary | null;
    by_channel?: {
      meli: { count: number; gmv: number };
      tn: { count: number; gmv: number };
      ambos: { count: number; gmv: number };
      sin_canal: { count: number; gmv: number };
    };
  };
  filtered_stats?: {
    total: number; gmv: number; profit_unidrop: number; pago_unidrop: number; deuda_pendiente: number;
    subs_cobradas?: number;
    ganancia_unidrop_total?: number;
  };
  filters_applied?: { plan: string; riesgo: string; actividad: string; canal?: string; search: string };
  generated_at: string;
};

function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("549")) return `https://wa.me/${d}`;
  if (d.startsWith("54")) return `https://wa.me/549${d.slice(2)}`;
  if (d.startsWith("0")) return `https://wa.me/549${d.slice(1)}`;
  if (d.length === 10) return `https://wa.me/549${d}`;
  return `https://wa.me/${d}`;
}

export default function DropshippersPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const [plan, setPlan] = useState<Plan>("all");
  const [riesgo, setRiesgo] = useState<Riesgo>("all");
  const [actividad, setActividad] = useState<Actividad>("all");
  const [canal, setCanal] = useState<Canal>("all");
  const [search, setSearch] = useState("");
  const [showFormula, setShowFormula] = useState(false);
  // Sort + paginacion frontend: con ~8k dropshippers la tabla podia ser pesada,
  // por eso visible se limita a `pageLimit` y el user lo expande con el boton.
  type SortKey = "ganancia_unidrop_neta" | "gmv_total" | "profit_unidrop" | "subs_cobradas"
    | "deuda_pendiente" | "ventas_pagadas" | "creado_en" | "ultima_venta";
  const [sortKey, setSortKey] = useState<SortKey>("ganancia_unidrop_neta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageLimit, setPageLimit] = useState(200);
  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["dropshippers", plan, riesgo, actividad, canal, search, period, customFrom, customTo],
    queryFn: () => {
      const qs = new URLSearchParams(periodToQuery(period, customFrom, customTo));
      qs.set("plan", plan);
      qs.set("riesgo", riesgo);
      qs.set("actividad", actividad);
      qs.set("canal", canal);
      if (search) qs.set("search", search);
      return api(`/api/dashboards/dropshippers?${qs.toString()}`);
    },
    staleTime: 60_000,
  });

  // Sort + slice del lado frontend. El backend devuelve hasta 50k rows; aca
  // ordenamos por la columna que el usuario elige y mostramos solo los
  // primeros `pageLimit` (200 default). Asi la tabla siempre arranca con
  // los mas relevantes y el user puede expandir.
  const sortedItems = useMemo<DS[]>(() => {
    const rows = data?.items ?? [];
    if (rows.length === 0) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (r: DS) => {
      switch (sortKey) {
        case "ganancia_unidrop_neta": return r.ganancia_unidrop_neta ?? r.profit_unidrop ?? 0;
        case "gmv_total": return r.gmv_total ?? ((r.gmv ?? 0) + (r.tn_gmv ?? 0));
        case "profit_unidrop": return r.profit_unidrop ?? 0;
        case "subs_cobradas": return r.subs_cobradas ?? 0;
        case "deuda_pendiente": return r.deuda_pendiente ?? 0;
        case "ventas_pagadas": return (r.ventas_pagadas ?? 0) + (r.tn_ventas_pagadas ?? 0);
        case "creado_en": return r.creado_en ? Date.parse(r.creado_en) : 0;
        case "ultima_venta": {
          const v = r.ultima_venta ? Date.parse(r.ultima_venta) : 0;
          const t = r.tn_ultima_venta ? Date.parse(r.tn_ultima_venta) : 0;
          return Math.max(v, t);
        }
        default: return 0;
      }
    };
    return [...rows].sort((a, b) => {
      const va = get(a) as number;
      const vb = get(b) as number;
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [data?.items, sortKey, sortDir]);
  const visibleItems = sortedItems.slice(0, pageLimit);

  return (
    <>
      <Topbar
        title="Dropshippers Unidrop"
        subtitle="Operadores por canal · solo MELI (con suscripcion) · solo TN (sin sub) · ambos · alertas y deuda"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unidrop" context="dropshippers" title="HOY · Dropshippers" />
        {/* Ganancia Unidrop - el KPI hero del listado */}
        {data?.stats.ganancia_unidrop_total !== undefined && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="md:col-span-2 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-emerald-50 to-white p-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700/80 font-semibold">Ganancia Unidrop neta del periodo</div>
                <button
                  type="button"
                  onClick={() => setShowFormula((v) => !v)}
                  className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:text-emerald-900 font-semibold"
                  aria-label="Ver formula del calculo"
                >
                  <Info size={11} /> {showFormula ? "ocultar" : "como se calcula"}
                </button>
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-800">
                {formatCurrency(data.stats.ganancia_unidrop_total)}
              </div>
              <div className="mt-1 text-xs text-emerald-700/80 flex flex-wrap gap-x-4 gap-y-1">
                <span>Margen ML (profit_for_subscription) <span className="font-semibold tabular-nums">{formatCurrency(data.stats.profit_unidrop)}</span></span>
                <span>+ Suscripciones cobradas <span className="font-semibold tabular-nums">{formatCurrency(data.stats.subs_cobradas ?? 0)}</span></span>
              </div>
              {showFormula && (
                <div className="mt-3 pt-3 border-t border-emerald-200 text-[11px] leading-relaxed text-emerald-900/85 space-y-2">
                  <div className="font-semibold text-emerald-900">Como se calcula la ganancia Unidrop neta del periodo</div>
                  <div>
                    <span className="font-bold">Ganancia Unidrop</span> = <span className="font-mono bg-white/60 px-1 rounded">Margen ML</span> + <span className="font-mono bg-white/60 px-1 rounded">Suscripciones cobradas</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <span className="font-semibold">Margen ML</span> = suma de
                      <span className="font-mono bg-white/60 px-1 rounded mx-0.5">OrderMercadoLibre.profit_for_subscription</span>
                      para todas las ordenes con <span className="font-mono">status='paid'</span> dentro del periodo.
                      Este campo ya es <em>neto</em>: precio mayorista que pago el dropshipper - costo importacion - comisiones absorbidas por Unidrop.
                    </li>
                    <li>
                      <span className="font-semibold">Suscripciones cobradas</span> = suma de
                      <span className="font-mono bg-white/60 px-1 rounded mx-0.5">PaymentIntentSubscription.paidAmount</span>
                      con <span className="font-mono">status='PROCESSED'</span> y
                      <span className="font-mono">createdAt</span> en el periodo. Es la plata efectiva que el dropshipper transfirio a Unidrop por su Combo mensual (MELI).
                    </li>
                  </ul>
                  <div className="text-emerald-700/70 italic">
                    No incluye: costos operativos (sueldos, Meta Ads, infra), comisiones de pasarela ni ganancia que percibe el dropshipper al revender (eso es <span className="font-mono">GMV - merchandise_cost - shipping - sus gastos</span>).
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Nuevos en el periodo</div>
                <div className="mt-1 text-3xl font-bold tabular-nums text-primary">
                  +{formatNumber(data.stats.nuevos_periodo ?? 0)}
                </div>
              </div>
              {data.stats.meta && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-blue-50 border border-blue-200 px-2 py-1">
                    <div className="text-[9px] text-blue-700/80 uppercase">Spend Meta</div>
                    <div className="font-semibold tabular-nums text-blue-800">{formatCurrency(data.stats.meta.spend)}</div>
                  </div>
                  <div className="rounded-lg bg-violet-50 border border-violet-200 px-2 py-1">
                    <div className="text-[9px] text-violet-700/80 uppercase">CAC dropshipper</div>
                    <div className="font-semibold tabular-nums text-violet-800">
                      {data.stats.meta.cac_dropshipper !== null ? formatCurrency(data.stats.meta.cac_dropshipper) : "—"}
                    </div>
                  </div>
                  <div className="col-span-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 flex justify-between items-baseline">
                    <span className="text-[9px] text-amber-700/80 uppercase">ROAS (ganancia / spend)</span>
                    <span className="font-bold tabular-nums text-amber-800">
                      {data.stats.meta.roas_ganancia_unidrop !== null ? `${data.stats.meta.roas_ganancia_unidrop.toFixed(2)}x` : "—"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
          <Stat label="Dropshippers" value={formatNumber(data?.stats.total ?? 0)} hint="todos los que operan en MELI o TN" />
          <Stat
            label="GMV total"
            value={formatCurrency(data?.stats.gmv_total ?? data?.stats.gmv ?? 0)}
            hint={data?.stats.tn_gmv !== undefined ? `MELI ${formatCurrency(data.stats.gmv)} + TN ${formatCurrency(data.stats.tn_gmv)}` : "ventas pagas MELI"}
            color="text-emerald-700"
          />
          <Stat label="Profit Unidrop" value={formatCurrency(data?.stats.profit_unidrop ?? 0)} hint="margen por orden ML (profit_for_subscription)" color="text-primary" />
          <Stat label="Subs cobradas" value={formatCurrency(data?.stats.subs_cobradas ?? 0)} hint="PaymentIntentSubscription PROCESSED" color="text-violet-700" />
          <Stat label="Deuda pendiente" value={formatCurrency(data?.stats.deuda_pendiente ?? 0)} hint="intents != PROCESSED" color="text-error" />
        </div>

        {/* Breakdown por plan: cuanto pesa cada plan en cantidad + ganancia Unidrop */}
        {data?.stats.by_plan && Object.keys(data.stats.by_plan).length > 0 && (
          <div className="mb-4 rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-soft text-[11px] uppercase tracking-wider text-text-muted font-semibold">
              Suscripciones por plan · cantidad y ganancia Unidrop
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-text-muted bg-soft/40">
                  <tr>
                    <th className="text-left px-3 py-1.5">Plan</th>
                    <th className="text-right px-3 py-1.5">Precio/mes</th>
                    <th className="text-right px-3 py-1.5">Dropshippers</th>
                    <th className="text-right px-3 py-1.5">GMV combinado</th>
                    <th className="text-right px-3 py-1.5">Margen ML</th>
                    <th className="text-right px-3 py-1.5">Subs cobradas</th>
                    <th className="text-right px-3 py-1.5 bg-emerald-50/60">Ganancia Unidrop</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.stats.by_plan)
                    .sort((a, b) => (b[1].ganancia_unidrop || 0) - (a[1].ganancia_unidrop || 0))
                    .map(([planName, slot]) => (
                      <tr key={planName} className="border-t border-border hover:bg-soft transition">
                        <td className="px-3 py-1.5">
                          <span className="font-semibold">{planName}</span>
                          {slot.plan_id !== null && (
                            <span className="text-text-muted text-[10px] ml-1">#{slot.plan_id}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {slot.plan_precio > 0 ? formatCurrency(slot.plan_precio) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatNumber(slot.count)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(slot.gmv_total)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(slot.profit_unidrop)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(slot.subs_cobradas)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-bold text-emerald-700 bg-emerald-50/40">
                          {formatCurrency(slot.ganancia_unidrop)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Canales: clickeable para filtrar */}
        {data?.stats.by_channel && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <ChannelCard
              label="Solo MELI"
              count={data.stats.by_channel.meli.count}
              gmv={data.stats.by_channel.meli.gmv}
              hint="con suscripcion"
              active={canal === "meli"}
              color="from-yellow-100 to-yellow-50 border-yellow-300"
              activeColor="from-yellow-200 to-yellow-100 border-yellow-500"
              onClick={() => setCanal(canal === "meli" ? "all" : "meli")}
            />
            <ChannelCard
              label="Solo TN"
              count={data.stats.by_channel.tn.count}
              gmv={data.stats.by_channel.tn.gmv}
              hint="sin suscripcion"
              active={canal === "tn"}
              color="from-cyan-100 to-cyan-50 border-cyan-300"
              activeColor="from-cyan-200 to-cyan-100 border-cyan-500"
              onClick={() => setCanal(canal === "tn" ? "all" : "tn")}
            />
            <ChannelCard
              label="Ambos canales"
              count={data.stats.by_channel.ambos.count}
              gmv={data.stats.by_channel.ambos.gmv}
              hint="MELI + TN - top tier"
              active={canal === "ambos"}
              color="from-violet-100 to-violet-50 border-violet-300"
              activeColor="from-violet-200 to-violet-100 border-violet-500"
              onClick={() => setCanal(canal === "ambos" ? "all" : "ambos")}
            />
            <ChannelCard
              label="Sin operar"
              count={data.stats.by_channel.sin_canal.count}
              gmv={null}
              hint="alta sin canal"
              active={canal === "sin_canal"}
              color="from-zinc-100 to-zinc-50 border-zinc-300"
              activeColor="from-zinc-200 to-zinc-100 border-zinc-500"
              onClick={() => setCanal(canal === "sin_canal" ? "all" : "sin_canal")}
            />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <RiskChip label="Sin publicar" value={data?.stats.sin_publicar ?? 0}
                    hint="MELI - 0 publicaciones activas"
                    active={riesgo === "sin_publicar"}
                    onClick={() => setRiesgo(riesgo === "sin_publicar" ? "all" : "sin_publicar")}
                    color="bg-amber-50 border-amber-200" />
          <RiskChip label="Sin vender" value={data?.stats.sin_vender ?? 0}
                    hint="No vendio en MELI ni en TN"
                    active={riesgo === "sin_vender"}
                    onClick={() => setRiesgo(riesgo === "sin_vender" ? "all" : "sin_vender")}
                    color="bg-orange-50 border-orange-200" />
          <RiskChip label="Con deuda" value={data?.stats.con_deuda ?? 0}
                    hint="PaymentIntent != PROCESSED"
                    active={riesgo === "con_deuda"}
                    onClick={() => setRiesgo(riesgo === "con_deuda" ? "all" : "con_deuda")}
                    color="bg-red-50 border-red-200" />
          <RiskChip label="Token MELI vencido" value={data?.stats.token_expira ?? 0}
                    hint="requiresReauth = true"
                    active={riesgo === "token_expira"}
                    onClick={() => setRiesgo(riesgo === "token_expira" ? "all" : "token_expira")}
                    color="bg-violet-50 border-violet-200" />
        </div>

        {/* Toolbar */}
        <div className="bg-surface border border-border rounded-xl">
          <div className="p-4 flex items-center gap-3 flex-wrap border-b border-border">
            <div className="relative flex-1 min-w-[280px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Buscar por nombre, email, dni, nickname MELI..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
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
            <Segmented<Actividad>
              value={actividad}
              onChange={setActividad}
              options={[
                { value: "all", label: "Todos" },
                { value: "activo", label: "Activo (30d)" },
                { value: "inactivo", label: "Inactivo" },
              ]}
            />
            {data && (
              <div className="flex items-center gap-3 ml-auto">
                <div className="text-xs text-text-muted">
                  {data.stats.total === data.total
                    ? <span><span className="font-bold text-text">{formatNumber(data.total)}</span> dropshippers</span>
                    : (
                      <span>
                        Viendo <span className="font-bold text-text">{formatNumber(Math.min(visibleItems.length, data.total))}</span>
                        {data.total !== visibleItems.length && (
                          <span className="text-text-muted/70"> / {formatNumber(data.total)}</span>
                        )}
                        <span className="text-text-muted/60"> de {formatNumber(data.stats.total)}</span>
                        {(riesgo !== "all" || actividad !== "all" || search) && (
                          <button
                            onClick={() => { setRiesgo("all"); setActividad("all"); setSearch(""); }}
                            className="ml-2 text-primary hover:underline text-[11px]"
                            title="Quitar filtros"
                          >
                            limpiar filtros
                          </button>
                        )}
                      </span>
                    )}
                </div>
                <ExportButtons
                  filename={`dropshippers_${period}`}
                  size="xs"
                  showLabel={false}
                  columns={["DNI", "Nombre", "Email", "Telefono", "Plan", "Canal", "GMV total", "Margen ML", "Subs cobradas", "Ganancia Unidrop", "Pagado", "Deuda", "Ventas pagas", "Creado", "Ultima venta"]}
                  rows={sortedItems.map((d) => [
                    d.dni ?? "", d.fantasy_name || d.nombre, d.email, d.telefono ?? "",
                    d.plan ?? "sin_plan", d.canal ?? "",
                    d.gmv_total ?? ((d.gmv ?? 0) + (d.tn_gmv ?? 0)),
                    d.profit_unidrop ?? 0,
                    d.subs_cobradas ?? 0,
                    d.ganancia_unidrop_neta ?? d.profit_unidrop ?? 0,
                    d.pago_unidrop_total ?? 0,
                    d.deuda_pendiente ?? 0,
                    (d.ventas_pagadas ?? 0) + (d.tn_ventas_pagadas ?? 0),
                    d.creado_en ?? "", d.ultima_venta ?? d.tn_ultima_venta ?? "",
                  ])}
                />
              </div>
            )}
          </div>

          {/* Banner de filtro activo con sub-totales */}
          {data?.filtered_stats && data.stats.total !== data.total && (
            <div className="px-4 py-2.5 bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border flex items-center gap-4 flex-wrap text-xs">
              <span className="font-semibold text-primary">Subset filtrado:</span>
              <span><span className="text-text-muted">GMV</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.gmv)}</span></span>
              <span><span className="text-text-muted">Profit ML</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.profit_unidrop)}</span></span>
              {data.filtered_stats.subs_cobradas !== undefined && (
                <span><span className="text-text-muted">Subs</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.subs_cobradas)}</span></span>
              )}
              {data.filtered_stats.ganancia_unidrop_total !== undefined && (
                <span><span className="text-text-muted">Ganancia Unidrop</span> <span className="font-bold tabular-nums text-emerald-700">{formatCurrency(data.filtered_stats.ganancia_unidrop_total)}</span></span>
              )}
              <span><span className="text-text-muted">Deuda</span> <span className="font-bold tabular-nums text-error">{formatCurrency(data.filtered_stats.deuda_pendiente)}</span></span>
              <span className="text-[10px] text-text-muted ml-auto">Los KPIs de arriba siguen mostrando totales del universo</span>
            </div>
          )}

          <div className="overflow-x-auto max-h-[calc(100vh-360px)] overflow-y-auto">
            {isLoading ? (
              <div className="p-12 text-center text-text-muted">Cargando...</div>
            ) : !data?.items.length ? (
              <div className="p-12 text-center text-text-muted">Sin coincidencias.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Dropshipper</th>
                    {canal !== "tn" && <th className="text-left px-3 py-2" title="Plan de suscripcion MELI">Plan</th>}
                    {canal !== "tn" && <th className="text-left px-3 py-2" title="Cuenta de Mercado Libre vinculada">Cuenta MELI</th>}
                    {canal !== "tn" && <th className="text-right px-3 py-2" title="Publicaciones activas / totales">Pub.</th>}
                    <SortHdr k="ventas_pagadas" label="Ventas / GMV" sortKey={sortKey} sortDir={sortDir} onSort={onSort} title="Click para ordenar por GMV combinado ML+TN" />
                    <SortHdr k="ganancia_unidrop_neta" label="Ganancia Unidrop" sortKey={sortKey} sortDir={sortDir} onSort={onSort} title="Ganancia neta para Unidrop = margen ML (profit_for_subscription) + suscripciones cobradas en el periodo" />
                    <SortHdr k="deuda_pendiente" label="Pagos / Deuda" sortKey={sortKey} sortDir={sortDir} onSort={onSort} title="Click para ordenar por deuda pendiente" />
                    <th className="text-right px-3 py-2" title="Cantidad de dropshippers referidos por este operador">Refer.</th>
                    <th className="text-center px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((d) => {
                    const wa = waLink(d.telefono);
                    return (
                      <tr key={d.user_id} className="border-t border-border hover:bg-soft transition">
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <a
                                href={`/dashboard/dropshipper/${d.user_id}`}
                                className="font-medium text-text hover:text-primary hover:underline"
                                title="Abrir vista 360 dropshipper Unidrop"
                              >
                                {d.fantasy_name || d.nombre}
                              </a>
                              <div className="text-[11px] text-text-muted">{d.email}</div>
                              {d.dni && <div className="text-[10px] text-text-muted font-mono">DNI {d.dni}</div>}
                            </div>
                            <ChannelBadge canal={d.canal} />
                          </div>
                        </td>
                        {canal !== "tn" && (
                          <td className="px-3 py-2 align-top text-xs">
                            <div className="font-medium text-text">{d.plan ?? "—"}</div>
                            <div className="text-[10px] text-text-muted">
                              {d.plan_precio ? formatCurrency(d.plan_precio) : "—"}/mes
                            </div>
                            {d.dias_al_vencimiento !== null && (
                              <div className={"text-[10px] " + (d.dias_al_vencimiento < 0 ? "text-error font-bold" : d.dias_al_vencimiento < 7 ? "text-error" : d.dias_al_vencimiento < 15 ? "text-amber-700" : "text-text-muted")}>
                                {d.dias_al_vencimiento < 0 ? `vencido ${Math.abs(d.dias_al_vencimiento)}d` : `vence ${d.dias_al_vencimiento}d`}
                              </div>
                            )}
                          </td>
                        )}
                        {canal !== "tn" && (
                          <td className="px-3 py-2 align-top text-xs">
                            {d.nickname_meli ? (
                              <>
                                <div className="font-medium">{d.nickname_meli}</div>
                                {d.requiere_reauth && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-error mt-0.5">
                                    <AlertTriangle size={9} /> reauth
                                  </span>
                                )}
                              </>
                            ) : <span className="text-text-muted">sin cuenta</span>}
                          </td>
                        )}
                        {canal !== "tn" && (
                          <td className="px-3 py-2 align-top text-right tabular-nums">
                            <div className="font-semibold">{formatNumber(d.pub_activas)}<span className="text-text-muted text-[11px]"> / {formatNumber(d.pub_totales)}</span></div>
                            <div className="text-[10px] text-text-muted">activas / total</div>
                          </td>
                        )}
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          {(d.ventas_pagadas > 0 || d.gmv > 0) && (
                            <div title="Ventas en Mercado Libre">
                              <div className="font-bold text-emerald-700">{formatCurrency(d.gmv)}</div>
                              <div className="text-[10px] text-text-muted">
                                <span className="inline-block px-1 rounded bg-yellow-100 text-yellow-800 text-[8px] font-bold mr-1">MELI</span>
                                {formatNumber(d.ventas_pagadas)} ventas
                              </div>
                            </div>
                          )}
                          {(d.tn_ventas_pagadas ?? 0) > 0 && (
                            <div className="mt-1 pt-1 border-t border-border" title="Ventas en Tienda Nube">
                              <div className="font-bold text-cyan-700">{formatCurrency(d.tn_gmv ?? 0)}</div>
                              <div className="text-[10px] text-text-muted">
                                <span className="inline-block px-1 rounded bg-cyan-100 text-cyan-800 text-[8px] font-bold mr-1">TN</span>
                                {formatNumber(d.tn_ventas_pagadas ?? 0)} ventas
                              </div>
                            </div>
                          )}
                          {d.ventas_pagadas === 0 && (d.tn_ventas_pagadas ?? 0) === 0 && (
                            <div className="text-[10px] text-text-muted">Sin ventas</div>
                          )}
                          {d.canceladas > 0 && (
                            <div className="text-[10px] text-error mt-0.5">{d.canceladas} canc</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          <div className="font-bold text-emerald-700">{formatCurrency(d.ganancia_unidrop_neta ?? d.profit_unidrop)}</div>
                          <div className="text-[10px] text-text-muted leading-tight">
                            <div>margen ML <span className="tabular-nums">{formatCurrency(d.profit_unidrop)}</span></div>
                            {(d.subs_cobradas ?? 0) > 0 && (
                              <div>+ subs <span className="tabular-nums">{formatCurrency(d.subs_cobradas ?? 0)}</span></div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          <div className="font-semibold">{formatCurrency(d.pago_unidrop_total)}</div>
                          {d.deuda_pendiente > 0 ? (
                            <div className="text-[10px] text-error font-bold">deuda {formatCurrency(d.deuda_pendiente)}</div>
                          ) : (
                            <div className="text-[10px] text-text-muted">{d.pagos_procesados} pagos</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          {d.cant_referidos > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                              <Sparkles size={11} /> {d.cant_referidos}
                            </span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex gap-1.5">
                            {wa && (
                              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-emerald-500 text-white hover:bg-emerald-600" title={`WhatsApp ${d.telefono}`}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.32A8 8 0 0 0 4.16 17.32L3 22l4.86-1.27a8 8 0 0 0 11.86-7A7.9 7.9 0 0 0 17.6 6.32zM12 20.13a6.6 6.6 0 0 1-3.36-.92l-.24-.14L5.5 19.7l.78-2.85-.16-.25A6.6 6.6 0 1 1 18.6 12a6.6 6.6 0 0 1-6.6 8.13z"/></svg>
                              </a>
                            )}
                            {d.email && (
                              <a href={`mailto:${d.email}`} className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-soft text-text-muted hover:text-primary hover:bg-primary/10" title={d.email}>
                                <Mail size={12} />
                              </a>
                            )}
                            <a href={`/dashboard/dropshipper/${d.user_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-soft text-text-muted hover:text-primary hover:bg-primary/10" title="Vista 360 dropshipper Unidrop">
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {/* Footer paginacion: indica cuantos se muestran y permite cargar mas */}
            {!isLoading && data?.items?.length && sortedItems.length > pageLimit && (
              <div className="px-4 py-3 border-t border-border bg-soft/30 flex items-center justify-between gap-2 flex-wrap text-xs">
                <div className="text-text-muted">
                  Mostrando <span className="font-bold text-text">{formatNumber(visibleItems.length)}</span> de {formatNumber(sortedItems.length)} ordenados por <span className="font-semibold">{sortKey}</span> {sortDir === "desc" ? "desc" : "asc"}
                </div>
                <div className="flex items-center gap-1.5">
                  {[200, 500, 1000, 5000].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPageLimit(n)}
                      className={
                        "px-2 py-1 rounded-md text-[11px] font-semibold transition " +
                        (pageLimit === n ? "bg-primary text-white" : "bg-soft text-text-muted hover:text-text")
                      }
                    >
                      {formatNumber(n)}
                    </button>
                  ))}
                  <button
                    onClick={() => setPageLimit(sortedItems.length)}
                    className={
                      "px-2 py-1 rounded-md text-[11px] font-semibold transition " +
                      (pageLimit >= sortedItems.length ? "bg-primary text-white" : "bg-soft text-text-muted hover:text-text")
                    }
                  >
                    Todos
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

type SortKey_ = "ganancia_unidrop_neta" | "gmv_total" | "profit_unidrop" | "subs_cobradas"
  | "deuda_pendiente" | "ventas_pagadas" | "creado_en" | "ultima_venta";

function SortHdr({
  k, label, sortKey, sortDir, onSort, title,
}: {
  k: SortKey_;
  label: string;
  sortKey: SortKey_;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey_) => void;
  title?: string;
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onSort(k)}
      title={title}
      className="text-right px-3 py-2 cursor-pointer select-none hover:bg-soft/80 transition"
    >
      <div className="inline-flex items-center gap-1 justify-end">
        {label}
        {active && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </div>
    </th>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">{label}</div>
      <div className={"text-xl font-extrabold mt-1 tabular-nums " + (color ?? "text-text")}>{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function RiskChip({ label, value, active, onClick, color, hint }: {
  label: string; value: number; active: boolean; onClick: () => void;
  color: string; hint?: string;
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
      title={hint}
    >
      <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">{label}</div>
      <div className="text-2xl font-extrabold text-text tabular-nums mt-0.5">{formatNumber(value)}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </button>
  );
}

function ChannelCard({
  label, count, gmv, hint, active, onClick, color, activeColor,
}: {
  label: string; count: number; gmv: number | null; hint: string;
  active: boolean; onClick: () => void; color: string; activeColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border-2 p-3 text-left transition bg-gradient-to-br " +
        (active ? activeColor + " ring-2 ring-primary shadow-md" : color + " hover:shadow-md")
      }
    >
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-2xl font-extrabold text-text tabular-nums">{formatNumber(count)}</div>
        {gmv !== null && gmv > 0 && (
          <div className="text-[10px] font-semibold text-emerald-700 tabular-nums">{formatCurrency(gmv)}</div>
        )}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>
    </button>
  );
}

function ChannelBadge({ canal }: { canal?: string }) {
  if (!canal) return null;
  const cfg: Record<string, { label: string; cls: string }> = {
    meli: { label: "MELI", cls: "bg-yellow-50 text-yellow-800 border-yellow-300" },
    tn: { label: "TN", cls: "bg-cyan-50 text-cyan-800 border-cyan-300" },
    ambos: { label: "MELI + TN", cls: "bg-violet-50 text-violet-800 border-violet-300" },
    sin_canal: { label: "Sin canal", cls: "bg-zinc-50 text-zinc-500 border-zinc-300" },
  };
  const c = cfg[canal] ?? { label: canal, cls: "bg-zinc-50 text-zinc-600 border-zinc-300" };
  return (
    <span className={"inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider " + c.cls}>
      {c.label}
    </span>
  );
}
