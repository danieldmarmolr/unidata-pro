"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Search, ExternalLink, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import { fmtArDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/utils";
import { periodToQuery, useGlobalFilters } from "@/lib/store";
import {
  UnifiedOrderModal,
  ChannelBadge,
  ShippingTypeBadge,
  type UnifiedOrder,
} from "@/components/unified-order-modal";

type GlobalOrder = {
  user_id: number;
  dropshipper_name: string;
  origen: "ml" | "tn";
  number: string;
  external_id: string;
  fecha: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  total: number;
  merch_cost: number;
  shipping_cost: number;
  profit_unidrop: number;
  buyer_name: string;
  buyer_city: string;
  buyer_province: string;
  shipping_type: string;
  label_downloaded: boolean;
  cancel_by_unidrop: boolean;
  is_combo: boolean;
};

type GlobalOrdersResponse = {
  items: GlobalOrder[];
  total: number;
  total_ml: number;
  total_tn: number;
  combo_count: number;
  ind_count: number;
  limit: number;
  offset: number;
  from?: string;
  to?: string;
  generated_at: string;
};

const PAGE_SIZE = 100;

function fmtCurrency(v: number): string {
  if (!v || v === 0) return "—";
  return `$ ${formatNumber(Math.round(v))}`;
}

function pipelineDateLabel(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString("es-AR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  } catch { return null; }
}

function OrderPipelineLite({ o }: { o: GlobalOrder }) {
  const ps = (o.payment_status || o.status || "").toLowerCase();
  const ss = (o.shipping_status || "").toLowerCase();
  const isPaid = ["paid", "processed", "approved", "confirmed"].some((v) => ps.includes(v) || ss.includes(v));
  const isPacked = o.label_downloaded;
  const isDelivered = ["delivered", "entregado"].some((v) => ss.includes(v));
  const isShipped = isPacked || isDelivered || ["shipped", "transit", "en_camino"].some((v) => ss.includes(v));

  const steps: { active: boolean; label: string; icon: string; iso?: string }[] = [
    { active: true, label: "Creada", icon: "📋", iso: o.fecha },
    { active: isPaid || o.origen === "ml", label: "Pagada", icon: "💲" },
    { active: isPacked, label: "Empaquetado", icon: "📦" },
    { active: isShipped, label: "En camino", icon: "🚚" },
    { active: isDelivered, label: "Entregada", icon: "✅" },
  ];

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center">
          {i > 0 && <div className={`h-0.5 w-2 ${s.active && steps[i - 1].active ? "bg-emerald-400" : "bg-zinc-200"}`} />}
          <div
            title={s.iso ? `${s.label} · ${pipelineDateLabel(s.iso) ?? ""}` : s.label}
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
              s.active ? "bg-emerald-500 text-white border-emerald-500" : "bg-zinc-100 text-zinc-400 border-zinc-200"
            }`}
          >
            {s.icon}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_WORDS = ["empaquet", "pendient", "en_camino", "en camino", "entregad", "transit", "creada", "pagad", "fallid", "retira"];
function methodEnvioDisplay(o: GlobalOrder): string {
  const candidatos = [o.shipping_type].filter(Boolean) as string[];
  for (const raw of candidatos) {
    const v = String(raw).trim();
    if (!v) continue;
    const low = v.toLowerCase();
    if (STATUS_WORDS.some((s) => low.includes(s))) continue;
    if (low.includes("punto") || low.includes("drop_off") || low === "pr") return "PR";
    if (low.includes("self") || low.includes("flexi") || low === "flex") return "FLEXI";
    if (low.includes("ml flex") || low.includes("ml_flex") || low.includes("xd_drop_off")) return "ML FLEX";
    if (low.includes("full") || low === "fulfillment") return "FULL";
    if (low.includes("oca")) return "OCA";
    if (low.includes("lightdata")) return "Lightdata";
    if (low.includes("andreani")) return "Andreani";
    if (low.includes("siempre") || low.includes("unifast")) return "UNIFAST";
    if (low.includes("retiro") && !low.includes("punto")) continue;
    if (v.length <= 18 && !low.includes("_")) return v.toUpperCase();
  }
  return "";
}

const SHIPPING_TYPE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "pr", label: "PR" },
  { value: "flex", label: "FLEX" },
  { value: "full", label: "FULL" },
  { value: "oca", label: "OCA" },
  { value: "lightdata", label: "Lightdata" },
  { value: "andreani", label: "Andreani" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "paid", label: "Pagado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "shipped", label: "Enviado" },
  { value: "delivered", label: "Entregado" },
  { value: "cancelled", label: "Cancelado" },
];

export function UnidropOrdersGlobal() {
  const router = useRouter();
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);

  const [channel, setChannel] = useState<"all" | "ml" | "tn">("all");
  const [combo, setCombo] = useState<"all" | "combo" | "ind">("all");
  const [shippingType, setShippingType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchDrop, setSearchDrop] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Modal: orden seleccionada (cargada lazy via /detail)
  const [modalKey, setModalKey] = useState<{ origen: "ml" | "tn"; id: string } | null>(null);

  const toggleExpand = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const qs = new URLSearchParams({
    ...(period !== "custom" ? { period } : {}),
    ...(period === "custom" && customFrom ? { from: customFrom } : {}),
    ...(period === "custom" && customTo ? { to: customTo } : {}),
    channel,
    ...(combo !== "all" ? { combo } : {}),
    ...(shippingType !== "all" ? { shipping_type: shippingType } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });

  const { data, isLoading, isFetching, error } = useQuery<GlobalOrdersResponse>({
    queryKey: ["unidrop-orders-global", period, customFrom, customTo, channel, combo, shippingType, statusFilter, debouncedSearch, page],
    queryFn: () => api<GlobalOrdersResponse>(`/api/dashboards/unidrop/orders?${qs}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Modal: fetch del detalle completo (UnifiedOrder enriquecido)
  const { data: detailData, isFetching: detailFetching } = useQuery<{ order: UnifiedOrder | null }>({
    queryKey: ["unidrop-order-detail", modalKey?.origen, modalKey?.id],
    queryFn: () => api<{ order: UnifiedOrder | null }>(`/api/dashboards/unidrop/orders/${modalKey!.origen}/${encodeURIComponent(modalKey!.id)}/detail`),
    enabled: !!modalKey,
    staleTime: 5 * 60_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalMl = data?.total_ml ?? 0;
  const totalTn = data?.total_tn ?? 0;
  const comboCount = data?.combo_count ?? 0;
  const indCount = data?.ind_count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch(v: string) {
    setSearchDrop(v);
    clearTimeout((handleSearch as any)._t);
    (handleSearch as any)._t = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(0);
    }, 400);
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header + filtros */}
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-bold text-text">Todas las ventas Unidrop</div>
          <div className="text-xs text-text-muted mt-0.5">
            {isLoading ? "Cargando..." : `${total.toLocaleString("es-AR")} órdenes ML + TN · ${comboCount.toLocaleString("es-AR")} combos · ${indCount.toLocaleString("es-AR")} individuales`}
            {isFetching && !isLoading && " · actualizando..."}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Canal */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["all", "ml", "tn"] as const).map((c) => (
              <button
                key={c}
                onClick={() => { setChannel(c); setPage(0); }}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  channel === c
                    ? "bg-primary text-white"
                    : "bg-surface text-text-muted hover:bg-surface-alt"
                }`}
              >
                {c === "all" ? `Todas (${total.toLocaleString("es-AR")})` : c === "ml" ? `ML (${totalMl.toLocaleString("es-AR")})` : `TN (${totalTn.toLocaleString("es-AR")})`}
              </button>
            ))}
          </div>

          {/* Combo/Ind */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["all", "combo", "ind"] as const).map((c) => (
              <button
                key={c}
                onClick={() => { setCombo(c); setPage(0); }}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  combo === c
                    ? "bg-primary text-white"
                    : "bg-surface text-text-muted hover:bg-surface-alt"
                }`}
              >
                {c === "all" ? "Tipo" : c === "combo" ? `Combo (${comboCount.toLocaleString("es-AR")})` : `Ind (${indCount.toLocaleString("es-AR")})`}
              </button>
            ))}
          </div>

          {/* Tipo envío */}
          <select
            value={shippingType}
            onChange={(e) => { setShippingType(e.target.value); setPage(0); }}
            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-text"
          >
            {SHIPPING_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-text"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Buscar dropshipper */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
            <input
              type="text"
              placeholder="Dropshipper..."
              value={searchDrop}
              onChange={(e) => handleSearch(e.target.value)}
              className="text-xs pl-6 pr-3 py-1.5 border border-border rounded-lg bg-surface text-text placeholder:text-text-muted w-36"
            />
          </div>
        </div>
      </div>

      {/* Tabla */}
      {error ? (
        <div className="px-5 py-4 text-sm text-error">Error al cargar órdenes: {(error as Error).message}</div>
      ) : isLoading ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-surface-alt" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">Sin órdenes para los filtros seleccionados.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-text-muted">
                <th className="w-7" />
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Dropshipper</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider"># Orden</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Cliente</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Fecha</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Estado del pedido</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Método envío</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Costo</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Ingreso</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Ganancia</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((o) => {
                const rowKey = `${o.origen}-${o.external_id || o.number}`;
                const isExpanded = expandedRows.has(rowKey);
                const metodoEnvio = methodEnvioDisplay(o);
                const costo = o.merch_cost + o.shipping_cost;
                const ganancia = o.total - costo;
                const hasCosto = costo > 0;

                return (
                  <>
                    <tr
                      key={rowKey}
                      className="hover:bg-surface-alt cursor-pointer transition-colors"
                      onClick={() => toggleExpand(rowKey)}
                    >
                      {/* Expand chevron */}
                      <td className="pl-2 pr-1 py-2 text-text-muted">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>

                      {/* Dropshipper */}
                      <td className="px-3 py-2 max-w-[140px]">
                        <button
                          className="font-semibold text-primary hover:underline truncate block max-w-full text-left"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/dropshipper/${o.user_id}`); }}
                        >
                          {o.dropshipper_name}
                        </button>
                      </td>

                      {/* # Orden — click abre el modal de detalle */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <ChannelBadge origen={o.origen} />
                          <button
                            className="font-mono text-[11px] text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalKey({ origen: o.origen, id: o.external_id || o.number });
                            }}
                            title="Ver detalle completo"
                          >
                            {o.number || o.external_id}
                          </button>
                          {o.is_combo && (
                            <span className="px-1 py-0 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
                              C
                            </span>
                          )}
                          {o.cancel_by_unidrop && (
                            <span className="px-1 py-0 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              CANCEL
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="px-3 py-2 max-w-[160px]">
                        <div className="font-medium text-text truncate">{o.buyer_name || "—"}</div>
                        {(o.buyer_city || o.buyer_province) && (
                          <div className="text-[10px] text-text-muted truncate">
                            {[o.buyer_city, o.buyer_province].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>

                      {/* Fecha */}
                      <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                        {o.fecha ? fmtArDateTime(o.fecha) : "—"}
                      </td>

                      {/* Pipeline */}
                      <td className="px-3 py-2">
                        <OrderPipelineLite o={o} />
                      </td>

                      {/* Método envío */}
                      <td className="px-3 py-2">
                        {metodoEnvio ? <ShippingTypeBadge type={o.shipping_type} /> : <span className="text-text-muted text-[10px]">—</span>}
                      </td>

                      {/* Costo */}
                      <td className="px-3 py-2 text-right text-text-muted tabular-nums">
                        {hasCosto ? fmtCurrency(costo) : "—"}
                      </td>

                      {/* Ingreso */}
                      <td className="px-3 py-2 text-right font-bold text-text tabular-nums">
                        {fmtCurrency(o.total)}
                      </td>

                      {/* Ganancia */}
                      <td className={`px-3 py-2 text-right font-bold tabular-nums ${
                        hasCosto ? (ganancia >= 0 ? "text-emerald-600" : "text-error") : "text-text-muted"
                      }`}>
                        {hasCosto ? fmtCurrency(ganancia) : "—"}
                      </td>

                      {/* Link al 360 */}
                      <td className="pr-3 py-2">
                        <button
                          className="p-1 hover:bg-primary/10 rounded text-primary transition-colors"
                          title="Ver dropshipper 360"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/dropshipper/${o.user_id}`); }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded: detalle rápido + boton ver completo */}
                    {isExpanded && (
                      <tr key={`${rowKey}-exp`} className="bg-surface-alt">
                        <td colSpan={11} className="px-6 py-3">
                          <div className="flex items-center gap-6 text-xs text-text-muted flex-wrap">
                            <div>
                              <span className="font-semibold text-text">ID:</span>{" "}
                              <span className="font-mono">{o.external_id}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-text">Status:</span>{" "}
                              {o.status || o.payment_status || "—"}
                            </div>
                            {o.shipping_status && (
                              <div>
                                <span className="font-semibold text-text">Envío:</span>{" "}
                                {o.shipping_status}
                              </div>
                            )}
                            {hasCosto && (
                              <>
                                <div>
                                  <span className="font-semibold text-text">Mercadería:</span>{" "}
                                  {fmtCurrency(o.merch_cost)}
                                </div>
                                <div>
                                  <span className="font-semibold text-text">Costo envío:</span>{" "}
                                  {fmtCurrency(o.shipping_cost)}
                                </div>
                              </>
                            )}
                            {o.profit_unidrop > 0 && (
                              <div>
                                <span className="font-semibold text-text">Profit sub.:</span>{" "}
                                <span className="text-emerald-600">{fmtCurrency(o.profit_unidrop)}</span>
                              </div>
                            )}
                            <div className="ml-auto flex items-center gap-3">
                              <button
                                className="text-primary font-semibold hover:underline flex items-center gap-1"
                                onClick={() => setModalKey({ origen: o.origen, id: o.external_id || o.number })}
                              >
                                Ver detalle completo <ExternalLink className="w-3 h-3" />
                              </button>
                              <button
                                className="text-text-muted font-semibold hover:underline flex items-center gap-1"
                                onClick={() => router.push(`/dashboard/dropshipper/${o.user_id}`)}
                              >
                                Ver perfil dropshipper
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total.toLocaleString("es-AR")}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 border border-border rounded hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-text font-semibold">
              {page + 1} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 border border-border rounded hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de detalle completo (lazy fetched) */}
      {modalKey && detailFetching && !detailData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalKey(null)}>
          <div className="bg-surface rounded-2xl shadow-2xl px-8 py-6 text-sm text-text-muted">
            Cargando detalle de la orden...
          </div>
        </div>
      )}
      <UnifiedOrderModal
        order={detailData?.order ?? null}
        onClose={() => setModalKey(null)}
      />
    </div>
  );
}
