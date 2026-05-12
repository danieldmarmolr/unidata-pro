"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CreditCard,
  Wallet,
  Package,
  Calendar,
  Mail,
  Phone,
  IdCard,
  Award,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";

type DropshipperDetail = {
  user: {
    user_id: number;
    nombre: string;
    email: string;
    telefono: string;
    dni: string;
    cuit: string;
    fantasy_name: string;
    personeria: string;
    activo: boolean;
    creado_en: string;
    referrer_id: number | null;
    plan_id: number | null;
    plan: string;
    plan_precio: number;
    plan_pub_max: number;
    sub_desde: string | null;
    sub_vence: string | null;
    sub_status: string;
    dias_al_vencimiento: number | null;
    cuenta_meli_id: number | null;
    nickname_meli: string;
    requiere_reauth: boolean;
    token_expira: string | null;
    cant_referidos: number;
    canal?: "meli" | "tn" | "ambos" | "sin_canal";
  };
  ventas_tn?: {
    ventas_pagadas: number;
    ordenes_totales: number;
    gmv: number;
    ultima_venta: string | null;
    primera_venta: string | null;
    ticket_promedio: number;
    tiendas_conectadas: number;
  };
  ventas: {
    ventas_pagadas: number;
    ordenes_totales: number;
    canceladas: number;
    ultima_venta: string | null;
    primera_venta: string | null;
    gmv: number;
    costo_mercaderia: number;
    costo_envio: number;
    profit_unidrop: number;
    ticket_promedio: number;
    tasa_cancelacion_pct: number;
  };
  pagos: {
    total_intents: number;
    procesados: number;
    pagado_total: number;
    deuda_pendiente: number;
    pagos_con_deuda: number;
    ultimo_pago: string | null;
    pagado_tn_period?: number;
    pagado_ml_period?: number;
    pagado_total_period?: number;
    pagos_tn_period_count?: number;
    pagos_ml_period_count?: number;
  };
  suscripciones?: {
    total_pagado: number;
    cantidad: number;
    items: { id: number; talo_transaction_id: string; amount: number; currency: string; fecha: string | null; plan: string }[];
  };
  publicaciones: { totales: number; activas: number; ultima: string | null };
  monthly: { mes: string; ordenes: number; gmv: number; profit: number }[];
  ultimas_ventas: {
    id: number;
    ml_order_id: string;
    number?: string;
    status: string;
    fecha: string;
    total: number;
    profit_unidrop: number;
    shipping_cost: number;
    synced_in_oml?: boolean;
  }[];
  ultimas_ventas_tn?: {
    id: number;
    number: string;
    status: string;
    fecha: string;
    total: number;
  }[];
  ultimos_pagos: {
    id: number;
    status: string;
    fecha: string;
    paid: number;
    pending: number;
    ml_orders: number;
    tn_orders: number;
  }[];
  top_clientes_finales?: {
    category: string;
    value: number;
    extra?: { dni?: string; provincia?: string; ordenes?: number; unidrop_consumer?: boolean };
  }[];
  generated_at: string;
};

function recencyDays(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function statusColor(s: string): string {
  const v = s.toLowerCase();
  if (v === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (v === "cancelled") return "bg-rose-50 text-rose-700 border-rose-200";
  if (v === "shipped" || v === "delivered") return "bg-blue-50 text-blue-700 border-blue-200";
  if (v === "processed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-zinc-50 text-zinc-600 border-zinc-200";
}

export default function DropshipperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);

  const { data, isLoading, error } = useQuery<DropshipperDetail>({
    queryKey: ["dropshipper", id, period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/dropshippers/${encodeURIComponent(id)}?${periodToQuery(period, customFrom, customTo)}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <>
        <Topbar title="Dropshipper" subtitle="Cargando..." hidePeriod />
        <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (error || !data || (data as any).error) {
    return (
      <>
        <Topbar title="Dropshipper no encontrado" hidePeriod />
        <div className="flex-1 px-8 py-6">
          <Link href="/dashboard/dropshippers" className="inline-flex items-center gap-2 text-primary hover:underline mb-4">
            <ArrowLeft size={14} /> Volver al listado
          </Link>
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">
            {(data as any)?.error || (error as Error)?.message || "Error al cargar dropshipper"}
          </div>
        </div>
      </>
    );
  }

  const u = data.user;
  const v = data.ventas;
  const pg = data.pagos;
  const pubs = data.publicaciones;
  const recencyD = recencyDays(v.ultima_venta);
  const tokenDays = recencyDays(u.token_expira);
  const subActiva = u.sub_status?.toLowerCase() === "active" || (u.dias_al_vencimiento ?? -1) > 0;

  const maxMonthly = Math.max(1, ...data.monthly.map((m) => m.gmv));

  return (
    <>
      <Topbar
        title={u.fantasy_name || u.nombre || `Dropshipper #${u.user_id}`}
        subtitle="Vista 360 · Dropshipper Unidrop · ventas MELI · pagos Talo · suscripcion"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <Link
          href="/dashboard/dropshippers"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-primary mb-4"
        >
          <ArrowLeft size={14} /> Volver al listado de dropshippers
        </Link>

        {/* Identidad + suscripcion */}
        <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-transparent border border-border rounded-2xl p-5 mb-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center font-extrabold text-2xl shadow-lg flex-shrink-0">
              {(u.fantasy_name || u.nombre || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-text">{u.fantasy_name || u.nombre || `Dropshipper #${u.user_id}`}</h2>
              {u.fantasy_name && u.nombre && u.fantasy_name !== u.nombre && (
                <div className="text-sm text-text-muted">Titular: {u.nombre}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                {u.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail size={11} /> {u.email}
                  </span>
                )}
                {u.telefono && (
                  <span className="inline-flex items-center gap-1">
                    <Phone size={11} /> {u.telefono}
                  </span>
                )}
                {(u.dni || u.cuit) && (
                  <span className="inline-flex items-center gap-1">
                    <IdCard size={11} /> {u.cuit || u.dni}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} /> Alta {u.creado_en?.slice(0, 10) || "-"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold">
                  {u.personeria}
                </span>
              </div>
            </div>

            {/* Plan badge */}
            <div className="bg-surface border border-border rounded-xl p-3 min-w-[200px]">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Plan suscripcion</div>
              <div className="text-base font-bold text-text">{u.plan || "Sin plan"}</div>
              <div className="text-xs text-text-muted">
                {formatCurrency(u.plan_precio)}/mes · {u.plan_pub_max} pub max
              </div>
              {subActiva ? (
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <CheckCircle2 size={12} /> Activa · vence en {u.dias_al_vencimiento}d
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                  <XCircle size={12} /> Vencida o inactiva
                </div>
              )}
            </div>
          </div>

          {/* Canal de operacion */}
          <div className="mt-4 flex flex-wrap gap-2">
            {u.canal === "ambos" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-xs font-bold uppercase tracking-wider">
                Canal: MELI + Tienda Nube
              </span>
            )}
            {u.canal === "meli" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-bold uppercase tracking-wider">
                Canal: solo Mercado Libre
              </span>
            )}
            {u.canal === "tn" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs font-bold uppercase tracking-wider">
                Canal: solo Tienda Nube · sin suscripcion MELI
              </span>
            )}
            {u.canal === "sin_canal" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-600 text-xs font-bold uppercase tracking-wider">
                Sin canal de operacion · alta sin actividad
              </span>
            )}
            {u.nickname_meli ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs font-semibold">
                <Award size={12} /> MELI: {u.nickname_meli}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-600 text-xs font-semibold">
                <Award size={12} /> Sin cuenta MELI vinculada
              </span>
            )}
            {data.ventas_tn && data.ventas_tn.tiendas_conectadas > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs font-semibold">
                {data.ventas_tn.tiendas_conectadas} {data.ventas_tn.tiendas_conectadas === 1 ? "tienda TN conectada" : "tiendas TN conectadas"}
              </span>
            )}
            {u.requiere_reauth && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                <AlertTriangle size={12} /> Token MELI requiere re-auth
              </span>
            )}
            {tokenDays !== null && tokenDays > -7 && tokenDays <= 7 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
                <Clock size={12} /> Token expira en {tokenDays}d
              </span>
            )}
            {u.cant_referidos > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold">
                {u.cant_referidos} referidos
              </span>
            )}
          </div>
        </div>

        {/* KPIs principales */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
          <KpiBox icon={DollarSign} label="GMV MELI" value={formatCurrency(v.gmv)} accent="emerald"
                  hint={`${formatNumber(v.ventas_pagadas)} ventas pagadas en Mercado Libre`} />
          <KpiBox icon={Wallet} label="Profit Unidrop" value={formatCurrency(v.profit_unidrop)} accent="primary"
                  hint="Comisión Unidrop por las ventas MELI (suscripcion)" />
          <KpiBox icon={TrendingUp} label="Ticket promedio" value={formatCurrency(v.ticket_promedio)} accent="amber"
                  hint="GMV / ventas pagadas" />
          <KpiBox
            icon={ShoppingBag}
            label="Órdenes pagadas"
            value={formatNumber(v.ventas_pagadas)}
            accent="primary"
            hint={v.canceladas > 0 ? `${v.canceladas} canceladas (${v.tasa_cancelacion_pct}%)` : "Sin cancelaciones"}
          />
          <KpiBox
            icon={Calendar}
            label="Última venta"
            value={recencyD === null ? "Sin ventas" : recencyD === 0 ? "Hoy" : `${recencyD}d atrás`}
            accent={recencyD === null ? "rose" : recencyD <= 30 ? "emerald" : "amber"}
            hint={v.ultima_venta?.slice(0, 16) || "Aún no vendió"}
          />
          <KpiBox
            icon={CreditCard}
            label="Deuda Talo"
            value={formatCurrency(pg.deuda_pendiente)}
            accent={pg.deuda_pendiente > 0 ? "rose" : "emerald"}
            hint={pg.pagos_con_deuda > 0 ? `${pg.pagos_con_deuda} intents pendientes` : "Al día"}
          />
        </div>

        {/* KPIs secundarios */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KpiBox icon={CreditCard} label="Pagado a Unidrop" value={formatCurrency(pg.pagado_total)} accent="emerald"
                  hint={`${pg.procesados} pagos PROCESSED de ${pg.total_intents}`} />
          <KpiBox icon={Package} label="Publicaciones activas" value={formatNumber(pubs.activas)} accent="primary"
                  hint={`${pubs.totales} totales · max ${u.plan_pub_max}`} />
          <KpiBox icon={DollarSign} label="Costo mercadería" value={formatCurrency(v.costo_mercaderia)} accent="amber"
                  hint="Suma costos de mercadería en órdenes pagadas" />
          <KpiBox icon={Package} label="Costo envíos" value={formatCurrency(v.costo_envio)} accent="amber"
                  hint="Suma costos de envío MELI" />
        </div>

        {/* Ventas pagadas a Unidrop (PaymentIntent) - desglose TN/ML + suscripciones */}
        {(pg.pagado_total_period !== undefined && (pg.pagado_total_period > 0 || (data.suscripciones?.total_pagado ?? 0) > 0)) && (
          <div className="bg-violet-50/50 border-2 border-violet-200 rounded-xl p-4 sm:p-5 mb-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-violet-900">
                  <span className="inline-block px-2 py-0.5 rounded bg-violet-200 text-violet-900 text-[10px] font-extrabold uppercase tracking-wider mr-2">UNIDROP</span>
                  Ventas pagadas a Unidrop (en periodo)
                </h3>
                <p className="text-[11px] text-violet-700/80">
                  PaymentIntent PROCESSED · separado por origen (TN / ML) · suscripcion aparte
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiBox
                icon={DollarSign}
                label="Pagado total (periodo)"
                value={formatCurrency(pg.pagado_total_period ?? 0)}
                accent="primary"
                hint={`${(pg.pagos_tn_period_count ?? 0) + (pg.pagos_ml_period_count ?? 0)} intents PROCESSED`}
              />
              <KpiBox
                icon={ShoppingBag}
                label="Pagado por ventas TN"
                value={formatCurrency(pg.pagado_tn_period ?? 0)}
                accent="emerald"
                hint={`${pg.pagos_tn_period_count ?? 0} intents con orderIds`}
              />
              <KpiBox
                icon={Award}
                label="Pagado por ventas ML"
                value={formatCurrency(pg.pagado_ml_period ?? 0)}
                accent="amber"
                hint={`${pg.pagos_ml_period_count ?? 0} intents con mlOrderIds`}
              />
              <KpiBox
                icon={CreditCard}
                label={`Suscripcion ${u.plan || ""}`.trim()}
                value={formatCurrency(data.suscripciones?.total_pagado ?? 0)}
                accent="rose"
                hint={`${data.suscripciones?.cantidad ?? 0} pagos de suscripcion (Talo)`}
              />
            </div>

            {(data.suscripciones?.items?.length ?? 0) > 0 && (
              <div className="mt-4 bg-surface border border-violet-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-violet-200 text-[11px] font-bold text-violet-900">
                  Pagos de suscripcion en el periodo
                </div>
                <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-violet-50 text-violet-900 text-[10px] uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Talo Tx</th>
                        <th className="text-left px-2 py-2">Plan</th>
                        <th className="text-left px-2 py-2">Fecha</th>
                        <th className="text-right px-2 py-2">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.suscripciones!.items.map((s) => (
                        <tr key={s.id} className="border-t border-violet-100">
                          <td className="px-3 py-1.5 font-mono text-text-muted">{s.talo_transaction_id}</td>
                          <td className="px-2 py-1.5">{s.plan}</td>
                          <td className="px-2 py-1.5 text-text-muted">{fmtArDateTime(s.fecha)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-violet-700">
                            {formatCurrency(s.amount)} {s.currency !== "ARS" ? s.currency : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KPIs TIENDA NUBE - solo si vende por TN */}
        {data.ventas_tn && (data.ventas_tn.ventas_pagadas > 0 || data.ventas_tn.tiendas_conectadas > 0) && (
          <div className="bg-cyan-50/50 border-2 border-cyan-200 rounded-xl p-4 sm:p-5 mb-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-cyan-900">
                  <span className="inline-block px-2 py-0.5 rounded bg-cyan-200 text-cyan-900 text-[10px] font-extrabold uppercase tracking-wider mr-2">TN</span>
                  Ventas en Tienda Nube
                </h3>
                <p className="text-[11px] text-cyan-700/80">
                  Cliente final del dropshipper · sin suscripcion ni profit Unidrop
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiBox
                icon={DollarSign}
                label="GMV TN"
                value={formatCurrency(data.ventas_tn.gmv)}
                accent="emerald"
                hint={`${formatNumber(data.ventas_tn.ventas_pagadas)} ventas pagadas`}
              />
              <KpiBox
                icon={ShoppingBag}
                label="Ordenes pagadas TN"
                value={formatNumber(data.ventas_tn.ventas_pagadas)}
                accent="primary"
                hint={`${formatNumber(data.ventas_tn.ordenes_totales)} totales`}
              />
              <KpiBox
                icon={TrendingUp}
                label="Ticket promedio TN"
                value={formatCurrency(data.ventas_tn.ticket_promedio)}
                accent="amber"
                hint="GMV TN / ventas pagadas"
              />
              <KpiBox
                icon={Calendar}
                label="Ultima venta TN"
                value={
                  data.ventas_tn.ultima_venta
                    ? `${recencyDays(data.ventas_tn.ultima_venta)}d atras`
                    : "Sin ventas"
                }
                accent={data.ventas_tn.ultima_venta ? "emerald" : "rose"}
                hint={data.ventas_tn.ultima_venta?.slice(0, 16) || "—"}
              />
            </div>
          </div>
        )}

        {/* Top clientes FINALES (compradores TN del dropshipper) - drill al End Consumer 360 */}
        {data.top_clientes_finales && data.top_clientes_finales.length > 0 && (
          <div className="mb-5">
            <CategoryTable
              caption="Top clientes finales (compradores TN)"
              subtitle="Personas que le compran a este dropshipper · click para ver el journey del cliente"
              data={data.top_clientes_finales}
              formatter="currency"
              extraColumns={[
                { key: "ordenes", label: "Órd", format: "number" },
                { key: "provincia", label: "Provincia", format: "raw" },
                { key: "dni", label: "DNI", format: "raw" },
              ]}
            />
          </div>
        )}

        {/* Mensual GMV */}
        {data.monthly.length > 0 && (
          <div className="bg-surface border border-border rounded-xl p-4 sm:p-5 mb-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-text">Evolución mensual · últimos 12 meses</h3>
                <p className="text-[11px] text-text-muted">GMV MELI y profit Unidrop por mes</p>
              </div>
              <div className="text-xs text-text-muted">
                Total: {formatCurrency(data.monthly.reduce((s, m) => s + m.gmv, 0))}
              </div>
            </div>
            <div className="space-y-2">
              {data.monthly.map((m) => (
                <div key={m.mes} className="flex items-center gap-3">
                  <div className="w-16 text-xs text-text-muted font-mono">{m.mes}</div>
                  <div className="flex-1 h-6 bg-soft rounded relative overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-accent"
                      style={{ width: `${(m.gmv / maxMonthly) * 100}%` }}
                    />
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-xs font-bold text-text">{formatCurrency(m.gmv)}</div>
                    <div className="text-[10px] text-text-muted">
                      {m.ordenes} órdenes · profit {formatCurrency(m.profit)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Últimas ventas MELI */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text">Últimas ventas en Mercado Libre</h3>
              <p className="text-[11px] text-text-muted">{data.ultimas_ventas.length} órdenes más recientes · ordenadas por fecha</p>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Number · DROP</th>
                    <th className="text-left px-2 py-2">ML Order</th>
                    <th className="text-left px-2 py-2">Estado</th>
                    <th className="text-left px-2 py-2">Fecha</th>
                    <th className="text-right px-2 py-2">Total</th>
                    <th className="text-right px-2 py-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimas_ventas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-text-muted py-6">
                        Sin ventas registradas
                      </td>
                    </tr>
                  ) : (
                    data.ultimas_ventas.map((o) => (
                      <tr key={o.id ?? o.ml_order_id} className="border-t border-border hover:bg-soft/40">
                        <td className="px-3 py-1.5 font-mono">
                          {o.number ? (
                            <a
                              href={`https://www.unidrop.com.ar/panel/unified-orders?page=1&search=${encodeURIComponent(o.number)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                              title="Abrir en panel Unidrop"
                            >
                              {o.number}
                              <ExternalLink size={9} />
                            </a>
                          ) : (
                            <span className="text-text-muted italic text-[10px]">sin sync OML</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {o.ml_order_id ? (
                            <a
                              href={`https://www.mercadolibre.com.ar/ventas/${o.ml_order_id}/detalle`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-text-muted hover:text-primary hover:underline text-[10px]"
                              title="Abrir en Mercado Libre"
                            >
                              {o.ml_order_id}
                              <ExternalLink size={9} />
                            </a>
                          ) : (
                            <span className="text-text-muted text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${statusColor(o.status)}`}>
                            {o.status || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-text-muted">{fmtArDateTime(o.fecha)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(o.total)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-violet-700">{formatCurrency(o.profit_unidrop)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Últimas ventas Tienda Nube */}
          {data.ultimas_ventas_tn && data.ultimas_ventas_tn.length > 0 && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-bold text-text">Últimas ventas en Tienda Nube</h3>
                <p className="text-[11px] text-text-muted">{data.ultimas_ventas_tn.length} órdenes TN del dropshipper · click para abrir en panel Unidrop</p>
              </div>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Number · DROP</th>
                      <th className="text-left px-2 py-2">TN ID</th>
                      <th className="text-left px-2 py-2">Estado</th>
                      <th className="text-left px-2 py-2">Fecha</th>
                      <th className="text-right px-2 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ultimas_ventas_tn.map((o) => (
                      <tr key={o.id} className="border-t border-border hover:bg-soft/40">
                        <td className="px-3 py-1.5 font-mono">
                          {o.number ? (
                            <a
                              href={`https://www.unidrop.com.ar/panel/unified-orders?page=1&search=${encodeURIComponent(o.number)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                              title="Abrir en panel Unidrop"
                            >
                              {o.number}
                              <ExternalLink size={9} />
                            </a>
                          ) : (
                            <span className="text-text-muted text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-text-muted">{o.id}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${statusColor(o.status)}`}>
                            {o.status || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-text-muted">{fmtArDateTime(o.fecha)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Últimos pagos Talo */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text">Últimos pagos a Unidrop (Talo Pay)</h3>
              <p className="text-[11px] text-text-muted">PaymentIntents · {pg.procesados} procesados / {pg.total_intents} totales</p>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">ID</th>
                    <th className="text-left px-2 py-2">Estado</th>
                    <th className="text-left px-2 py-2">Fecha</th>
                    <th className="text-right px-2 py-2">Pagado</th>
                    <th className="text-right px-2 py-2">Pendiente</th>
                    <th className="text-right px-2 py-2">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimos_pagos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-text-muted py-6">
                        Sin pagos registrados
                      </td>
                    </tr>
                  ) : (
                    data.ultimos_pagos.map((p) => (
                      <tr key={p.id} className="border-t border-border hover:bg-soft/40">
                        <td className="px-3 py-1.5 font-mono text-text-muted">{p.id}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${statusColor(p.status)}`}>
                            {p.status || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-text-muted">{fmtArDateTime(p.fecha)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 font-semibold">
                          {formatCurrency(p.paid)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">
                          {p.pending > 0 ? formatCurrency(p.pending) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[10px] text-text-muted">
                          {p.ml_orders > 0 && <span>ML×{p.ml_orders} </span>}
                          {p.tn_orders > 0 && <span>TN×{p.tn_orders}</span>}
                          {p.ml_orders === 0 && p.tn_orders === 0 && "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function KpiBox({
  icon: Icon,
  label,
  value,
  accent,
  hint,
}: {
  icon: any;
  label: string;
  value: string;
  accent: "primary" | "emerald" | "amber" | "rose";
  hint?: string;
}) {
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
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
