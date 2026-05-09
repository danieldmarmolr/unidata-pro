"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Mail, Search, ExternalLink, AlertTriangle, Sparkles } from "lucide-react";

type Plan = "all" | "1" | "2" | "3" | "4";
type Riesgo = "all" | "sin_publicar" | "sin_vender" | "con_deuda" | "token_expira";
type Actividad = "all" | "activo" | "inactivo";

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
};

type Resp = {
  items: DS[];
  total: number;
  stats: {
    total: number; gmv: number; profit_unidrop: number; pago_unidrop: number; deuda_pendiente: number;
    sin_publicar: number; sin_vender: number; con_deuda: number; token_expira: number;
    activos_30d?: number; inactivos?: number;
  };
  filtered_stats?: {
    total: number; gmv: number; profit_unidrop: number; pago_unidrop: number; deuda_pendiente: number;
  };
  filters_applied?: { plan: string; riesgo: string; actividad: string; search: string };
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
  const [plan, setPlan] = useState<Plan>("all");
  const [riesgo, setRiesgo] = useState<Riesgo>("all");
  const [actividad, setActividad] = useState<Actividad>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["dropshippers", plan, riesgo, actividad, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("plan", plan);
      qs.set("riesgo", riesgo);
      qs.set("actividad", actividad);
      if (search) qs.set("search", search);
      return api(`/api/dashboards/dropshippers?${qs.toString()}`);
    },
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Dropshippers Unidrop"
        subtitle="Vista 360 por operador · suscripcion · publicaciones · ventas · deuda · referidos"
        hidePeriod
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
          <Stat label="Dropshippers" value={formatNumber(data?.stats.total ?? 0)} hint="con suscripcion" />
          <Stat label="GMV total" value={formatCurrency(data?.stats.gmv ?? 0)} hint="ventas pagas MELI" color="text-emerald-700" />
          <Stat label="Profit Unidrop" value={formatCurrency(data?.stats.profit_unidrop ?? 0)} hint="profit_for_subscription" color="text-primary" />
          <Stat label="Pagado a Unidrop" value={formatCurrency(data?.stats.pago_unidrop ?? 0)} hint="payment intents PROCESSED" />
          <Stat label="Deuda pendiente" value={formatCurrency(data?.stats.deuda_pendiente ?? 0)} hint="intents != PROCESSED" color="text-error" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <RiskChip label="Sin publicar" value={data?.stats.sin_publicar ?? 0} active={riesgo === "sin_publicar"} onClick={() => setRiesgo(riesgo === "sin_publicar" ? "all" : "sin_publicar")} color="bg-amber-50 border-amber-200" />
          <RiskChip label="Sin vender" value={data?.stats.sin_vender ?? 0} active={riesgo === "sin_vender"} onClick={() => setRiesgo(riesgo === "sin_vender" ? "all" : "sin_vender")} color="bg-orange-50 border-orange-200" />
          <RiskChip label="Con deuda" value={data?.stats.con_deuda ?? 0} active={riesgo === "con_deuda"} onClick={() => setRiesgo(riesgo === "con_deuda" ? "all" : "con_deuda")} color="bg-red-50 border-red-200" />
          <RiskChip label="Token MELI vencido" value={data?.stats.token_expira ?? 0} active={riesgo === "token_expira"} onClick={() => setRiesgo(riesgo === "token_expira" ? "all" : "token_expira")} color="bg-violet-50 border-violet-200" />
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
              <div className="text-xs text-text-muted ml-auto">
                {data.stats.total === data.total
                  ? `${formatNumber(data.total)} dropshippers`
                  : (
                    <span>
                      Viendo <span className="font-bold text-text">{formatNumber(data.total)}</span> de {formatNumber(data.stats.total)}
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
            )}
          </div>

          {/* Banner de filtro activo con sub-totales */}
          {data?.filtered_stats && data.stats.total !== data.total && (
            <div className="px-4 py-2.5 bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border flex items-center gap-4 flex-wrap text-xs">
              <span className="font-semibold text-primary">Subset filtrado:</span>
              <span><span className="text-text-muted">GMV</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.gmv)}</span></span>
              <span><span className="text-text-muted">Profit</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.profit_unidrop)}</span></span>
              <span><span className="text-text-muted">Pagado</span> <span className="font-bold tabular-nums">{formatCurrency(data.filtered_stats.pago_unidrop)}</span></span>
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
                    <th className="text-left px-3 py-2">Plan</th>
                    <th className="text-left px-3 py-2">MELI</th>
                    <th className="text-right px-3 py-2">Pub.</th>
                    <th className="text-right px-3 py-2">Ventas / GMV</th>
                    <th className="text-right px-3 py-2">Profit</th>
                    <th className="text-right px-3 py-2">Pagos / Deuda</th>
                    <th className="text-right px-3 py-2">Refer.</th>
                    <th className="text-center px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => {
                    const wa = waLink(d.telefono);
                    return (
                      <tr key={d.user_id} className="border-t border-border hover:bg-soft transition">
                        <td className="px-3 py-2 align-top">
                          <a
                            href={`/dashboard/dropshipper/${d.user_id}`}
                            className="font-medium text-text hover:text-primary hover:underline"
                            title="Abrir vista 360 dropshipper Unidrop"
                          >
                            {d.fantasy_name || d.nombre}
                          </a>
                          <div className="text-[11px] text-text-muted">{d.email}</div>
                          {d.dni && <div className="text-[10px] text-text-muted font-mono">DNI {d.dni}</div>}
                        </td>
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
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          <div className="font-semibold">{formatNumber(d.pub_activas)}<span className="text-text-muted text-[11px]"> / {formatNumber(d.pub_totales)}</span></div>
                          <div className="text-[10px] text-text-muted">activas / total</div>
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          <div className="font-bold text-emerald-700">{formatCurrency(d.gmv)}</div>
                          <div className="text-[10px] text-text-muted">{formatNumber(d.ventas_pagadas)} ventas</div>
                          {d.canceladas > 0 && (
                            <div className="text-[10px] text-error">{d.canceladas} canc</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums">
                          <div className="font-semibold text-primary">{formatCurrency(d.profit_unidrop)}</div>
                          <div className="text-[10px] text-text-muted">profit_for_sub</div>
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
          </div>
        </div>
      </div>
    </>
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

function RiskChip({ label, value, active, onClick, color }: { label: string; value: number; active: boolean; onClick: () => void; color: string }) {
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
