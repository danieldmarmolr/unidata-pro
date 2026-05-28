"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw, ChevronDown, ChevronRight, Inbox, Check, Copy,
  ExternalLink, X, Receipt, KeyRound, Truck, PackageCheck, Search,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

type Bucket = "en_camino" | "recibida_pendiente" | "transferida" | "rechazada" | "todas";
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

type Item = {
  return_id: number;
  ml_order_id: number;
  ml_status: string;
  reason: string;
  amount_to_refund: number;
  tracking_code: string;
  carrier: string;
  discrepancy_type: string;
  discrepancy_note: string;
  discrepancy_photo: string;
  received_at: string | null;
  created_at: string;
  order_number: string;
  order_total: number;
  order_status: string;
  order_date: string | null;
  order_user_id: number | null;
  dropshipper: {
    user_id: number | null;
    dni: string;
    name: string;
    fantasy_name: string;
    email: string;
    phone: string;
    cuit: string;
  };
  ml_account: {
    id: number | null;
    nickname: string;
    sin_token: boolean;
    expires_at: string | null;
  };
  external_claim_id: string | null;
  notified_at: string | null;
  product: { sku: string; title: string; qty: number; unit_price: number; thumbnail: string } | null;
  bank: {
    cbu?: string | null;
    cbu_alias?: string | null;
    alias?: string | null;
    bank_name?: string | null;
    account_owner?: string | null;
    status?: string | null;
  } | null;
  invoice: {
    id: string;
    tipo: string;
    numero: string;
    link: string;
    fecha: string | null;
    total: number;
  } | null;
  finance_action: FinanceAction | null;
  bucket: Bucket;
};

type Resp = {
  items: Item[];
  count: number;
  total: number;
  counts_by_bucket: Record<Bucket, number>;
};

const BUCKET_META: Record<Bucket, { label: string; color: string; bg: string; border: string; icon: typeof Truck }> = {
  en_camino:           { label: "En camino",     color: "#f59e0b", bg: "bg-amber-50",   border: "border-amber-300",   icon: Truck       },
  recibida_pendiente:  { label: "A transferir",  color: "#8b5cf6", bg: "bg-violet-50",  border: "border-violet-300",  icon: PackageCheck },
  transferida:         { label: "Transferida",   color: "#3b82f6", bg: "bg-blue-50",    border: "border-blue-300",    icon: Check       },
  rechazada:           { label: "Rechazada",     color: "#94a3b8", bg: "bg-zinc-50",    border: "border-zinc-300",    icon: X           },
  todas:               { label: "Todas",         color: "#6366f1", bg: "bg-indigo-50",  border: "border-indigo-300",  icon: RotateCcw   },
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
  const [tab, setTab] = useState<Bucket>("recibida_pendiente");
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
  const counts = data?.counts_by_bucket ?? { en_camino: 0, recibida_pendiente: 0, transferida: 0, rechazada: 0, todas: 0 };

  return (
    <>
      <Topbar
        title="Devoluciones — Mercado Libre"
        subtitle="Gestión de transferencias por devolución de productos ML. Copiá CBU, abrí factura y marcá el estado."
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border flex-wrap">
            <TabBtn active={tab === "recibida_pendiente"} onClick={() => setTab("recibida_pendiente")} label="A transferir" count={counts.recibida_pendiente} />
            <TabBtn active={tab === "en_camino"}          onClick={() => setTab("en_camino")}          label="En camino"    count={counts.en_camino} />
            <TabBtn active={tab === "transferida"}        onClick={() => setTab("transferida")}        label="Transferidas" count={counts.transferida} />
            <TabBtn active={tab === "rechazada"}          onClick={() => setTab("rechazada")}          label="Rechazadas"   count={counts.rechazada} />
            <TabBtn active={tab === "todas"}              onClick={() => setTab("todas")}              label="Todas"        count={counts.todas} />
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
              {debouncedSearch ? "Probá quitar el filtro de búsqueda." : "Mostrar otro estado para ver más."}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((r) => (
              <ReturnCard key={`${r.return_id}-${r.ml_order_id}`} item={r} />
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
  const meta = BUCKET_META[r.bucket];
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

  return (
    <div className={`border-2 rounded-xl ${meta.bg} ${meta.border}`}>
      <div className="p-4 flex items-start gap-3">
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
              <span>{meta.label}</span>
              {r.ml_account.sin_token && (
                <span className="inline-flex items-center gap-1 normal-case bg-red-100 border border-red-300 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                  <KeyRound size={10} /> Sin token
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
            {r.product?.title && <> · {r.product.title.slice(0, 50)}{r.product.title.length > 50 ? "…" : ""}</>}
          </div>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="text-text-muted hover:text-text px-1"
          title={open ? "Cerrar" : "Ver detalle"}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-surface/50 p-4 space-y-4">
          {/* Producto */}
          {r.product && (
            <div className="flex items-center gap-3 bg-bg border border-border rounded p-2">
              {r.product.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.product.thumbnail} alt="" className="w-14 h-14 object-cover rounded border border-border" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-text truncate">{r.product.title}</div>
                <div className="text-[11px] text-text-muted">
                  SKU <span className="font-mono">{r.product.sku || "—"}</span>
                  {" · "}qty {r.product.qty}
                  {" · "}{fmtMoney(r.product.unit_price)}
                </div>
              </div>
            </div>
          )}

          {/* Datos bancarios (lo más importante para Finanzas) */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Datos bancarios
            </div>
            {!r.bank ? (
              <div className="text-xs text-text-muted bg-red-50 border border-red-200 rounded p-2">
                Sin cuenta bancaria registrada en Talo para este dropshipper. Pedile al equipo que la cargue desde Unidrop.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <Field label="Titular"   value={r.bank.account_owner ?? "—"} />
                <Field label="CUIT"      value={r.dropshipper.cuit || "—"} copyable={!!r.dropshipper.cuit} />
                <Field label="Banco"     value={r.bank.bank_name ?? "—"} />
                <Field label="CBU/CVU"   value={r.bank.cbu ?? "—"} copyable={!!r.bank.cbu} mono />
                <Field label="Alias"     value={r.bank.cbu_alias || r.bank.alias || "—"} copyable={!!(r.bank.cbu_alias || r.bank.alias)} />
                <Field label="Monto a devolver" value={fmtMoney(r.amount_to_refund)} />
              </div>
            )}
          </div>

          {/* Detalle devolución */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Detalle de la devolución
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Field label="Motivo"        value={r.reason || "—"} />
              <Field label="Estado MELI"   value={r.ml_status || "—"} />
              <Field label="Tracking"      value={r.tracking_code || "—"} copyable={!!r.tracking_code} mono />
              <Field label="Transportista" value={r.carrier || "—"} />
              <Field label="Recibido"      value={r.received_at ? fmtDate(r.received_at) : "Aún no recibido"} />
              {r.external_claim_id && <Field label="Claim ML" value={r.external_claim_id} copyable mono />}
              {r.discrepancy_type && (
                <div className="sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">
                    Discrepancia
                  </div>
                  <div className="text-xs text-text bg-bg border border-border rounded p-2">
                    <span className="font-semibold">{r.discrepancy_type}</span>
                    {r.discrepancy_note && <> · {r.discrepancy_note}</>}
                    {r.discrepancy_photo && (
                      <a
                        href={r.discrepancy_photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 underline text-primary"
                      >
                        ver foto
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Audit timeline */}
          {action && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Historial Finanzas
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
                    label="Rechazada"
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

function Field({
  label, value, copyable, mono,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
}) {
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
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">
        {label}
      </div>
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

function TimelineItem({
  label, date, detail,
}: {
  label: string;
  date: string;
  detail?: string | null;
}) {
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

