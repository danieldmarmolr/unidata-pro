"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  X,
  ChevronRight,
  ChevronDown,
  Truck,
  RotateCcw,
  StickyNote,
  Archive,
  Send,
  FileText,
  Download,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { api, getUser } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import { useTableSort, SortHeader } from "@/lib/use-table-sort";

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
    store_id?: string | null;
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
    ultima_venta_number?: string | null;
    primera_venta: string | null;
    gmv: number;
    costo_mercaderia: number;
    costo_envio: number;
    profit_unidrop: number;
    ticket_promedio: number;
    ticket_promedio_intent?: number;
    ventas_pagadas_intent?: number;
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
  monthly: { mes: string; ordenes: number; gmv: number; profit: number; ordenes_tn?: number; gmv_tn?: number }[];
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
  unified_orders?: UnifiedOrder[];
  combo_analytics?: ComboAnalytics | null;
  top_clientes_finales?: {
    category: string;
    value: number;
    extra?: { canal?: "TN" | "ML"; dni?: string; buyer_id?: string; provincia?: string; ordenes?: number; unidrop_consumer?: boolean };
  }[];
  tiendas_tn_detail?: Record<string, string | null>[];
  talo_accounts?: { id: number | null; creado_en: string | null; cbu?: string | null; cbu_alias?: string | null; alias?: string | null; bank_name?: string | null }[];
  referidos_list?: { user_id: number | null; nombre: string; email: string; creado_en: string | null; plan: string; sub_status: string; dias_al_vencimiento: number | null }[];
  subscription_intents?: { id: number | null; status: string; fecha: string | null; pagado: number; esperado: number; plan: string }[];
  sub_ltv?: { total_pagado: number; cant_procesadas: number; ultimo_pago: string | null; cant_pendientes: number; monto_pendiente: number };
  generated_at: string;
};

type OrderItem = { sku: string; name: string; qty: number; price: number; item_type?: string; cost?: number; image_url?: string };
type Shipment = {
  carrier: string;
  status: string;
  entregado: string | null;
  costo: number;
  tracking_number?: string;
  tracking_url?: string;
  tracking_qr?: string;
  receiver_name?: string;
  receiver_phone?: string;
  address?: string;
  city?: string;
  province?: string;
  zipcode?: string;
  last_update?: string;
} | null;

type UnifiedOrder = {
  origen: "ml" | "tn";
  internal_id: number | null;
  external_id: string;
  number: string;
  fecha: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  total: number;
  merch_cost: number;
  shipping_cost: number;
  profit_unidrop: number;
  buyer_name: string;
  billing_city?: string;
  billing_province?: string;
  billing_address?: string;
  billing_zipcode?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_dni?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_zipcode?: string;
  shipping_type: string;
  intent_id: number | null;
  enriched?: boolean;
  items?: OrderItem[];
  shipment?: Shipment;
  returns_count?: number;
  is_combo?: boolean;
  // Nuevos campos enriquecidos
  status_detail?: string;
  fecha_closed?: string;
  total_cost?: number;
  shipping_price?: number;
  shipping_carrier?: string;
  label_downloaded?: boolean;
  label_downloaded_at?: string;
  cancel_by_unidrop?: boolean;
  notification_pack?: boolean;
  notification_ship?: boolean;
  tags?: string[];
  buyer_id?: string;
  shipping_id?: string;
  contabilium_client_id?: string;
  shipping_comment?: string;
  shipping_receiver?: string;
  shipping_phone?: string;
  shipping_floor?: string;
  shipping_locality?: string;
  shipping_number?: string;
  // TN-specific
  tn_number?: string;
  subtotal?: number;
  discount?: number;
  shipping_option?: string;
  gateway?: string;
  gateway_name?: string;
  gateway_link?: string;
  paid_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  closed_at?: string;
  manual_packed_at?: string;
  manual_payment_at?: string;
  note?: string;
  owner_note?: string;
  // Contabilium invoice
  invoice?: {
    id: number | null;
    tipo: string;
    numero: string;
    link: string;
    fecha: string | null;
    total: number;
    cae: string;
    punto_venta: string;
  };
  // ML returns
  returns?: {
    status: string;
    reason: string;
    amount_to_refund: number;
    tracking_code: string;
    carrier: string;
    discrepancy_type: string;
    discrepancy_note: string;
    discrepancy_photo: string;
    received_at: string | null;
    created_at: string | null;
  }[];
  // Label PDF disponible?
  has_label?: boolean;
  // Pipeline timestamps
  packed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
};

type ComboAnalytics = {
  combo_count: number;
  individual_count: number;
  combo_revenue: number;
  individual_revenue: number;
  combo_pct: number;
  top_skus: {
    sku: string;
    name: string;
    qty: number;
    revenue: number;
    image_url: string;
    in_combos: number;
    in_individual: number;
  }[];
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

  // Click-to-filter: cuando se selecciona un PaymentIntent en la tabla derecha,
  // refetcheamos unified_orders pasandole intent_id. Sin seleccion usamos los
  // unified_orders que vienen en data (top 50 sin filtro).
  const [selectedIntent, setSelectedIntent] = useState<number | null>(null);
  const [channelFilter, setChannelFilter] = useState<"all" | "ml" | "tn">("all");
  const [comboFilter, setComboFilter] = useState<"all" | "combo" | "individual">("all");
  const [ordersPage, setOrdersPage] = useState(1);
  const ORDERS_PAGE_SIZE = 20;
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [modalOrder, setModalOrder] = useState<UnifiedOrder | null>(null);
  const toggleExpand = (key: string) =>
    setExpandedOrders((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const filteredQuery = useQuery<{ items: UnifiedOrder[]; total: number; intent_id: number }>({
    queryKey: ["dropshipper-unified", id, selectedIntent],
    queryFn: () => api(`/api/dashboards/dropshippers/${encodeURIComponent(id)}/unified-orders?intent_id=${selectedIntent}&limit=200`),
    enabled: !!selectedIntent,
    staleTime: 60_000,
  });
  const unifiedAll: UnifiedOrder[] = selectedIntent
    ? (filteredQuery.data?.items ?? [])
    : (data?.unified_orders ?? []);
  const unifiedFiltered: UnifiedOrder[] = unifiedAll
    .filter((o) => channelFilter === "all" || o.origen === channelFilter)
    .filter((o) => comboFilter === "all" || (comboFilter === "combo" ? !!o.is_combo : !o.is_combo));
  const countMl = unifiedAll.filter((o) => o.origen === "ml").length;
  const countTn = unifiedAll.filter((o) => o.origen === "tn").length;
  const countCombo = unifiedAll.filter((o) => !!o.is_combo).length;
  const unifiedSorted = useTableSort<UnifiedOrder>(unifiedFiltered, "fecha", "desc");
  const unifiedOrders = unifiedSorted.rows;
  const ordersTotalPages = Math.ceil(unifiedOrders.length / ORDERS_PAGE_SIZE);
  const paginatedOrders = unifiedOrders.slice((ordersPage - 1) * ORDERS_PAGE_SIZE, ordersPage * ORDERS_PAGE_SIZE);
  // Sort para Pagos Talo
  const pagosSorted = useTableSort<NonNullable<typeof data>["ultimos_pagos"][number]>(
    data?.ultimos_pagos ?? [],
    "fecha", "desc",
  );

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
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <CheckCircle2 size={12} /> Activa · vence en {u.dias_al_vencimiento}d
                </div>
              ) : (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                  <XCircle size={12} /> Vencida o inactiva
                </div>
              )}
              {data.sub_ltv && (
                <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                  <div className="text-[11px] font-bold text-text">
                    LTV suscripción: {formatCurrency(data.sub_ltv.total_pagado)}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {data.sub_ltv.cant_procesadas} pagos procesados
                    {data.sub_ltv.ultimo_pago && ` · último ${data.sub_ltv.ultimo_pago.slice(0, 10)}`}
                  </div>
                  {data.sub_ltv.cant_pendientes > 0 && (
                    <div className="text-[10px] text-amber-700 font-semibold">
                      {data.sub_ltv.cant_pendientes} pendiente{data.sub_ltv.cant_pendientes > 1 ? "s" : ""} · {formatCurrency(data.sub_ltv.monto_pendiente)}
                    </div>
                  )}
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
            {u.store_id && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs font-semibold font-mono">
                Store ID: {u.store_id}
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
        {(() => {
          const gmvMl = v.gmv;
          const gmvTn = data.ventas_tn?.gmv ?? 0;
          const gmvTotal = gmvMl + gmvTn;
          const ventasTotalCnt = v.ventas_pagadas + (data.ventas_tn?.ventas_pagadas ?? 0);
          const hasMl = gmvMl > 0 || v.ventas_pagadas > 0;
          const hasTn = gmvTn > 0 || (data.ventas_tn?.ventas_pagadas ?? 0) > 0;
          const mixHint = hasMl && hasTn
            ? `ML ${formatCurrency(gmvMl)} · TN ${formatCurrency(gmvTn)}`
            : hasTn ? "Solo TN" : hasMl ? "Solo MELI" : "Sin ventas";
          return <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
          <KpiBox
            icon={DollarSign}
            label="Ingreso omnicanal"
            value={formatCurrency(gmvTotal)}
            accent="emerald"
            hint={mixHint}
          />
          {(() => {
            const gananciaDrop = gmvTotal - (pg.pagado_total_period ?? 0);
            return (
              <KpiBox icon={Wallet} label="Ganancia dropshipper" value={formatCurrency(gananciaDrop)} accent="primary"
                      hint={`Ingreso ${formatCurrency(gmvTotal)} − pagado a Unidrop ${formatCurrency(pg.pagado_total_period ?? 0)} (sin suscripción)`} />
            );
          })()}
          <KpiBox
            icon={TrendingUp}
            label="Ticket a Unidrop"
            value={formatCurrency(v.ticket_promedio_intent ?? v.ticket_promedio)}
            accent="amber"
            hint={
              v.ticket_promedio_intent !== undefined && v.ticket_promedio_intent > 0
                ? `Promedio pagado por orden (PI / ${formatNumber(v.ventas_pagadas_intent ?? v.ventas_pagadas)} órd)`
                : "Promedio GMV por venta MELI"
            }
          />
          <KpiBox
            icon={ShoppingBag}
            label="Órdenes pagadas"
            value={formatNumber(ventasTotalCnt)}
            accent="primary"
            hint={hasMl && hasTn
              ? `ML ${formatNumber(v.ventas_pagadas)} · TN ${formatNumber(data.ventas_tn!.ventas_pagadas)}`
              : v.canceladas > 0 ? `${v.canceladas} canceladas (${v.tasa_cancelacion_pct}%)` : `${formatNumber(v.ventas_pagadas)} ML · ${formatNumber(data.ventas_tn?.ventas_pagadas ?? 0)} TN`}
          />
          <KpiBox
            icon={Calendar}
            label="Última venta"
            value={v.ultima_venta_number || (recencyD === null ? "Sin ventas" : recencyD === 0 ? "Hoy" : `${recencyD}d atrás`)}
            accent={recencyD === null ? "rose" : recencyD <= 30 ? "emerald" : "amber"}
            hint={v.ultima_venta?.slice(0, 16) || "Aún no vendió"}
            mono={!!v.ultima_venta_number}
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
          <KpiBox icon={CreditCard} label="Pagado a Unidrop (total)" value={formatCurrency(pg.pagado_total)} accent="emerald"
                  hint={`Histórico · ${pg.procesados} pagos PROCESSED de ${pg.total_intents}`} />
          <KpiBox icon={Wallet} label="Margen Unidrop (ML)" value={formatCurrency(v.profit_unidrop)} accent="primary"
                  hint="profit_for_subscription: lo que gana Unidrop por cada orden ML pagada" />
          <KpiBox icon={DollarSign} label="Costo mercadería" value={formatCurrency(v.costo_mercaderia)} accent="amber"
                  hint="Suma costos de mercadería en órdenes ML pagadas" />
          <KpiBox icon={Package} label="Publicaciones activas" value={formatNumber(pubs.activas)} accent="primary"
                  hint={`${pubs.totales} totales · max ${u.plan_pub_max}`} />
        </div>

        {/* Segmentación omnicanal — ML vs TN, visible siempre aunque uno sea 0 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div className="bg-yellow-50/40 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-yellow-900 flex items-center gap-1.5">
                <Award size={11} /> Canal Mercado Libre
              </div>
              {hasMl ? (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">ACTIVO</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-100 text-zinc-500 border border-zinc-200">SIN VENTAS</span>
              )}
            </div>
            <div className="text-2xl font-extrabold text-yellow-900 tabular-nums">{formatCurrency(gmvMl)}</div>
            <div className="text-[11px] text-yellow-800/70 mt-1">
              {formatNumber(v.ventas_pagadas)} órdenes pagadas
              {v.profit_unidrop > 0 && ` · Ganancia Unidrop ${formatCurrency(v.profit_unidrop)}`}
            </div>
          </div>
          <div className="bg-cyan-50/40 border border-cyan-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-900 flex items-center gap-1.5">
                <ShoppingBag size={11} /> Canal Tienda Nube
              </div>
              {hasTn ? (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">ACTIVO</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-100 text-zinc-500 border border-zinc-200">SIN VENTAS</span>
              )}
            </div>
            <div className="text-2xl font-extrabold text-cyan-900 tabular-nums">{formatCurrency(gmvTn)}</div>
            <div className="text-[11px] text-cyan-800/70 mt-1">
              {formatNumber(data?.ventas_tn?.ventas_pagadas ?? 0)} órdenes pagadas
              {(() => {
                const tConn = data?.ventas_tn?.tiendas_conectadas ?? 0;
                if (tConn <= 0) return null;
                return ` · ${tConn} tienda${tConn === 1 ? "" : "s"} conectada${tConn === 1 ? "" : "s"}`;
              })()}
            </div>
          </div>
        </div>;
        })()}

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

        {/* TiendaNube credential detail */}
        {data.tiendas_tn_detail && data.tiendas_tn_detail.some(t => t.store_url || t.store_name || t.status) && (
          <div className="bg-cyan-50/40 border border-cyan-200 rounded-xl p-4 mb-5">
            <h3 className="text-xs font-bold text-cyan-900 uppercase tracking-wider mb-3">Credenciales Tienda Nube</h3>
            <div className="space-y-2">
              {data.tiendas_tn_detail!.map((t, i) => (
                <div key={i} className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {t.store_id && <span className="text-text-muted">Store ID: <span className="font-mono font-bold text-text">{t.store_id}</span></span>}
                  {t.store_name && <span className="text-text-muted">Nombre: <span className="font-bold text-text">{t.store_name}</span></span>}
                  {t.store_url && (
                    <a href={String(t.store_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline font-medium">
                      <ExternalLink size={10} /> {t.store_url}
                    </a>
                  )}
                  {t.status && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${t.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-50 text-zinc-600 border-zinc-200"}`}>{t.status}</span>}
                  {t.created_at && <span className="text-text-muted">Conectada: {String(t.created_at).slice(0, 10)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notas del equipo sobre este dropshipper (source of truth) */}
        <DropshipperNotes dropshipperId={u.user_id} />

        {/* Talo accounts (CustomerPaymentAccount) */}
        {data.talo_accounts && data.talo_accounts.length > 0 && data.talo_accounts.some(a => a.cbu || a.cbu_alias || a.alias) && (
          <div className="bg-violet-50/40 border border-violet-200 rounded-xl p-4 mb-5">
            <h3 className="text-xs font-bold text-violet-900 uppercase tracking-wider mb-3">Cuentas Talo Pay</h3>
            <div className="space-y-2">
              {data.talo_accounts!.map((acc) => (
                <div key={acc.id} className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <span className="text-text-muted">ID: <span className="font-mono font-bold text-text">{acc.id}</span></span>
                  {(acc.cbu || acc.cbu_alias) && <span className="text-text-muted">CBU: <span className="font-mono font-bold text-text">{acc.cbu || acc.cbu_alias}</span></span>}
                  {acc.alias && <span className="text-text-muted">Alias: <span className="font-bold text-text">{acc.alias}</span></span>}
                  {acc.bank_name && <span className="text-text-muted">Banco: <span className="font-bold text-text">{acc.bank_name}</span></span>}
                  {acc.creado_en && <span className="text-text-muted">Desde: {acc.creado_en?.slice(0, 10)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historial de suscripcion (PaymentIntentSubscription all-time) */}
        {data.subscription_intents && data.subscription_intents.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-text">Historial de suscripción</h3>
                <p className="text-[11px] text-text-muted">
                  PaymentIntentSubscription · {data.subscription_intents.length} registros ·
                  LTV {formatCurrency(data.sub_ltv?.total_pagado ?? 0)}
                </p>
              </div>
              {(data.sub_ltv?.cant_pendientes ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                  <Clock size={11} /> {data.sub_ltv!.cant_pendientes} pendiente{data.sub_ltv!.cant_pendientes > 1 ? "s" : ""} · {formatCurrency(data.sub_ltv!.monto_pendiente)}
                </span>
              )}
            </div>
            <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">ID</th>
                    <th className="text-left px-2 py-2">Estado</th>
                    <th className="text-left px-2 py-2">Fecha</th>
                    <th className="text-left px-2 py-2">Plan</th>
                    <th className="text-right px-2 py-2">Pagado</th>
                    <th className="text-right px-2 py-2">Esperado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscription_intents.map((si) => {
                    const st = si.status.toUpperCase();
                    return (
                      <tr key={si.id} className="border-t border-border hover:bg-soft/40">
                        <td className="px-3 py-1.5 font-mono text-text-muted">{si.id}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${
                            st === "PROCESSED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : st === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-zinc-50 text-zinc-600 border-zinc-200"
                          }`}>{si.status}</span>
                        </td>
                        <td className="px-2 py-1.5 text-text-muted">{fmtArDateTime(si.fecha)}</td>
                        <td className="px-2 py-1.5 text-text-muted">{si.plan || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-700">
                          {si.pagado > 0 ? formatCurrency(si.pagado) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                          {si.esperado > 0 ? formatCurrency(si.esperado) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top clientes FINALES (compradores TN + ML del dropshipper) — drill al End Consumer 360 (solo TN) */}
        {data.top_clientes_finales && data.top_clientes_finales.length > 0 && (
          <div className="mb-5">
            <CategoryTable
              caption="Top clientes finales del dropshipper"
              subtitle="Compradores TN y ML combinados · click en TN abre el journey del cliente"
              data={data.top_clientes_finales}
              formatter="currency"
              extraColumns={[
                { key: "canal", label: "Canal", format: "raw" },
                { key: "ordenes", label: "Órd", format: "number" },
                { key: "provincia", label: "Provincia", format: "raw" },
                { key: "dni", label: "DNI", format: "raw" },
              ]}
            />
          </div>
        )}

        {/* Mensual GMV MELI + TN */}
        {data.monthly.length > 0 && (() => {
          const hasTn = data.monthly.some((m) => (m.gmv_tn ?? 0) > 0);
          const maxCombined = Math.max(1, ...data.monthly.map((m) => m.gmv + (m.gmv_tn ?? 0)));
          const totalMeli = data.monthly.reduce((s, m) => s + m.gmv, 0);
          const totalTn = data.monthly.reduce((s, m) => s + (m.gmv_tn ?? 0), 0);
          return (
            <div className="bg-surface border border-border rounded-xl p-4 sm:p-5 mb-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-text">Evolución mensual · últimos 12 meses</h3>
                  <p className="text-[11px] text-text-muted">GMV {hasTn ? "MELI + TN" : "MELI"} y profit Unidrop por mes</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  {totalMeli > 0 && (
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gradient-to-r from-primary to-accent inline-block" /> ML {formatCurrency(totalMeli)}</span>
                  )}
                  {hasTn && (
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-400 inline-block" /> TN {formatCurrency(totalTn)}</span>
                  )}
                  <span className="font-semibold text-text">Total: {formatCurrency(totalMeli + totalTn)}</span>
                </div>
              </div>
              <div className="space-y-2">
                {data.monthly.map((m) => {
                  const gmvTn = m.gmv_tn ?? 0;
                  const total = m.gmv + gmvTn;
                  const pctMeli = maxCombined > 0 ? (m.gmv / maxCombined) * 100 : 0;
                  const pctTn = maxCombined > 0 ? (gmvTn / maxCombined) * 100 : 0;
                  return (
                    <div key={m.mes} className="flex items-center gap-3">
                      <div className="w-16 text-xs text-text-muted font-mono">{m.mes}</div>
                      <div className="flex-1 h-6 bg-soft rounded relative overflow-hidden flex">
                        <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pctMeli}%` }} />
                        {hasTn && <div className="h-full bg-cyan-400/80" style={{ width: `${pctTn}%` }} />}
                      </div>
                      <div className="text-right tabular-nums w-36">
                        <div className="text-xs font-bold text-text">{formatCurrency(total)}</div>
                        <div className="text-[10px] text-text-muted">
                          {hasTn
                            ? `ML ${formatCurrency(m.gmv)} · TN ${formatCurrency(gmvTn)}`
                            : `${m.ordenes} órd · profit ${formatCurrency(m.profit)}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Referidos por este dropshipper */}
        {data.referidos_list && data.referidos_list.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text">Usuarios referidos ({data.referidos_list.length})</h3>
              <p className="text-[11px] text-text-muted">Dropshippers que se registraron usando el código de este usuario</p>
            </div>
            <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Nombre</th>
                    <th className="text-left px-2 py-2">Email</th>
                    <th className="text-left px-2 py-2">Plan</th>
                    <th className="text-left px-2 py-2">Estado sub</th>
                    <th className="text-left px-2 py-2">Alta</th>
                    <th className="text-right px-2 py-2">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {data.referidos_list.map((r) => {
                    const subOk = r.sub_status?.toLowerCase() === "active" || (r.dias_al_vencimiento ?? -1) > 0;
                    return (
                      <tr key={r.user_id} className="border-t border-border hover:bg-soft/40">
                        <td className="px-3 py-1.5 font-semibold">{r.nombre || "—"}</td>
                        <td className="px-2 py-1.5 text-text-muted">{r.email || "—"}</td>
                        <td className="px-2 py-1.5">{r.plan || <span className="text-text-muted italic">sin plan</span>}</td>
                        <td className="px-2 py-1.5">
                          {r.sub_status ? (
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${subOk ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>
                              {subOk ? `activa${r.dias_al_vencimiento !== null ? ` · ${r.dias_al_vencimiento}d` : ""}` : r.sub_status}
                            </span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-text-muted">{r.creado_en?.slice(0, 10)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {r.user_id && (
                            <Link href={`/dashboard/dropshipper/${r.user_id}`} className="inline-flex items-center gap-1 text-primary hover:underline text-[10px] font-semibold">
                              360 <ExternalLink size={9} />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Banner de filtro activo */}
        {selectedIntent != null && (
          <div className="mb-3 flex items-center gap-3 px-4 py-2 rounded-lg bg-amber-50 border border-amber-300 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-amber-900">
              Filtrando por PaymentIntent <span className="font-mono">#{selectedIntent}</span>
            </span>
            <span className="text-amber-800">
              {filteredQuery.isLoading
                ? "cargando..."
                : `${unifiedOrders.length} ${unifiedOrders.length === 1 ? "orden" : "órdenes"} en este pago`}
            </span>
            <button
              onClick={() => { setSelectedIntent(null); setOrdersPage(1); }}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-400 bg-white hover:bg-amber-100 font-bold text-amber-900"
            >
              <X size={11} /> limpiar filtro
            </button>
          </div>
        )}

        {/* Modal de detalle de orden */}
        {modalOrder && (() => {
          const sumPrice = (modalOrder.items ?? []).reduce((s, i) => s + i.price * i.qty, 0);
          const sumCost = (modalOrder.items ?? []).reduce((s, i) => s + (i.cost ?? 0) * i.qty, 0);
          const sumProfit = sumPrice - sumCost;
          const merchCost = modalOrder.merch_cost > 0 ? modalOrder.merch_cost : sumCost;
          // Total Unidrop: prefer invoice.total (lo facturado a Unidrop = cobro mercaderia + envio si aplica)
          // Si no hay factura, fallback al cálculo (merch + envío).
          const totalPagar = modalOrder.invoice?.total && modalOrder.invoice.total > 0
            ? modalOrder.invoice.total
            : merchCost + modalOrder.shipping_cost;
          // Net revenue = Ingreso (cobro al cliente) − Total facturado a Unidrop
          const profit = modalOrder.total - totalPagar;
          const fullAddress = [
            modalOrder.shipping_address || modalOrder.billing_address,
            modalOrder.shipping_city || modalOrder.billing_city,
            modalOrder.billing_province,
            modalOrder.shipping_zipcode || modalOrder.billing_zipcode,
          ].filter(Boolean).join(" · ");
          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOrder(null)}>
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-4 border-b border-border flex items-start gap-3 sticky top-0 bg-surface z-10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ChannelBadge origen={modalOrder.origen} />
                    <span className="text-lg font-bold text-text font-mono">{modalOrder.number || modalOrder.external_id || `ID ${modalOrder.internal_id ?? '?'}`}</span>
                    <OrderStatusBadge status={modalOrder.payment_status || modalOrder.status} />
                    {modalOrder.shipping_status && <OrderStatusBadge status={modalOrder.shipping_status} />}
                    {modalOrder.is_combo && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">COMBO</span>}
                    {modalOrder.shipping_type && <ShippingTypeBadge type={modalOrder.shipping_type} />}
                    {modalOrder.cancel_by_unidrop && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">CANCELADA UNIDROP</span>}
                  </div>
                  <div className="text-xs text-text-muted mt-1">{fmtArDateTime(modalOrder.fecha)}</div>
                  {modalOrder.tags && modalOrder.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-2">
                      {modalOrder.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-soft text-text-muted border border-border">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  {modalOrder.invoice?.link && (
                    <a href={modalOrder.invoice.link}
                       target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100"
                       title={`Factura ${modalOrder.invoice.tipo} ${modalOrder.invoice.numero}`}>
                      <FileText size={11} /> Ver Factura
                    </a>
                  )}
                  {modalOrder.has_label && (
                    <button
                      onClick={async () => {
                        const path = modalOrder.origen === "ml"
                          ? `/api/dashboards/orders/ml/${encodeURIComponent(modalOrder.external_id)}/label`
                          : `/api/dashboards/orders/tn/${encodeURIComponent(String(modalOrder.internal_id ?? ''))}/label`;
                        const token = typeof window !== "undefined" ? window.localStorage.getItem("unidata.token") : null;
                        const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://api.unidatacenter.com.ar";
                        try {
                          const res = await fetch(`${apiBase}${path}`, {
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                          });
                          if (!res.ok) {
                            alert(`No se pudo descargar la etiqueta (${res.status})`);
                            return;
                          }
                          const blob = await res.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${modalOrder.number || modalOrder.external_id}-etiqueta.pdf`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          window.URL.revokeObjectURL(url);
                        } catch (e) {
                          alert("Error descargando etiqueta: " + (e instanceof Error ? e.message : String(e)));
                        }
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100">
                      <Download size={11} /> Etiqueta
                    </button>
                  )}
                  {(modalOrder.number || modalOrder.external_id) && (
                    <a href={`https://www.unidrop.com.ar/panel/unified-orders?page=1&search=${encodeURIComponent(modalOrder.number || modalOrder.external_id || '')}`}
                       target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5">
                      <ExternalLink size={11} /> Unidrop
                    </a>
                  )}
                  <button onClick={() => setModalOrder(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-soft text-text-muted hover:text-text">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">

                {/* Productos — tabla con costo/precio/ganancia */}
                {(modalOrder.items?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Package size={12} /> Productos · {modalOrder.items!.length} {modalOrder.items!.length === 1 ? "línea" : "líneas"}
                    </div>
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                          <tr>
                            <th className="text-left px-3 py-2">Producto</th>
                            <th className="text-center px-2 py-2 w-12">Uds</th>
                            <th className="text-right px-2 py-2 w-24">Costo Ud.</th>
                            <th className="text-right px-2 py-2 w-24">Precio Ud.</th>
                            <th className="text-right px-2 py-2 w-24">Ganancia Ud.</th>
                            <th className="text-right px-2 py-2 w-24">Costo Total</th>
                            <th className="text-right px-2 py-2 w-24">Precio Total</th>
                            <th className="text-right px-3 py-2 w-24">Ganancia Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modalOrder.items!.map((item, ii) => {
                            const isCombo = item.item_type?.toUpperCase() === "COMBO";
                            const ganUd = item.price - (item.cost ?? 0);
                            const costTot = (item.cost ?? 0) * item.qty;
                            const priceTot = item.price * item.qty;
                            const ganTot = priceTot - costTot;
                            return (
                              <tr key={ii} className="border-t border-border align-top">
                                <td className="px-3 py-2">
                                  <div className="flex items-start gap-2">
                                    {item.image_url ? (
                                      <img src={item.image_url} alt={item.sku} className="w-8 h-8 rounded-md object-cover border border-border flex-shrink-0" loading="lazy" />
                                    ) : (
                                      <div className="w-8 h-8 rounded-md bg-soft border border-border flex items-center justify-center flex-shrink-0">
                                        <Package size={12} className="text-text-muted" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-semibold text-text truncate">{item.name || "—"}</span>
                                        {isCombo && <span className="px-1 py-0 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">C</span>}
                                      </div>
                                      {item.sku ? (
                                        <Link href={`/dashboard/productos/${encodeURIComponent(item.sku)}`}
                                              className="text-[10px] text-primary font-mono hover:underline inline-flex items-center gap-0.5"
                                              title={`Abrir Producto 360 de ${item.sku}`}>
                                          SKU {item.sku} <ExternalLink size={8} />
                                        </Link>
                                      ) : <div className="text-[10px] text-text-muted font-mono">SKU —</div>}
                                    </div>
                                  </div>
                                </td>
                                <td className="text-center px-2 py-2 tabular-nums">{item.qty}</td>
                                <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(item.cost) : "—"}</td>
                                <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(item.price)}</td>
                                <td className="text-right px-2 py-2 tabular-nums text-primary font-semibold">{item.cost ? formatCurrency(ganUd) : "—"}</td>
                                <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(costTot) : "—"}</td>
                                <td className="text-right px-2 py-2 tabular-nums font-semibold">{formatCurrency(priceTot)}</td>
                                <td className="text-right px-3 py-2 tabular-nums text-primary font-bold">{item.cost ? formatCurrency(ganTot) : "—"}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-border bg-soft/50 font-bold">
                            <td className="px-3 py-2 text-text-muted text-[10px] uppercase tracking-wider" colSpan={5}>Totales</td>
                            <td className="text-right px-2 py-2 tabular-nums">{sumCost > 0 ? formatCurrency(sumCost) : "—"}</td>
                            <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(sumPrice)}</td>
                            <td className="text-right px-3 py-2 tabular-nums text-primary">{sumCost > 0 ? formatCurrency(sumProfit) : "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Grid: pago + envío + cliente + pipeline */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Pago — breakdown completo */}
                  <div>
                    <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <DollarSign size={12} /> Pago
                    </div>
                    <div className="bg-soft rounded-lg p-3 space-y-1.5 text-xs">
                      {modalOrder.subtotal && modalOrder.subtotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Subtotal productos</span>
                          <span className="tabular-nums">{formatCurrency(modalOrder.subtotal)}</span>
                        </div>
                      )}
                      {modalOrder.discount && modalOrder.discount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Descuento</span>
                          <span className="tabular-nums text-rose-600">−{formatCurrency(modalOrder.discount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-text-muted">Costo mercadería</span>
                        <span className="tabular-nums">{merchCost > 0 ? formatCurrency(merchCost) : "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">Costo envío</span>
                        <span className="tabular-nums">{modalOrder.shipping_cost > 0 ? formatCurrency(modalOrder.shipping_cost) : "—"}</span>
                      </div>
                      {modalOrder.total_cost && modalOrder.total_cost > 0 && (
                        <div className="flex justify-between font-semibold">
                          <span className="text-text-muted">Costo total</span>
                          <span className="tabular-nums">{formatCurrency(modalOrder.total_cost)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-1.5 mt-1.5 font-bold">
                        <span>Total a pagar (Unidrop)</span>
                        <span className="tabular-nums text-primary">{formatCurrency(totalPagar)}</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                        <span className="text-text-muted">Ingreso total ({modalOrder.origen === "ml" ? "ML" : "TN"})</span>
                        <span className="tabular-nums font-semibold">{formatCurrency(modalOrder.total)}</span>
                      </div>
                      {profit > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Net revenue dropshipper</span>
                          <span className="tabular-nums font-bold text-emerald-600">{formatCurrency(profit)}</span>
                        </div>
                      )}
                    </div>
                    {/* Gateway TN */}
                    {(modalOrder.gateway_name || modalOrder.gateway) && (
                      <div className="mt-2 px-3 py-2 bg-soft/60 border border-border rounded-lg text-[11px]">
                        <span className="text-text-muted">Gateway: </span>
                        <span className="font-semibold text-text">{modalOrder.gateway_name || modalOrder.gateway}</span>
                        {modalOrder.gateway_link && (
                          <a href={modalOrder.gateway_link} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline inline-flex items-center gap-1"><ExternalLink size={9} />Ver pago</a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Envío */}
                  <div>
                    <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Truck size={12} /> Envío {modalOrder.shipping_carrier ? `· ${modalOrder.shipping_carrier}` : (modalOrder.shipment ? `· ${carrierLabel(modalOrder.shipment.carrier)}` : "")}
                    </div>
                    <div className="bg-soft rounded-lg p-3 space-y-1.5 text-xs">
                      {modalOrder.shipping_type && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Tipo</span>
                          <ShippingTypeBadge type={modalOrder.shipping_type} />
                        </div>
                      )}
                      {modalOrder.shipment?.status && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Estado</span>
                          <span className="font-semibold">{modalOrder.shipment.status}</span>
                        </div>
                      )}
                      {modalOrder.shipment?.entregado && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Entregado</span>
                          <span className="text-emerald-700 font-semibold">{modalOrder.shipment.entregado.slice(0, 10)}</span>
                        </div>
                      )}
                      {modalOrder.shipment?.tracking_number && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Tracking #</span>
                          <span className="font-mono text-[11px]">{modalOrder.shipment.tracking_number}</span>
                        </div>
                      )}
                      {modalOrder.shipment?.tracking_url && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Tracking</span>
                          <a href={modalOrder.shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1"><ExternalLink size={9} />Seguir envío</a>
                        </div>
                      )}
                      {fullAddress && (
                        <div className="pt-1.5 border-t border-border mt-1.5">
                          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Dirección de entrega</div>
                          <div className="text-text">{fullAddress}</div>
                          {modalOrder.shipping_floor && (
                            <div className="text-text-muted text-[10px]">Piso/Depto: {modalOrder.shipping_floor}</div>
                          )}
                          {modalOrder.shipping_comment && modalOrder.shipping_comment !== "." && (
                            <div className="text-text-muted text-[10px] italic mt-1">📝 {modalOrder.shipping_comment}</div>
                          )}
                          {(modalOrder.shipping_receiver || modalOrder.shipment?.receiver_name) && (
                            <div className="text-text-muted text-[10px] mt-1">Recibe: <span className="text-text font-semibold">{modalOrder.shipping_receiver || modalOrder.shipment?.receiver_name}</span></div>
                          )}
                          {(modalOrder.shipping_phone || modalOrder.shipment?.receiver_phone) && (
                            <div className="text-text-muted text-[10px]">📞 {modalOrder.shipping_phone || modalOrder.shipment?.receiver_phone}</div>
                          )}
                        </div>
                      )}
                      {!fullAddress && !modalOrder.shipment && (
                        <div className="text-text-muted italic">Sin info de envío registrada</div>
                      )}
                    </div>
                  </div>

                  {/* Datos del cliente */}
                  <div>
                    <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Datos del cliente</div>
                    <div className="bg-soft rounded-lg p-3 space-y-2 text-xs">
                      {modalOrder.buyer_name ? (
                        <div className="text-sm font-bold text-text">{modalOrder.buyer_name}</div>
                      ) : <div className="text-text-muted italic">Sin nombre registrado</div>}
                      {modalOrder.contact_email && (
                        <div className="flex items-center gap-1.5 text-text-muted"><Mail size={11} /> {modalOrder.contact_email}</div>
                      )}
                      {modalOrder.contact_phone && (
                        <div className="flex items-center gap-1.5 text-text-muted"><Phone size={11} /> {modalOrder.contact_phone}</div>
                      )}
                      {modalOrder.contact_dni && (
                        <div className="flex items-center gap-1.5 text-text-muted"><IdCard size={11} /> DNI/CUIT {modalOrder.contact_dni}</div>
                      )}
                      {modalOrder.buyer_id && modalOrder.origen === "ml" && (
                        <div className="flex items-center gap-1.5 text-text-muted"><IdCard size={11} /> ML buyer #{modalOrder.buyer_id}</div>
                      )}
                      {modalOrder.billing_address && modalOrder.shipping_address && modalOrder.billing_address !== modalOrder.shipping_address && (
                        <div className="pt-1.5 border-t border-border mt-1.5">
                          <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Dirección de facturación</div>
                          <div>{[modalOrder.billing_address, modalOrder.billing_city, modalOrder.billing_province, modalOrder.billing_zipcode].filter(Boolean).join(" · ")}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pipeline + Operativa */}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Estado del pedido</div>
                      <OrderPipelineDetail o={modalOrder} />
                    </div>
                    {/* Operativa: etiquetas + notificaciones + manual marks */}
                    {(modalOrder.label_downloaded || modalOrder.notification_pack || modalOrder.notification_ship || modalOrder.manual_packed_at || modalOrder.manual_payment_at) && (
                      <div className="bg-soft/60 border border-border rounded-lg p-3 text-[11px] space-y-1">
                        <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Operativa</div>
                        {modalOrder.label_downloaded && (
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Etiqueta descargada</span>
                            <span className="text-emerald-700 font-semibold">{modalOrder.label_downloaded_at ? fmtArDateTime(modalOrder.label_downloaded_at) : "Sí"}</span>
                          </div>
                        )}
                        {modalOrder.notification_pack && (
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Notif. empaquetado</span>
                            <span className="text-emerald-700 font-semibold">Enviada</span>
                          </div>
                        )}
                        {modalOrder.notification_ship && (
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Notif. envío</span>
                            <span className="text-emerald-700 font-semibold">Enviada</span>
                          </div>
                        )}
                        {modalOrder.manual_packed_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Marcada empaquetada</span>
                            <span className="text-text-muted">{fmtArDateTime(modalOrder.manual_packed_at)}</span>
                          </div>
                        )}
                        {modalOrder.manual_payment_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Marcada pagada</span>
                            <span className="text-text-muted">{fmtArDateTime(modalOrder.manual_payment_at)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Timestamps TN */}
                {(modalOrder.paid_at || modalOrder.completed_at || modalOrder.cancelled_at || modalOrder.closed_at) && (
                  <div className="bg-soft/40 border border-border rounded-lg p-3 text-[11px] grid grid-cols-2 md:grid-cols-4 gap-y-1.5 gap-x-4">
                    {modalOrder.paid_at && (
                      <div><span className="text-text-muted">Pagada:</span> <span className="font-semibold text-emerald-700">{fmtArDateTime(modalOrder.paid_at)}</span></div>
                    )}
                    {modalOrder.completed_at && (
                      <div><span className="text-text-muted">Completada:</span> <span className="font-semibold">{fmtArDateTime(modalOrder.completed_at)}</span></div>
                    )}
                    {modalOrder.closed_at && (
                      <div><span className="text-text-muted">Cerrada:</span> <span className="font-semibold">{fmtArDateTime(modalOrder.closed_at)}</span></div>
                    )}
                    {modalOrder.cancelled_at && (
                      <div><span className="text-text-muted">Cancelada:</span> <span className="font-semibold text-rose-600">{fmtArDateTime(modalOrder.cancelled_at)}</span></div>
                    )}
                  </div>
                )}

                {/* Notas TN */}
                {(modalOrder.note || modalOrder.owner_note) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {modalOrder.note && (
                      <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-3 text-xs">
                        <div className="text-amber-800 text-[10px] uppercase tracking-wider mb-1 font-bold">Nota del cliente</div>
                        <div className="text-text">{modalOrder.note}</div>
                      </div>
                    )}
                    {modalOrder.owner_note && (
                      <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-3 text-xs">
                        <div className="text-blue-800 text-[10px] uppercase tracking-wider mb-1 font-bold">Nota del dropshipper</div>
                        <div className="text-text">{modalOrder.owner_note}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Factura Contabilium */}
                {modalOrder.invoice && (
                  <div className="bg-emerald-50/40 border border-emerald-200 rounded-lg p-3">
                    <div className="text-emerald-900 text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                      <FileText size={12} /> Factura emitida (Contabilium)
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-1.5 gap-x-4 text-xs">
                      <div>
                        <div className="text-text-muted text-[10px]">Tipo</div>
                        <div className="font-bold">{modalOrder.invoice.tipo}</div>
                      </div>
                      <div>
                        <div className="text-text-muted text-[10px]">Número</div>
                        <div className="font-mono font-bold">{modalOrder.invoice.numero}</div>
                      </div>
                      <div>
                        <div className="text-text-muted text-[10px]">Fecha emisión</div>
                        <div>{modalOrder.invoice.fecha ? fmtArDateTime(modalOrder.invoice.fecha) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-text-muted text-[10px]">Total facturado</div>
                        <div className="tabular-nums font-bold">{formatCurrency(modalOrder.invoice.total)}</div>
                      </div>
                      {modalOrder.invoice.cae && (
                        <div className="col-span-2">
                          <div className="text-text-muted text-[10px]">CAE</div>
                          <div className="font-mono text-[11px]">{modalOrder.invoice.cae}</div>
                        </div>
                      )}
                      {modalOrder.invoice.link && (
                        <div className="col-span-2 md:col-span-4">
                          <a href={modalOrder.invoice.link} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-1 text-primary hover:underline font-semibold text-xs">
                            <ExternalLink size={11} /> Abrir factura en Contabilium
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Devoluciones ML */}
                {modalOrder.returns && modalOrder.returns.length > 0 && (
                  <div className="bg-rose-50/40 border border-rose-200 rounded-lg p-3">
                    <div className="text-rose-900 text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                      <RotateCcw size={12} /> Devoluciones MELI · {modalOrder.returns.length}
                    </div>
                    <div className="space-y-3">
                      {modalOrder.returns.map((ret, ri) => (
                        <div key={ri} className="bg-surface border border-rose-200/50 rounded-md p-2.5 text-xs">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-3">
                            <div>
                              <div className="text-text-muted text-[10px]">Estado</div>
                              <span className="inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold bg-rose-50 text-rose-700 border-rose-200">{ret.status || "—"}</span>
                            </div>
                            {ret.reason && (
                              <div className="col-span-2 md:col-span-3">
                                <div className="text-text-muted text-[10px]">Motivo</div>
                                <div className="text-text">{ret.reason}</div>
                              </div>
                            )}
                            {ret.amount_to_refund > 0 && (
                              <div>
                                <div className="text-text-muted text-[10px]">Monto a reintegrar</div>
                                <div className="tabular-nums font-bold text-rose-700">{formatCurrency(ret.amount_to_refund)}</div>
                              </div>
                            )}
                            {ret.tracking_code && (
                              <div>
                                <div className="text-text-muted text-[10px]">Tracking devolución</div>
                                <div className="font-mono text-[11px]">{ret.tracking_code}</div>
                              </div>
                            )}
                            {ret.carrier && (
                              <div>
                                <div className="text-text-muted text-[10px]">Carrier</div>
                                <div>{ret.carrier}</div>
                              </div>
                            )}
                            {ret.created_at && (
                              <div>
                                <div className="text-text-muted text-[10px]">Iniciada</div>
                                <div className="text-text-muted">{fmtArDateTime(ret.created_at)}</div>
                              </div>
                            )}
                            {ret.received_at && (
                              <div>
                                <div className="text-text-muted text-[10px]">Recibida</div>
                                <div className="text-emerald-700 font-semibold">{fmtArDateTime(ret.received_at)}</div>
                              </div>
                            )}
                            {ret.discrepancy_type && (
                              <div className="col-span-2">
                                <div className="text-text-muted text-[10px]">Discrepancia</div>
                                <div>{ret.discrepancy_type}{ret.discrepancy_note ? ` — ${ret.discrepancy_note}` : ""}</div>
                              </div>
                            )}
                            {ret.discrepancy_photo && (
                              <div className="col-span-2 md:col-span-4">
                                <a href={ret.discrepancy_photo} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                  <ExternalLink size={9} /> Ver foto de discrepancia
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* IDs técnicos */}
                <div className="bg-soft/50 border border-border rounded-lg p-3 text-[10px] text-text-muted grid grid-cols-2 md:grid-cols-4 gap-y-1 gap-x-4">
                  {modalOrder.number && <div>Número DROP: <span className="font-mono font-bold text-text">{modalOrder.number}</span></div>}
                  {modalOrder.external_id && <div>ID externo: <span className="font-mono text-text">{modalOrder.external_id}</span></div>}
                  {modalOrder.internal_id && <div>ID interno: <span className="font-mono text-text">{modalOrder.internal_id}</span></div>}
                  {modalOrder.intent_id && <div>PaymentIntent: <span className="font-mono text-text">#{modalOrder.intent_id}</span></div>}
                  {modalOrder.returns_count && modalOrder.returns_count > 0 && (
                    <div className="text-rose-600 font-semibold flex items-center gap-1 col-span-2"><RotateCcw size={9} /> {modalOrder.returns_count} devolución{modalOrder.returns_count !== 1 ? "es" : ""}</div>
                  )}
                </div>
              </div>
              <div className="px-6 py-3 border-t border-border text-[10px] text-text-muted">
                Click fuera del modal o en ✕ para cerrar
              </div>
            </div>
          </div>
          );
        })()}

        {/* Analítica de productos del dropshipper — Combo vs Individual + Top SKUs */}
        {data.combo_analytics && (data.combo_analytics.combo_count + data.combo_analytics.individual_count) > 0 && (
          <div className="bg-surface border border-border rounded-xl p-4 mb-4">
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-text">Analítica de productos del dropshipper</h3>
                <p className="text-[11px] text-text-muted">
                  Distribución combo vs individual + SKUs más vendidos sobre las últimas {data.combo_analytics.combo_count + data.combo_analytics.individual_count} órdenes
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Combo vs Individual */}
              <div className="bg-soft/40 border border-border rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-3">Combo vs Individual</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text font-semibold">Combo</span>
                      <span className="tabular-nums">{data.combo_analytics.combo_count} órd · {formatCurrency(data.combo_analytics.combo_revenue)}</span>
                    </div>
                    <div className="h-2 bg-soft rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${data.combo_analytics.combo_pct}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text font-semibold">Individual</span>
                      <span className="tabular-nums">{data.combo_analytics.individual_count} órd · {formatCurrency(data.combo_analytics.individual_revenue)}</span>
                    </div>
                    <div className="h-2 bg-soft rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400" style={{ width: `${100 - data.combo_analytics.combo_pct}%` }} />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-border/50 text-[11px] text-text-muted">
                    {data.combo_analytics.combo_pct >= 50 ? (
                      <>Vende <strong className="text-primary">más en combo</strong> ({data.combo_analytics.combo_pct.toFixed(0)}%)</>
                    ) : (
                      <>Vende <strong className="text-emerald-600">más individual</strong> ({(100 - data.combo_analytics.combo_pct).toFixed(0)}%)</>
                    )}
                  </div>
                </div>
              </div>
              {/* Top SKUs */}
              <div className="bg-soft/40 border border-border rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Top SKUs vendidos</div>
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                  {data.combo_analytics.top_skus.slice(0, 10).map((s) => (
                    <Link key={s.sku} href={`/dashboard/productos/${encodeURIComponent(s.sku)}`}
                          className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-soft transition group">
                      {s.image_url ? (
                        <img src={s.image_url} alt={s.sku} className="w-8 h-8 rounded object-cover border border-border flex-shrink-0" loading="lazy" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-soft border border-border flex items-center justify-center flex-shrink-0">
                          <Package size={12} className="text-text-muted" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-text truncate group-hover:text-primary">{s.name || s.sku}</div>
                        <div className="text-[10px] text-text-muted font-mono">{s.sku} · {s.in_combos > 0 && <span className="text-primary">combo×{s.in_combos}</span>}{s.in_combos > 0 && s.in_individual > 0 && " · "}{s.in_individual > 0 && <span className="text-emerald-600">ind×{s.in_individual}</span>}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-bold tabular-nums">{s.qty}</div>
                        <div className="text-[9px] text-text-muted tabular-nums">{formatCurrency(s.revenue)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
          {/* Vista unificada estilo Unidrop panel */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-text">Ventas dropshipper (vista unificada)</h3>
                <p className="text-[11px] text-text-muted">
                  {unifiedOrders.length} órdenes {channelFilter === "all" ? "ML + TN" : channelFilter.toUpperCase()} · click en número para abrir en panel Unidrop
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedIntent != null && filteredQuery.isFetching && (
                  <span className="text-[10px] text-text-muted italic">actualizando...</span>
                )}
                <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">
                  <button onClick={() => { setChannelFilter("all"); setOrdersPage(1); }}
                    className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (channelFilter === "all" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                    Todas ({countMl + countTn})
                  </button>
                  <button onClick={() => { setChannelFilter("ml"); setOrdersPage(1); }}
                    className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (channelFilter === "ml" ? "bg-yellow-100 text-yellow-900 shadow" : "text-text-muted hover:text-text")}>
                    <span className="inline-flex items-center gap-1"><MeliBadgeInline /> ({countMl})</span>
                  </button>
                  <button onClick={() => { setChannelFilter("tn"); setOrdersPage(1); }}
                    className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (channelFilter === "tn" ? "bg-[#23A0DF]/10 text-[#1580B8] shadow" : "text-text-muted hover:text-text")}>
                    <span className="inline-flex items-center gap-1"><TnBadgeInline /> ({countTn})</span>
                  </button>
                </div>
                {countCombo > 0 && (
                  <div className="inline-flex bg-soft rounded-lg p-0.5 border border-border">
                    <button onClick={() => { setComboFilter("all"); setOrdersPage(1); }}
                      className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (comboFilter === "all" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                      Tipo
                    </button>
                    <button onClick={() => { setComboFilter("combo"); setOrdersPage(1); }}
                      className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (comboFilter === "combo" ? "bg-primary/10 text-primary shadow" : "text-text-muted hover:text-text")}>
                      Combo ({countCombo})
                    </button>
                    <button onClick={() => { setComboFilter("individual"); setOrdersPage(1); }}
                      className={"px-2.5 py-1 text-[10px] font-bold rounded-md transition " + (comboFilter === "individual" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")}>
                      Ind ({countMl + countTn - countCombo})
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="w-7 px-1 py-2.5"></th>
                    <th className="text-left px-2 py-2.5"><SortHeader col="number" label="# Orden" sortBy={unifiedSorted.sortBy} sortDir={unifiedSorted.sortDir} onToggle={unifiedSorted.toggle} /></th>
                    <th className="text-left px-2 py-2.5"><SortHeader col="buyer_name" label="Cliente" sortBy={unifiedSorted.sortBy} sortDir={unifiedSorted.sortDir} onToggle={unifiedSorted.toggle} /></th>
                    <th className="text-left px-2 py-2.5"><SortHeader col="fecha" label="Fecha" sortBy={unifiedSorted.sortBy} sortDir={unifiedSorted.sortDir} onToggle={unifiedSorted.toggle} /></th>
                    <th className="text-left px-2 py-2.5">Estado del pedido</th>
                    <th className="text-left px-2 py-2.5">Método envío</th>
                    <th className="text-right px-2 py-2.5" title="Costo Unidrop = lo facturado en Contabilium (mercadería + envío)">Costo</th>
                    <th className="text-right px-2 py-2.5" title="Ingreso del dropshipper (lo que cobró al cliente final)"><SortHeader col="total" label="Ingreso" sortBy={unifiedSorted.sortBy} sortDir={unifiedSorted.sortDir} onToggle={unifiedSorted.toggle} /></th>
                    <th className="text-right px-2 py-2.5" title="Ganancia = Ingreso − Costo">Ganancia</th>
                    <th className="w-8 px-1 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {unifiedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center text-text-muted py-8">
                        {selectedIntent ? "Sin órdenes en este PaymentIntent" : "Sin ventas registradas"}
                      </td>
                    </tr>
                  ) : (
                    paginatedOrders.map((o, idx) => {
                      const rowKey = `${o.origen}-${o.internal_id ?? o.external_id}-${idx}`;
                      const hasItems = (o.items?.length ?? 0) > 0;
                      const hasShip = !!o.shipment;
                      const hasReturns = (o.returns_count ?? 0) > 0;
                      const isExpandable = hasItems || hasShip || hasReturns;
                      const isExpanded = expandedOrders.has(rowKey);
                      // Método de envío: solo carriers válidos (filtramos cualquier status como EMPAQUETADO).
                      const metodoEnvio = methodEnvioDisplay(o);
                      // Costo Unidrop = lo facturado a Unidrop via Contabilium (mercaderia + envio).
                      // Es lo que importa para nuestras finanzas (alineado con Contabilium).
                      const costoUnidrop = o.invoice?.total && o.invoice.total > 0
                        ? o.invoice.total
                        : (o.merch_cost || 0) + (o.shipping_cost || 0);
                      // Ganancia dropshipper = ingreso (lo que cobró al cliente final) − costo Unidrop.
                      const ganancia = o.total - costoUnidrop;
                      return (
                        <>
                        <tr key={rowKey}
                            className={`border-t border-border cursor-pointer ${isExpanded ? "bg-primary/5" : "hover:bg-soft/40"}`}
                            onClick={() => toggleExpand(rowKey)}>
                          {/* Expand chevron */}
                          <td className="px-1 py-2 text-center text-text-muted">
                            {isExpandable
                              ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
                              : <span className="w-3 inline-block" />}
                          </td>
                          {/* Número + canal badge */}
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <ChannelBadge origen={o.origen} />
                              <button onClick={(e) => { e.stopPropagation(); setModalOrder(o); }}
                                className="font-mono font-semibold text-primary hover:underline text-xs leading-none">
                                {o.number || o.external_id || "—"}
                              </button>
                              {o.is_combo && <span className="px-1 py-0 rounded text-[8px] font-bold bg-primary/10 text-primary border border-primary/20 leading-tight">C</span>}
                            </div>
                          </td>
                          {/* Cliente */}
                          <td className="px-2 py-2 max-w-[150px]">
                            <div className="truncate font-medium" title={o.buyer_name}>{o.buyer_name || <span className="text-text-muted text-[10px]">—</span>}</div>
                            {(o.billing_city || o.billing_province) && (
                              <div className="text-[9px] text-text-muted truncate">{[o.billing_city, o.billing_province].filter(Boolean).join(", ")}</div>
                            )}
                          </td>
                          {/* Fecha */}
                          <td className="px-2 py-2 text-text-muted whitespace-nowrap">{fmtArDateTime(o.fecha)}</td>
                          {/* Pipeline de estado */}
                          <td className="px-2 py-2">
                            <OrderPipeline o={o} />
                          </td>
                          {/* Método envío */}
                          <td className="px-2 py-2">
                            {metodoEnvio ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold bg-blue-50 text-blue-700 border-blue-200">
                                <Truck size={8} />{metodoEnvio}
                              </span>
                            ) : <span className="text-text-muted text-[10px]">—</span>}
                          </td>
                          {/* Costo Unidrop (Contabilium) */}
                          <td className="px-2 py-2 text-right tabular-nums text-text"
                              title={o.invoice ? `Factura ${o.invoice.tipo} ${o.invoice.numero} — Contabilium` : "Sin factura registrada"}>
                            {costoUnidrop > 0 ? formatCurrency(costoUnidrop) : <span className="text-text-muted text-[10px] font-normal">—</span>}
                          </td>
                          {/* Ingreso (lo que cobró el dropshipper al cliente) */}
                          <td className="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(o.total)}</td>
                          {/* Ganancia = Ingreso − Costo */}
                          <td className={`px-2 py-2 text-right tabular-nums font-bold ${ganancia >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {costoUnidrop > 0 ? formatCurrency(ganancia) : <span className="text-text-muted text-[10px] font-normal">—</span>}
                          </td>
                          {/* Abrir modal */}
                          <td className="px-1 py-2 text-center">
                            <button onClick={(e) => { e.stopPropagation(); setModalOrder(o); }}
                              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-primary hover:bg-soft"
                              title="Ver detalle completo">
                              <ExternalLink size={11} />
                            </button>
                          </td>
                        </tr>
                        {/* Fila expandible — tabla completa de productos al estilo del modal */}
                        {isExpanded && (
                          <tr key={`${rowKey}-detail`} className="border-t border-border/40 bg-primary/3">
                            <td colSpan={10} className="px-4 py-3">
                              {hasItems && (() => {
                                const sumCost = o.items!.reduce((s, i) => s + (i.cost ?? 0) * i.qty, 0);
                                const sumPrice = o.items!.reduce((s, i) => s + i.price * i.qty, 0);
                                const sumGan = sumPrice - sumCost;
                                return (
                                  <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                      <Package size={11} /> Productos · {o.items!.length} {o.items!.length === 1 ? "línea" : "líneas"}
                                    </div>
                                    <div className="border border-border rounded-lg overflow-hidden bg-surface">
                                      <table className="w-full text-xs">
                                        <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                                          <tr>
                                            <th className="text-left px-3 py-2">Producto</th>
                                            <th className="text-center px-2 py-2 w-12">Uds</th>
                                            <th className="text-right px-2 py-2 w-24">Costo Ud.</th>
                                            <th className="text-right px-2 py-2 w-24">Precio Ud.</th>
                                            <th className="text-right px-2 py-2 w-24">Ganancia Ud.</th>
                                            <th className="text-right px-2 py-2 w-24">Costo Total</th>
                                            <th className="text-right px-2 py-2 w-24">Precio Total</th>
                                            <th className="text-right px-3 py-2 w-24">Ganancia Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {o.items!.map((item, ii) => {
                                            const isCombo = item.item_type?.toUpperCase() === "COMBO";
                                            const ganUd = item.price - (item.cost ?? 0);
                                            const costTot = (item.cost ?? 0) * item.qty;
                                            const priceTot = item.price * item.qty;
                                            const ganTot = priceTot - costTot;
                                            return (
                                              <tr key={ii} className="border-t border-border align-top">
                                                <td className="px-3 py-2">
                                                  <div className="flex items-start gap-2">
                                                    {item.image_url ? (
                                                      <img src={item.image_url} alt={item.sku} className="w-8 h-8 rounded-md object-cover border border-border flex-shrink-0" loading="lazy" />
                                                    ) : (
                                                      <div className="w-8 h-8 rounded-md bg-soft border border-border flex items-center justify-center flex-shrink-0">
                                                        <Package size={12} className="text-text-muted" />
                                                      </div>
                                                    )}
                                                    <div className="min-w-0">
                                                      <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-semibold text-text truncate">{item.name || "—"}</span>
                                                        {isCombo && <span className="px-1 py-0 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">C</span>}
                                                      </div>
                                                      {item.sku ? (
                                                        <Link href={`/dashboard/productos/${encodeURIComponent(item.sku)}`}
                                                              onClick={(e) => e.stopPropagation()}
                                                              className="text-[10px] text-primary font-mono hover:underline inline-flex items-center gap-0.5"
                                                              title={`Abrir Producto 360 de ${item.sku}`}>
                                                          SKU {item.sku} <ExternalLink size={8} />
                                                        </Link>
                                                      ) : <div className="text-[10px] text-text-muted font-mono">SKU —</div>}
                                                    </div>
                                                  </div>
                                                </td>
                                                <td className="text-center px-2 py-2 tabular-nums">{item.qty}</td>
                                                <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(item.cost) : "—"}</td>
                                                <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(item.price)}</td>
                                                <td className="text-right px-2 py-2 tabular-nums text-primary font-semibold">{item.cost ? formatCurrency(ganUd) : "—"}</td>
                                                <td className="text-right px-2 py-2 tabular-nums text-text-muted">{item.cost ? formatCurrency(costTot) : "—"}</td>
                                                <td className="text-right px-2 py-2 tabular-nums font-semibold">{formatCurrency(priceTot)}</td>
                                                <td className="text-right px-3 py-2 tabular-nums text-primary font-bold">{item.cost ? formatCurrency(ganTot) : "—"}</td>
                                              </tr>
                                            );
                                          })}
                                          <tr className="border-t-2 border-border bg-soft/50 font-bold">
                                            <td className="px-3 py-2 text-text-muted text-[10px] uppercase tracking-wider" colSpan={5}>Totales</td>
                                            <td className="text-right px-2 py-2 tabular-nums">{sumCost > 0 ? formatCurrency(sumCost) : "—"}</td>
                                            <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(sumPrice)}</td>
                                            <td className="text-right px-3 py-2 tabular-nums text-primary">{sumCost > 0 ? formatCurrency(sumGan) : "—"}</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                    {/* Bloque resumido de envío + devoluciones a la derecha */}
                                    {(hasShip || hasReturns) && (
                                      <div className="flex flex-wrap gap-3 mt-2.5 text-[11px]">
                                        {hasShip && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 bg-soft border border-border rounded">
                                            <Truck size={10} className="text-text-muted" />
                                            <span className="text-text-muted">{carrierLabel(o.shipment!.carrier)}:</span>
                                            <span className="font-semibold">{o.shipment!.status || "—"}</span>
                                            {o.shipment!.entregado && (
                                              <span className="text-emerald-700">· entregado {o.shipment!.entregado.slice(0, 10)}</span>
                                            )}
                                          </div>
                                        )}
                                        {hasReturns && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 border border-rose-200 rounded">
                                            <RotateCcw size={10} className="text-rose-600" />
                                            <span className="text-rose-700 font-semibold">{o.returns_count} devolución{o.returns_count !== 1 ? "es" : ""}</span>
                                          </div>
                                        )}
                                        <button onClick={(e) => { e.stopPropagation(); setModalOrder(o); }}
                                          className="ml-auto text-[11px] text-primary hover:underline inline-flex items-center gap-1 font-semibold">
                                          <ExternalLink size={10} /> Ver detalle completo
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {!hasItems && (
                                <div className="text-text-muted text-xs italic py-2">
                                  Sin productos detallados.
                                  {(hasShip || hasReturns) && (
                                    <button onClick={(e) => { e.stopPropagation(); setModalOrder(o); }}
                                            className="ml-2 text-primary hover:underline inline-flex items-center gap-1 font-semibold">
                                      <ExternalLink size={10} /> Ver detalle completo
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {ordersTotalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-muted">
                  Pág. {ordersPage} de {ordersTotalPages} · {unifiedOrders.length} órdenes total
                </span>
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                    disabled={ordersPage === 1}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed"
                  >← Ant</button>
                  {Array.from({ length: Math.min(ordersTotalPages, 7) }, (_, i) => {
                    const pg = ordersTotalPages <= 7 ? i + 1
                      : ordersPage <= 4 ? i + 1
                      : ordersPage >= ordersTotalPages - 3 ? ordersTotalPages - 6 + i
                      : ordersPage - 3 + i;
                    return (
                      <button key={pg} onClick={() => setOrdersPage(pg)}
                        className={"px-2.5 py-1 text-[11px] font-semibold rounded border transition " + (ordersPage === pg ? "bg-primary text-white border-primary" : "border-border hover:bg-soft")}>
                        {pg}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                    disabled={ordersPage === ordersTotalPages}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed"
                  >Sig →</button>
                </div>
              </div>
            )}
          </div>

          {/* Últimos pagos Talo (interactivo: click filtra la tabla izq) */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text">Últimos pagos a Unidrop (Talo Pay)</h3>
              <p className="text-[11px] text-text-muted">
                PaymentIntents · {pg.procesados} procesados / {pg.total_intents} totales · <strong>click en una fila</strong> para filtrar órdenes
              </p>
            </div>
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2"><SortHeader col="id" label="ID" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                    <th className="text-left px-2 py-2"><SortHeader col="status" label="Estado" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                    <th className="text-left px-2 py-2"><SortHeader col="fecha" label="Fecha" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                    <th className="text-right px-2 py-2"><SortHeader col="paid" label="Pagado" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                    <th className="text-right px-2 py-2"><SortHeader col="pending" label="Pendiente" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                    <th className="text-right px-2 py-2"><SortHeader col="ml_orders" label="Origen" sortBy={pagosSorted.sortBy} sortDir={pagosSorted.sortDir} onToggle={pagosSorted.toggle} /></th>
                  </tr>
                </thead>
                <tbody>
                  {pagosSorted.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-text-muted py-6">
                        Sin pagos registrados
                      </td>
                    </tr>
                  ) : (
                    pagosSorted.rows.map((p) => {
                      const isSelected = selectedIntent === p.id;
                      const canFilter = p.status?.toLowerCase() === "processed" && (p.ml_orders + p.tn_orders) > 0;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => { if (canFilter) { setSelectedIntent(isSelected ? null : p.id); setOrdersPage(1); } }}
                          className={
                            "border-t border-border transition " +
                            (canFilter ? "cursor-pointer " : "cursor-default opacity-60 ") +
                            (isSelected ? "bg-amber-100/60 hover:bg-amber-100" : "hover:bg-soft/40")
                          }
                          title={canFilter ? (isSelected ? "Click para limpiar filtro" : "Click para filtrar órdenes de este pago") : "Sin órdenes asociadas"}
                        >
                          <td className="px-3 py-1.5 font-mono text-text-muted">
                            {isSelected && <span className="text-amber-700 mr-1">▶</span>}
                            {p.id}
                          </td>
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
                      );
                    })
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

// ── Canal labels ──────────────────────────────────────────────────────────────

function carrierLabel(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("lightdata") || s.includes("flexi")) return "Unifast";
  if (s.includes("oca")) return "OCA";
  return raw;
}

function MeliBadgeInline() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-[#FFE600] text-[#333] border border-[#E8C800]">
      ML
    </span>
  );
}

function TnBadgeInline() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-[#23A0DF] text-white border border-[#1580B8]">
      TN
    </span>
  );
}

function ChannelBadge({ origen }: { origen: "ml" | "tn" }) {
  if (origen === "ml") return <MeliBadgeInline />;
  return <TnBadgeInline />;
}

// ── Status badge ───────────────────────────────────────────────────────────────

function OrderStatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls =
    s === "paid" || s === "processed" || s === "delivered" || s === "entregado"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "pending" || s === "open" || s === "shipped" || s === "en_camino"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : s === "cancelled" || s === "failed"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>
      {status}
    </span>
  );
}

function ShippingTypeBadge({ type }: { type: string }) {
  const t = (type || "").toLowerCase();
  // FLEXI (self_service) / PR (Punto de Retiro) / FULL (fulfillment)
  const cls =
    t.includes("flex") || t.includes("self") || t.includes("xd")
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : t.includes("full") || t.includes("fulfillment")
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : t.includes("pr") || t.includes("retiro") || t.includes("drop_off")
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-zinc-50 text-zinc-600 border-zinc-200";
  const label = t.includes("flex") || t.includes("self") ? "FLEXI"
    : t.includes("full") ? "FULL"
    : t.includes("retiro") || t.includes("drop_off") ? "PR"
    : type.toUpperCase().slice(0, 10);
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase font-bold ${cls}`}>
      {label}
    </span>
  );
}

// ── Estado pipeline (fila tabla) ───────────────────────────────────────────────

function pipelineStep(
  done: boolean,
  partial: boolean,
  icon: string,
): React.ReactNode {
  const cls = done
    ? "bg-emerald-500 text-white border-emerald-500"
    : partial
    ? "bg-amber-400 text-white border-amber-400"
    : "bg-zinc-100 text-zinc-400 border-zinc-300";
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border ${cls}`}>
      {icon}
    </div>
  );
}

// Etiqueta normalizada del método de envío. Reconoce FLEXI / ML FLEX / FULL /
// PR (Punto de Retiro) / OCA / Lightdata / Andreani / Siempre Logistica.
// Filtra valores que parezcan ESTADOS (empaquetado, pendiente, en_camino, etc.)
// porque eso va en el pipeline, no en la columna "Método envío".
function methodEnvioDisplay(o: UnifiedOrder): string {
  const candidatos = [
    o.shipping_carrier,
    o.shipping_type,
    o.shipping_option,
    o.shipment?.carrier,
  ].filter(Boolean) as string[];
  const STATUS_WORDS = ["empaquet", "pendient", "en_camino", "en camino", "entregad", "transit", "creada", "pagad", "fallid", "retira"];
  for (const raw of candidatos) {
    const v = String(raw).trim();
    if (!v) continue;
    const low = v.toLowerCase();
    // Skip si parece un status, no un método
    if (STATUS_WORDS.some((s) => low.includes(s))) continue;
    // Normalizar conocidos
    if (low.includes("punto") || low.includes("drop_off") || low === "pr") return "PR";
    if (low.includes("self") || low.includes("flexi") || low === "flex") return "FLEXI";
    if (low.includes("ml flex") || low.includes("ml_flex") || low.includes("xd_drop_off")) return "ML FLEX";
    if (low.includes("full") || low === "fulfillment") return "FULL";
    if (low.includes("oca")) return "OCA";
    if (low.includes("lightdata")) return "Lightdata";
    if (low.includes("andreani")) return "Andreani";
    if (low.includes("siempre") || low.includes("unifast")) return "UNIFAST";
    if (low.includes("retiro") && !low.includes("punto")) continue;  // 'En proceso de retiro' es status
    // Si nada match pero es un carrier "limpio" (sin guiones bajos sospechosos), devolverlo en mayusculas
    if (v.length <= 18 && !low.includes("_")) return v.toUpperCase();
  }
  return "";
}

function pipelineDateLabel(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  } catch {
    return null;
  }
}

function OrderPipeline({ o }: { o: UnifiedOrder }) {
  const ps = (o.payment_status || o.status || "").toLowerCase();
  const isPaid = ["paid", "processed", "approved"].some((v) => ps.includes(v));
  const isPacked = !!o.packed_at || !!o.label_downloaded;
  const isDelivered = !!o.delivered_at || !!o.shipment?.entregado || ["delivered", "entregado"].some((v) => (o.shipping_status || "").toLowerCase().includes(v));
  const isShipped = !!o.shipped_at || isDelivered || ["shipped", "transit", "en_camino"].some((v) => (o.shipping_status || "").toLowerCase().includes(v));

  const steps: { active: boolean; label: string; icon: string; iso?: string | null }[] = [
    { active: true, label: "Creada", icon: "📋", iso: o.fecha },
    { active: isPaid, label: "Pagada", icon: "💲", iso: o.paid_at },
    { active: isPacked, label: "Empaquetado", icon: "📦", iso: o.packed_at || o.label_downloaded_at },
    { active: isShipped, label: "En camino", icon: "🚚", iso: o.shipped_at },
    { active: isDelivered, label: "Entregada", icon: "✅", iso: o.delivered_at || o.shipment?.entregado },
  ];

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center">
          {i > 0 && <div className={`h-0.5 w-2 ${s.active && steps[i - 1].active ? "bg-emerald-400" : "bg-zinc-200"}`} />}
          <div
            title={s.iso ? `${s.label} · ${pipelineDateLabel(s.iso)}` : `${s.label} · sin fecha`}
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
              s.active
                ? "bg-emerald-500 text-white border-emerald-500"
                : "bg-zinc-100 text-zinc-400 border-zinc-200"
            }`}
          >
            {s.icon}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Estado pipeline (modal detalle) ───────────────────────────────────────────

function OrderPipelineDetail({ o }: { o: UnifiedOrder }) {
  const ps = (o.payment_status || o.status || "").toLowerCase();
  const ss = (o.shipping_status || "").toLowerCase();
  const isPaid = ["paid", "processed", "approved"].some((v) => ps.includes(v));
  const isPacked = !!o.packed_at || !!o.label_downloaded;
  const isDelivered = !!o.delivered_at || ["delivered", "entregado"].some((v) => ss.includes(v)) || !!o.shipment?.entregado;
  const isShipped = !!o.shipped_at || ["shipped", "transit", "en_camino"].some((v) => ss.includes(v)) || isDelivered;

  const stepDate = (iso?: string) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch {
      return null;
    }
  };

  const step = (done: boolean, label: string, icon: string, date?: string | null) => (
    <div className="flex flex-col items-center gap-1 min-w-[58px]">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
        done ? "bg-emerald-500 text-white border-emerald-500" : "bg-zinc-100 text-zinc-400 border-zinc-200"
      }`}>{icon}</div>
      <span className={`text-[10px] leading-none text-center ${done ? "text-emerald-700 font-semibold" : "text-zinc-400"}`}>{label}</span>
      {date && <span className="text-[9px] leading-none text-text-muted tabular-nums">{date}</span>}
    </div>
  );
  const line = (on: boolean) => (
    <div className={`flex-1 h-0.5 mb-6 ${on ? "bg-emerald-400" : "bg-zinc-200"}`} />
  );
  return (
    <div className="flex items-start gap-1.5">
      {step(true, "Creada", "📋", stepDate(o.fecha))}
      {line(isPaid)}
      {step(isPaid, "Pagada", "💲", stepDate(o.paid_at))}
      {line(isPacked)}
      {step(isPacked, "Empaquetado", "📦", stepDate(o.packed_at || o.label_downloaded_at))}
      {line(isShipped)}
      {step(isShipped, "En camino", "🚚", stepDate(o.shipped_at))}
      {line(isDelivered)}
      {step(isDelivered, "Entregada", "✅", stepDate(o.delivered_at || o.shipment?.entregado || undefined))}
    </div>
  );
}

// ── KpiBox ─────────────────────────────────────────────────────────────────────

function KpiBox({
  icon: Icon,
  label,
  value,
  accent,
  hint,
  mono = false,
}: {
  icon: any;
  label: string;
  value: string;
  accent: "primary" | "emerald" | "amber" | "rose";
  hint?: string;
  mono?: boolean;
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
      <div className={`text-xl font-extrabold text-text truncate ${mono ? "font-mono text-base" : "tabular-nums"}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}

type DropshipperNote = {
  id: number;
  dropshipper_id: number;
  author_id: number;
  author_email: string;
  note: string;
  category: "general" | "cs" | "billing" | "support" | "retention" | "flag" | "ops";
  archived: boolean;
  created_at: string;
};

const CATEGORY_CONFIG: Record<DropshipperNote["category"], { label: string; cls: string }> = {
  general: { label: "General", cls: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  cs: { label: "CS", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  billing: { label: "Cobranza", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  support: { label: "Soporte", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  retention: { label: "Retención", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  flag: { label: "Flag", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  ops: { label: "Ops", cls: "bg-violet-50 text-violet-700 border-violet-200" },
};

function DropshipperNotes({ dropshipperId }: { dropshipperId: number }) {
  const me = getUser();
  const qc = useQueryClient();
  const [newNote, setNewNote] = useState("");
  const [newCategory, setNewCategory] = useState<DropshipperNote["category"]>("general");

  const { data, isLoading } = useQuery<{ items: DropshipperNote[]; count: number }>({
    queryKey: ["dropshipper-notes", dropshipperId],
    queryFn: () =>
      api(`/api/dropshipper-notes?dropshipper_id=${dropshipperId}&unit=unidrop&limit=100`),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (b: { note: string; category: string }) =>
      api("/api/dropshipper-notes", {
        method: "POST",
        body: JSON.stringify({
          dropshipper_id: dropshipperId,
          unit: "unidrop",
          note: b.note,
          category: b.category,
        }),
      }),
    onSuccess: () => {
      setNewNote("");
      qc.invalidateQueries({ queryKey: ["dropshipper-notes", dropshipperId] });
    },
  });

  const archiveMut = useMutation({
    mutationFn: (noteId: number) =>
      api(`/api/dropshipper-notes/${noteId}/archive`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dropshipper-notes", dropshipperId] }),
  });

  const notes = data?.items ?? [];

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text inline-flex items-center gap-2">
            <StickyNote size={14} className="text-primary" /> Notas del equipo
          </h3>
          <p className="text-[11px] text-text-muted">
            Source of truth · queda registrado quién escribe qué · accesible también via MCP
          </p>
        </div>
        <span className="text-[10px] text-text-muted">
          {isLoading ? "Cargando..." : `${notes.length} ${notes.length === 1 ? "nota" : "notas"}`}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newNote.trim()) return;
          createMut.mutate({ note: newNote, category: newCategory });
        }}
        className="flex gap-2 mb-3 flex-wrap items-start"
      >
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as DropshipperNote["category"])}
          className="px-2 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
        >
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <input
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Escribir nota..."
          className="flex-1 min-w-[200px] px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={!newNote.trim() || createMut.isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow-md disabled:opacity-50"
        >
          <Send size={11} /> {createMut.isPending ? "..." : "Guardar"}
        </button>
      </form>

      {createMut.error && (
        <div className="text-[11px] text-error mb-2">{(createMut.error as Error).message}</div>
      )}

      {notes.length === 0 && !isLoading ? (
        <div className="text-[11px] text-text-muted italic py-2">
          Sin notas aún. Las notas que agregues quedan visibles para todo el equipo y son consultables desde Claude.
        </div>
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {notes.map((n) => {
            const cat = CATEGORY_CONFIG[n.category];
            const isOwn = me?.id === n.author_id;
            const canArchive = isOwn || !!me?.is_admin || me?.role === "admin";
            return (
              <div
                key={n.id}
                className="flex items-start gap-2 py-2 px-3 border border-border rounded-lg bg-soft/30"
              >
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${cat.cls}`}
                >
                  {cat.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text whitespace-pre-wrap break-words">{n.note}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {n.author_email} · {fmtArDateTime(n.created_at)}
                  </div>
                </div>
                {canArchive && (
                  <button
                    onClick={() => {
                      if (confirm("¿Archivar esta nota?")) archiveMut.mutate(n.id);
                    }}
                    className="text-text-muted hover:text-error p-1 rounded"
                    title="Archivar nota"
                  >
                    <Archive size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
