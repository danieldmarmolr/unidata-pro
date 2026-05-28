"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw, ChevronDown, ChevronRight, Inbox, Check, Copy,
  ExternalLink, X, Receipt, KeyRound, Truck, PackageCheck, Search,
  Bell, Image as ImageIcon, MessageCircle, User as UserIcon,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

type MLStatus = "NOTIFICADA" | "EN_CAMINO" | "TRANSFERENCIA_PENDIENTE" | "CERRADA";
type FZTab = "transferida_fz" | "rechazada_fz";
type Tab = MLStatus | FZTab | "todas";
type ActionStatus = "pending" | "transferred" | "rejected";

type FinanceAction = {
  id: number;
  ml_order_id: number;
  return_idx: number;
  status: ActionStatus;
  transferred_at: string | null;
  transferred_by_email: string | null;
  transferred_note: string | null;
  transferred_amount_arg: number | null;
  rejected_at: string | null;
  rejected_by_email: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ReturnItem = {
  item_id: string;
  title: string;
  sku: string;
  qty: number;
  unit_price: number;
  unit_cost: number;
  thumbnail: string;
  reason: string;
};
type Attachment = { url: string; type: string; created_at: string };
type HistoryEntry = { from_status: string; to_status: string; actor_id: number | null; note: string; at: string };

type Item = {
  return_pk: number;
  claim_id: number | null;
  return_id_ml: number | null;
  shipment_id: number | null;
  ml_order_id: number;
  ml_status: MLStatus | string;
  reason: string;
  amount_to_refund: number;
  tracking_code: string;
  carrier: string;
  discrepancy_type: string;
  discrepancy_note: string;
  discrepancy_photo: string;
  received_at: string | null;
  created_at: string;
  updated_at: string;
  order_number: string;
  order_total: number;
  order_status: string;
  order_date: string | null;
  order_user_id: number | null;
  dropshipper: { user_id: number | null; dni: string; name: string; fantasy_name: string; email: string; phone: string; cuit: string };
  ml_account: { id: number | null; nickname: string; sin_token: boolean; expires_at: string | null };
  buyer: { name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null; email?: string | null; phone?: string | null; dni?: string | null; id?: string | null } | null;
  return_items: ReturnItem[];
  attachments: Attachment[];
  history: HistoryEntry[];
  thumbnail: string;
  bank: {
    cvu?: string | null;
    alias?: string | null;
    name?: string | null;
    email?: string | null;
    customer_id?: string | null;
    is_active?: boolean;
    needs_cvu?: boolean;
  } | null;
  invoice: { id: string; tipo: string; numero: string; link: string; fecha: string | null; total: number } | null;
  finance_action: FinanceAction | null;
  finance_overlay: FZTab | null;
};

type Resp = {
  items: Item[];
  count: number;
  total: number;
  counts_by_bucket: Record<Tab, number>;
};

const TAB_META: Record<Tab, { label: string; color: string; bg: string; border: string; icon: typeof Truck }> = {
  NOTIFICADA:              { label: "Notificadas",   color: "#f59e0b", bg: "bg-amber-50",   border: "border-amber-300",   icon: Bell        },
  EN_CAMINO:               { label: "En camino",     color: "#0ea5e9", bg: "bg-sky-50",     border: "border-sky-300",     icon: Truck       },
  TRANSFERENCIA_PENDIENTE: { label: "A transferir",  color: "#8b5cf6", bg: "bg-violet-50",  border: "border-violet-300",  icon: PackageCheck },
  CERRADA:                 { label: "Cerradas",      color: "#10b981", bg: "bg-emerald-50", border: "border-emerald-300", icon: Check       },
  transferida_fz:          { label: "Transferidas Fz", color: "#3b82f6", bg: "bg-blue-50",  border: "border-blue-300",    icon: Check       },
  rechazada_fz:            { label: "Rechazadas Fz",   color: "#94a3b8", bg: "bg-zinc-50",  border: "border-zinc-300",    icon: X           },
  todas:                   { label: "Todas",         color: "#6366f1", bg: "bg-indigo-50",  border: "border-indigo-300",  icon: RotateCcw   },
};

const ML_STATUS_LABEL: Record<string, string> = {
  NOTIFICADA: "Notificada",
  EN_CAMINO: "En camino",
  TRANSFERENCIA_PENDIENTE: "Pend. transferencia",
  CERRADA: "Cerrada",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(v);
}

export default function DevMercadoLibrePage() {
  const [tab, setTab] = useState<Tab>("TRANSFERENCIA_PENDIENTE");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["ml-return-actions", tab, debouncedSearch],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("tab", tab);
      if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
      p.set("limit", "100");
      return api(`/api/ml-return-actions?${p.toString()}`);
    },
    staleTime: 15_000,
  });

  const items = data?.items ?? [];
  const counts = data?.counts_by_bucket ?? {
    NOTIFICADA: 0, EN_CAMINO: 0, TRANSFERENCIA_PENDIENTE: 0, CERRADA: 0,
    transferida_fz: 0, rechazada_fz: 0, todas: 0,
  };

  return (
    <>
      <Topbar
        title="Devoluciones — Mercado Libre"
        subtitle="Gestión de transferencias por devolución. Estados reales del schema ML + tracking interno de Finanzas."
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border flex-wrap">
            <TabBtn active={tab === "TRANSFERENCIA_PENDIENTE"} onClick={() => setTab("TRANSFERENCIA_PENDIENTE")} label="A transferir" count={counts.TRANSFERENCIA_PENDIENTE} />
            <TabBtn active={tab === "NOTIFICADA"}             onClick={() => setTab("NOTIFICADA")}             label="Notificadas"  count={counts.NOTIFICADA} />
            <TabBtn active={tab === "EN_CAMINO"}              onClick={() => setTab("EN_CAMINO")}              label="En camino"    count={counts.EN_CAMINO} />
            <TabBtn active={tab === "CERRADA"}                onClick={() => setTab("CERRADA")}                label="Cerradas"     count={counts.CERRADA} />
            <TabBtn active={tab === "transferida_fz"}         onClick={() => setTab("transferida_fz")}         label="Transf. Fz"   count={counts.transferida_fz} />
            <TabBtn active={tab === "rechazada_fz"}           onClick={() => setTab("rechazada_fz")}           label="Rechaz. Fz"   count={counts.rechazada_fz} />
            <TabBtn active={tab === "todas"}                  onClick={() => setTab("todas")}                  label="Todas"        count={counts.todas} />
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="DNI, nombre, número DROP, claim, tracking…"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs outline-none focus:border-primary w-72"
            />
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <Inbox size={32} className="mx-auto text-text-muted mb-3" />
            <div className="text-sm font-bold text-text">Sin devoluciones en este estado</div>
            <div className="text-xs text-text-muted mt-1">
              {debouncedSearch ? "Probá quitar el filtro de búsqueda." : "Cambiá de tab para ver más."}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((r) => (
              <ReturnCard key={r.return_pk} item={r} />
            ))}
          </div>
        )}

        {!isLoading && data && data.total > data.count && (
          <div className="text-center text-xs text-text-muted mt-4">
            Mostrando {data.count} de {data.total}. Acotá la búsqueda para filtrar más.
          </div>
        )}
      </div>
    </>
  );
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        active ? "bg-white text-primary shadow-sm" : "text-text-muted hover:text-text"
      }`}
    >
      {label} {count > 0 && <span className={`ml-1 text-[10px] ${active ? "text-primary/70" : "text-text-muted/60"}`}>({count})</span>}
    </button>
  );
}

function ReturnCard({ item: r }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const statusKey = r.ml_status as MLStatus;
  const meta = statusKey in TAB_META ? TAB_META[statusKey] : TAB_META.todas;
  const Icon = meta.icon;
  const qc = useQueryClient();

  const transferMut = useMutation({
    mutationFn: (body: { note: string | null; amount_arg: number | null }) =>
      api(`/api/ml-return-actions/${r.ml_order_id}/mark-transferred`, {
        method: "POST",
        body: JSON.stringify({ ...body, return_idx: 1 }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ml-return-actions"] });
      setShowTransferModal(false);
    },
  });

  const rejectMut = useMutation({
    mutationFn: (body: { reason: string }) =>
      api(`/api/ml-return-actions/${r.ml_order_id}/reject`, {
        method: "POST",
        body: JSON.stringify({ ...body, return_idx: 1 }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ml-return-actions"] });
      setShowRejectModal(false);
    },
  });

  const revertMut = useMutation({
    mutationFn: () =>
      api(`/api/ml-return-actions/${r.ml_order_id}/revert-to-pending`, {
        method: "POST",
        body: JSON.stringify({ return_idx: 1 }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ml-return-actions"] });
    },
  });

  const dropName = r.dropshipper.name || r.dropshipper.fantasy_name || r.ml_account.nickname || "—";
  const action = r.finance_action;
  const mlLabel = ML_STATUS_LABEL[r.ml_status] || r.ml_status || "—";
  const fzOverlay = r.finance_overlay;
  const firstItemTitle = r.return_items[0]?.title || "";

  return (
    <div className={`border-2 rounded-xl ${meta.bg} ${meta.border}`}>
      <div
        className="p-4 flex items-start gap-3 cursor-pointer hover:bg-bg/30 transition rounded-t-xl"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow flex-shrink-0"
          style={{ background: meta.color }}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-0.5">
            <div className="text-sm font-bold text-text">
              {dropName}
              {r.dropshipper.fantasy_name && r.dropshipper.fantasy_name !== r.dropshipper.name && (
                <span className="text-text-muted font-normal"> · {r.dropshipper.fantasy_name}</span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-2 flex-wrap justify-end">
              <span style={{ color: meta.color }}>{mlLabel}</span>
              {fzOverlay === "transferida_fz" && (
                <span className="normal-case bg-blue-100 border border-blue-300 text-blue-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                  ✓ Transferida por Finanzas
                </span>
              )}
              {fzOverlay === "rechazada_fz" && (
                <span className="normal-case bg-zinc-100 border border-zinc-300 text-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                  ✕ Rechazada por Finanzas
                </span>
              )}
              {r.ml_account.sin_token && (
                <span className="inline-flex items-center gap-1 normal-case bg-red-100 border border-red-300 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                  <KeyRound size={10} /> Sin token
                </span>
              )}
              {r.claim_id && (
                <span className="font-mono normal-case tracking-normal bg-bg border border-border rounded px-1.5 py-0.5 text-[10px]">
                  CLAIM {r.claim_id}
                </span>
              )}
              {r.order_number && (
                <span className="font-mono normal-case tracking-normal bg-bg border border-border rounded px-1.5 py-0.5 text-[10px]">
                  {r.order_number}
                </span>
              )}
              <span>· {fmtDate(r.created_at)}</span>
            </div>
          </div>
          <div className="text-xs text-text-muted">
            {r.dropshipper.dni && <>DNI {r.dropshipper.dni} · </>}
            {r.dropshipper.email}
            {r.ml_account.nickname && <> · ML {r.ml_account.nickname}</>}
            {" · "}
            <span className="font-semibold text-text">{fmtMoney(r.amount_to_refund)}</span>
            {firstItemTitle && <> · {firstItemTitle.slice(0, 50)}{firstItemTitle.length > 50 ? "…" : ""}</>}
            {r.return_items.length > 1 && <> +{r.return_items.length - 1}</>}
          </div>
          {/* CVU/Alias copy + flags WhatsApp accionables.
              Lo mas pedido por Finanzas: copiar CVU sin abrir el detalle. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {r.bank?.cvu && (
              <CopyChip label="CVU" value={r.bank.cvu} mono hint="Talo · click para copiar" />
            )}
            {r.bank?.alias && (
              <CopyChip label="Alias" value={r.bank.alias} hint="Talo · click para copiar" />
            )}
            {r.bank?.needs_cvu && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-800 text-[11px] font-semibold"
                title="El dropper tiene cuenta Talo pero no cargo CVU todavia"
              >
                ⚠️ Falta CVU
              </span>
            )}
            {!r.bank && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-100 border border-red-300 text-red-700 text-[11px] font-semibold"
                title="No hay cuenta Talo registrada — el dropper tiene que crearla en Unidrop"
              >
                ⛔ Sin cuenta Talo
              </span>
            )}
            {r.bank?.needs_cvu && r.dropshipper.phone && (
              <a
                href={`https://wa.me/${r.dropshipper.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                  `Hola ${r.dropshipper.name || ""}, necesitamos tu CVU de Talo para devolverte la plata del claim ${r.claim_id ?? ""} (monto ${r.amount_to_refund}). Por favor cargalo desde unidrop.com.ar.`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-200 transition"
                onClick={(e) => e.stopPropagation()}
                title="WhatsApp: pedir al dropper que cargue el CVU"
              >
                <MessageCircle size={11} /> Pedir CVU
              </a>
            )}
            {r.ml_account.sin_token && r.dropshipper.phone && (
              <a
                href={`https://wa.me/${r.dropshipper.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                  `Hola ${r.dropshipper.name || ""}, tu token de Mercado Libre venció y necesitamos que lo renueves para gestionar la devolución del claim ${r.claim_id ?? ""}.`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-200 transition"
                onClick={(e) => e.stopPropagation()}
                title={`WhatsApp al dropper (${r.dropshipper.phone})`}
              >
                <MessageCircle size={11} /> Renovar token
              </a>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="text-text-muted hover:text-text px-1"
          title={open ? "Cerrar" : "Ver detalle"}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-surface/50 p-4 space-y-4">
          {/* Productos devueltos: precio venta vs costo dropper, qty, SKU */}
          {r.return_items.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Productos devueltos ({r.return_items.length}) · datos de la orden original
              </div>
              <div className="space-y-1.5">
                {r.return_items.map((it, idx) => {
                  const thumb = it.thumbnail || (idx === 0 ? r.thumbnail : "");
                  const totalPrice = it.unit_price * it.qty;
                  const totalCost = it.unit_cost * it.qty;
                  return (
                    <div key={idx} className="flex items-center gap-3 bg-bg border border-border rounded p-2">
                      {thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="w-14 h-14 object-cover rounded border border-border flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-text">
                          {it.title || "—"}
                          {it.qty > 1 && <span className="text-text-muted font-normal"> × {it.qty}</span>}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          SKU <span className="font-mono">{it.sku || "—"}</span>
                          {it.reason && <> · {it.reason}</>}
                        </div>
                      </div>
                      <div className="text-right text-[11px]">
                        <div className="text-text">
                          <span className="text-text-muted">Precio venta</span>{" "}
                          <span className="font-semibold">{fmtMoney(it.unit_price)}</span>
                          {it.qty > 1 && <span className="text-text-muted"> c/u</span>}
                        </div>
                        {it.unit_cost > 0 && (
                          <div className="text-text">
                            <span className="text-text-muted">Costo drop</span>{" "}
                            <span className="font-semibold">{fmtMoney(it.unit_cost)}</span>
                            {it.qty > 1 && <span className="text-text-muted"> c/u</span>}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-text border-l border-border pl-3 ml-1">
                        <div className="font-bold">{fmtMoney(totalPrice)}</div>
                        {totalCost > 0 && (
                          <div className="text-text-muted">{fmtMoney(totalCost)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Totales */}
                <div className="flex justify-end gap-6 text-[11px] pt-1.5 border-t border-border">
                  <div>
                    <span className="text-text-muted">Total precio venta:</span>{" "}
                    <span className="font-semibold text-text">
                      {fmtMoney(r.return_items.reduce((s, it) => s + it.unit_price * it.qty, 0))}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">Total costo drop:</span>{" "}
                    <span className="font-semibold text-text">
                      {fmtMoney(r.return_items.reduce((s, it) => s + it.unit_cost * it.qty, 0))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Comprador final ML */}
          {r.buyer && (r.buyer.name || r.buyer.nickname || r.buyer.email) && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Comprador final (ML)
              </div>
              <div className="flex items-center gap-3 bg-bg border border-border rounded p-2 text-xs">
                <div className="w-8 h-8 rounded-full bg-soft border border-border flex items-center justify-center text-text-muted">
                  <UserIcon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text">{r.buyer.name || r.buyer.nickname || "—"}</div>
                  <div className="text-[11px] text-text-muted">
                    {r.buyer.nickname && <>ML {r.buyer.nickname}</>}
                    {r.buyer.email && <> · {r.buyer.email}</>}
                    {r.buyer.phone && <> · {r.buyer.phone}</>}
                    {r.buyer.dni && <> · DNI {r.buyer.dni}</>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cuenta Talo (CVU + alias) — info para transferir */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Cuenta Talo del dropshipper
            </div>
            {!r.bank ? (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                ⛔ Sin cuenta Talo registrada. El dropper tiene que crearla en{" "}
                <a href="https://unidrop.com.ar" target="_blank" rel="noopener noreferrer" className="underline">unidrop.com.ar</a>{" "}
                antes de que podamos transferirle.
              </div>
            ) : (
              <>
                {r.bank.needs_cvu && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2 mb-2">
                    ⚠️ Tiene cuenta Talo (alias <span className="font-mono">{r.bank.alias}</span>) pero <strong>no cargó el CVU</strong>.
                    Sin CVU no se puede transferir. Usá el botón "Pedir CVU" del header para mandarle WhatsApp.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <Field label="Titular"        value={r.bank.name || "—"} />
                  <Field label="CUIT"           value={r.dropshipper.cuit || "—"} copyable={!!r.dropshipper.cuit} />
                  <Field label="CVU"            value={r.bank.cvu ?? "—"} copyable={!!r.bank.cvu} mono />
                  <Field label="Alias"          value={r.bank.alias ?? "—"} copyable={!!r.bank.alias} />
                  <Field label="Email Talo"     value={r.bank.email ?? "—"} />
                  <Field label="Monto a devolver" value={fmtMoney(r.amount_to_refund)} />
                </div>
              </>
            )}
          </div>

          {/* Detalle devolución */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Detalle del claim ML
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Field label="Motivo"          value={r.reason || "—"} />
              <Field label="Estado ML"       value={mlLabel} />
              <Field label="Tracking"        value={r.tracking_code || "—"} copyable={!!r.tracking_code} mono />
              <Field label="Transportista"   value={r.carrier || "—"} />
              <Field label="Recibido"        value={r.received_at ? fmtDate(r.received_at) : "Aún no"} />
              <Field label="Última actualiz." value={fmtDate(r.updated_at)} />
              {r.discrepancy_type && (
                <div className="sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">
                    Discrepancia
                  </div>
                  <div className="text-xs text-text bg-bg border border-border rounded p-2">
                    <span className="font-semibold">{r.discrepancy_type}</span>
                    {r.discrepancy_note && <> · {r.discrepancy_note}</>}
                    {r.discrepancy_photo && (
                      <a href={r.discrepancy_photo} target="_blank" rel="noopener noreferrer" className="ml-2 underline text-primary">
                        ver foto
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Attachments (fotos comprador) */}
          {r.attachments.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Adjuntos del comprador ({r.attachments.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {r.attachments.map((a, idx) => (
                  <a
                    key={idx}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-bg text-[11px] text-text hover:bg-surface transition"
                    title={`${a.type} · ${fmtDate(a.created_at)}`}
                  >
                    <ImageIcon size={11} /> {a.type || "archivo"} #{idx + 1}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Timeline ML (history real) */}
          {r.history.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Timeline ML
              </div>
              <div className="space-y-1.5 text-xs">
                {r.history.map((h, idx) => (
                  <TimelineItem
                    key={idx}
                    label={`${ML_STATUS_LABEL[h.from_status] ?? h.from_status ?? "—"} → ${ML_STATUS_LABEL[h.to_status] ?? h.to_status}`}
                    date={h.at}
                    detail={[h.actor_id ? `actor #${h.actor_id}` : null, h.note ? `"${h.note}"` : null].filter(Boolean).join(" · ")}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Historial Finanzas */}
          {action && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Historial Finanzas (interno UNIDATA)
              </div>
              <div className="space-y-1.5 text-xs">
                {action.transferred_at && (
                  <TimelineItem
                    label="Transferencia marcada"
                    date={action.transferred_at}
                    detail={[
                      action.transferred_by_email,
                      action.transferred_amount_arg != null ? `monto: ${fmtMoney(action.transferred_amount_arg)}` : null,
                      action.transferred_note ? `nota: "${action.transferred_note}"` : null,
                    ].filter(Boolean).join(" · ")}
                  />
                )}
                {action.rejected_at && (
                  <TimelineItem
                    label="Rechazada por Finanzas"
                    date={action.rejected_at}
                    detail={[
                      action.rejected_by_email,
                      action.rejection_reason ? `razón: "${action.rejection_reason}"` : null,
                    ].filter(Boolean).join(" · ")}
                  />
                )}
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {r.dropshipper.user_id && (
              <Link
                href={`/dashboard/dropshipper/${r.dropshipper.user_id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text hover:bg-bg transition"
              >
                <ExternalLink size={12} /> Vista 360
              </Link>
            )}

            {r.invoice?.link && <InvoiceButton invoice={r.invoice} />}

            {(!action || action.status === "pending") && (
              <>
                <button
                  onClick={() => setShowTransferModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow hover:shadow-md transition"
                >
                  <Check size={12} /> Marcar como transferido
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition"
                >
                  <X size={12} /> Rechazar
                </button>
              </>
            )}

            {action?.status === "transferred" && (
              <button
                onClick={() => {
                  if (confirm("¿Revertir esta devolución a Pendiente? Se borrarán los datos de la transferencia.")) {
                    revertMut.mutate();
                  }
                }}
                disabled={revertMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text hover:bg-bg text-xs font-semibold transition disabled:opacity-50"
              >
                <RotateCcw size={12} /> {revertMut.isPending ? "Revirtiendo…" : "Revertir a Pendiente"}
              </button>
            )}
          </div>

          {(transferMut.isError || rejectMut.isError || revertMut.isError) && (
            <div className="text-xs bg-red-50 border border-red-200 text-error rounded-lg px-3 py-2">
              {(transferMut.error as Error)?.message ??
                (rejectMut.error as Error)?.message ??
                (revertMut.error as Error)?.message}
            </div>
          )}
        </div>
      )}

      {showTransferModal && (
        <TransferModal
          loading={transferMut.isPending}
          defaultAmount={r.amount_to_refund}
          onCancel={() => setShowTransferModal(false)}
          onConfirm={(note, amount) => transferMut.mutate({ note, amount_arg: amount })}
        />
      )}
      {showRejectModal && (
        <RejectModal
          loading={rejectMut.isPending}
          onCancel={() => setShowRejectModal(false)}
          onConfirm={(reason) => rejectMut.mutate({ reason })}
        />
      )}
    </div>
  );
}

function InvoiceButton({ invoice }: { invoice: NonNullable<Item["invoice"]> }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = invoice.numero
    ? `${invoice.tipo ? invoice.tipo + " " : ""}${invoice.numero}`.trim()
    : "";

  useEffect(() => {
    if (!hover || !code) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      e.preventDefault();
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => {});
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hover, code]);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <a
        href={invoice.link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text hover:bg-bg transition"
      >
        <Receipt size={12} /> Ver factura
      </a>
      {hover && code && (
        <div
          className="absolute left-0 top-full mt-1 z-20 bg-zinc-900 text-white text-[11px] font-mono px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap cursor-text"
          style={{ userSelect: "all" }}
          onClick={(e) => e.stopPropagation()}
        >
          {code}
          <span className="ml-2 text-zinc-400 select-none font-sans">
            {copied ? "Copiado" : "Ctrl+C para copiar"}
          </span>
        </div>
      )}
    </div>
  );
}

function CopyChip({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  const [copied, setCopied] = useState(false);
  async function doCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <button
      onClick={doCopy}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg border border-border hover:border-primary text-[11px] transition group"
      title={hint ? `${hint} — click para copiar` : "Click para copiar"}
    >
      <span className="text-text-muted font-semibold uppercase tracking-wider text-[9px]">{label}</span>
      <span className={`text-text ${mono ? "font-mono" : ""}`}>{value}</span>
      {copied ? (
        <Check size={11} className="text-emerald-600" />
      ) : (
        <Copy size={11} className="text-text-muted group-hover:text-primary" />
      )}
    </button>
  );
}

function Field({ label, value, copyable, mono }: { label: string; value: string; copyable?: boolean; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">{label}</div>
      <div className={`flex items-center gap-2 ${mono ? "font-mono" : ""}`}>
        <span className="text-text">{value}</span>
        {copyable && value && value !== "—" && (
          <button
            type="button"
            onClick={doCopy}
            className="text-text-muted hover:text-primary transition"
            title="Copiar"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>
    </div>
  );
}

function TimelineItem({ label, date, detail }: { label: string; date: string; detail?: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
      <div className="flex-1">
        <span className="font-semibold text-text">{label}</span>
        <span className="text-text-muted"> · {fmtDate(date)}</span>
        {detail && <span className="text-text-muted"> · {detail}</span>}
      </div>
    </div>
  );
}

function TransferModal({
  loading, defaultAmount, onCancel, onConfirm,
}: {
  loading: boolean;
  defaultAmount: number;
  onCancel: () => void;
  onConfirm: (note: string | null, amount: number | null) => void;
}) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : "");
  return (
    <ModalShell onClose={onCancel} title="Marcar como transferido">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
            Monto transferido (ARS)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
            Nota (nro operación, comprobante)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary resize-none"
            placeholder="Ej: Op #12345 Galicia"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold">
          Cancelar
        </button>
        <button
          disabled={loading}
          onClick={() => {
            const a = amount.trim() ? Number(amount.replace(",", ".")) : null;
            onConfirm(note.trim() || null, a);
          }}
          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow disabled:opacity-60"
        >
          {loading ? "Guardando…" : "Confirmar transferencia"}
        </button>
      </div>
    </ModalShell>
  );
}

function RejectModal({
  loading, onCancel, onConfirm,
}: {
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  return (
    <ModalShell onClose={onCancel} title="Rechazar devolución">
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Razón del rechazo (mín 5 caracteres)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary resize-none"
          placeholder="Ej: Producto llegó dañado por el cliente, no corresponde devolución…"
        />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold">
          Cancelar
        </button>
        <button
          disabled={loading || !valid}
          onClick={() => onConfirm(reason.trim())}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow disabled:opacity-60"
        >
          {loading ? "Rechazando…" : "Rechazar"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-text">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

