"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw, ChevronDown, ChevronRight, Inbox, Check, AlertCircle, Copy, ExternalLink, X, Receipt, Trash2,
  Search, Filter,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { CresiumTransferPanel } from "@/components/cresium-transfer-panel";
import { TodayPanel } from "@/components/today-panel";
import { api, getUser } from "@/lib/api";

type Status = "pending" | "transferred" | "integration_cancelled" | "rejected";

type Request = {
  id: number;
  dropshipper_user_id: number;
  dropshipper_dni: string;
  dropshipper_email: string;
  dropshipper_name: string;
  dropshipper_fantasy_name: string | null;
  subscription_id: number | null;
  subscription_plan_name: string | null;
  bank_holder_name: string;
  bank_holder_cuit: string;
  bank_name: string;
  bank_cbu: string;
  bank_alias: string | null;
  refund_amount_arg: number | null;
  paid_subscription_total_arg: number | null;
  paid_subscription_count: number | null;
  abandonment_reason: string | null;
  reason: string | null;
  status: Status;
  transferred_at: string | null;
  transferred_by_email: string | null;
  transferred_note: string | null;
  integration_cancelled_at: string | null;
  integration_cancelled_by_email: string | null;
  integration_cancel_response: string | null;
  rejected_at: string | null;
  rejected_by_email: string | null;
  rejection_reason: string | null;
  submitter_ip: string | null;
  created_at: string;
  updated_at: string;
};

type Resp = {
  items: Request[];
  count: number;
  counts_by_status?: Record<Status | "all", number>;
};

type InvoiceUrlResp = { url: string | null; numero: string; total: number; fecha: string; tipo: string };

const ABANDONMENT_LABELS: Record<string, string> = {
  costo_muy_alto:               "Costo muy alto",
  sin_ventas_suficientes:       "Sin ventas suficientes",
  mala_experiencia_meli:        "Mala experiencia MELI",
  solo_tn:                      "Solo opera por TN",
  cierro_emprendimiento:        "Cierra emprendimiento",
  problemas_tecnicos_unidrop:   "Problemas técnicos Unidrop",
  otra:                         "Otra",
  no_especificada:              "No especificada (legacy)",
};

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  pending: {
    label: "Pendiente",
    color: "#f59e0b",
    bg: "bg-amber-50",
    border: "border-amber-300",
  },
  transferred: {
    label: "Transferido",
    color: "#3b82f6",
    bg: "bg-blue-50",
    border: "border-blue-300",
  },
  integration_cancelled: {
    label: "Integración cancelada",
    color: "#059669",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
  },
  rejected: {
    label: "Rechazada",
    color: "#94a3b8",
    bg: "bg-zinc-50",
    border: "border-zinc-300",
  },
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

function planToSku(planName: string | null): string {
  if (!planName) return "GEN";
  const lower = planName.toLowerCase();
  if (lower.includes("xxl")) return "XXL";
  if (lower.includes("escalada")) return "ESC";
  if (lower.includes("emprendedor")) return "EMP";
  if (lower.includes("crecimiento") || lower.includes("lanzamiento")) return "CRE";
  return planName.toUpperCase().replace(/[^A-Z0-9]/g, "") || "GEN";
}

function displayCode(r: Request): string {
  const sku = planToSku(r.subscription_plan_name);
  let dd = "00", mm = "00", aa = "00";
  try {
    const d = new Date(r.created_at);
    if (!Number.isNaN(d.getTime())) {
      dd = String(d.getDate()).padStart(2, "0");
      mm = String(d.getMonth() + 1).padStart(2, "0");
      aa = String(d.getFullYear() % 100).padStart(2, "0");
    }
  } catch {}
  return `UDEV-${r.dropshipper_dni}-${sku}-${dd}${mm}${aa}`;
}

export default function DevSuscripcionesPage() {
  const [view, setView] = useState<"transferencias" | "solicitudes">("transferencias");
  const [filter, setFilter] = useState<"all" | Status>("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["refund-requests", filter, debouncedSearch, fromDate, toDate],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter !== "all") p.set("status", filter);
      if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
      if (fromDate) p.set("from_date", fromDate);
      if (toDate) p.set("to_date", toDate);
      p.set("limit", "200");
      return api(`/api/refund-requests?${p.toString()}`);
    },
    staleTime: 15_000,
  });

  const items = data?.items || [];
  const counts = data?.counts_by_status ?? { pending: 0, transferred: 0, integration_cancelled: 0, rejected: 0, all: 0 };

  const clearFilters = () => {
    setSearch("");
    setFromDate("");
    setToDate("");
  };
  const hasFilters = !!debouncedSearch || !!fromDate || !!toDate;

  return (
    <>
      <Topbar
        title="Gestión de Devoluciones de Suscripción"
        subtitle="Solicitudes recibidas vía formulario público — transferir, cancelar integración MELI, archivar"
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="mb-4 inline-flex rounded-xl border border-border bg-soft p-1">
          <button onClick={() => setView("transferencias")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === "transferencias" ? "bg-violet-600 text-white" : "text-text-muted"}`}>Transferencias Cresium</button>
          <button onClick={() => setView("solicitudes")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === "solicitudes" ? "bg-violet-600 text-white" : "text-text-muted"}`}>Solicitudes</button>
        </div>
        {view === "transferencias" ? (
          <CresiumTransferPanel source="subscription" />
        ) : (
          <>
        <TodayPanel unit="unidrop" context="devoluciones" title="HOY · Dev. Suscripciones" />
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border flex-wrap">
            <TabBtn
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
              label="Pendientes"
              count={counts.pending}
            />
            <TabBtn
              active={filter === "transferred"}
              onClick={() => setFilter("transferred")}
              label="Transferidas"
              count={counts.transferred}
            />
            <TabBtn
              active={filter === "integration_cancelled"}
              onClick={() => setFilter("integration_cancelled")}
              label="Cerradas"
              count={counts.integration_cancelled}
            />
            <TabBtn
              active={filter === "rejected"}
              onClick={() => setFilter("rejected")}
              label="Rechazadas"
              count={counts.rejected}
            />
            <TabBtn active={filter === "all"} onClick={() => setFilter("all")} label="Todas" count={counts.all} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="DNI, nombre, email, fantasy…"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs outline-none focus:border-primary w-56"
              />
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Filter size={12} className="text-text-muted" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-border bg-surface text-text text-xs outline-none focus:border-primary"
                title="Desde"
              />
              <span className="text-text-muted">→</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-border bg-surface text-text text-xs outline-none focus:border-primary"
                title="Hasta"
              />
            </div>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-muted hover:text-text hover:bg-bg transition"
                title="Limpiar filtros"
              >
                <X size={11} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <Inbox size={32} className="mx-auto text-text-muted mb-3" />
            <div className="text-sm font-bold text-text">Sin solicitudes</div>
            <div className="text-xs text-text-muted mt-1">
              No hay solicitudes en este estado.
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </>
  );
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        active ? "bg-white text-primary shadow-sm" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className={`ml-1 text-[10px] ${active ? "text-primary/70" : "text-text-muted/60"}`}>({count})</span>
      )}
    </button>
  );
}

function RequestCard({ request: r }: { request: Request }) {
  const [open, setOpen] = useState(r.status === "pending");
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const meta = STATUS_META[r.status];
  const qc = useQueryClient();
  const me = getUser();
  const isAdmin = !!me?.is_admin || me?.role === "admin";

  const transferMut = useMutation({
    mutationFn: (body: { note: string | null; refund_amount_arg: number | null }) =>
      api(`/api/refund-requests/${r.id}/mark-transferred`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      setShowTransferModal(false);
    },
  });

  const rejectMut = useMutation({
    mutationFn: (body: { reason: string }) =>
      api(`/api/refund-requests/${r.id}/reject`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      setShowRejectModal(false);
    },
  });

  const cancelMut = useMutation({
    mutationFn: () =>
      api(`/api/refund-requests/${r.id}/cancel-integration`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      setShowCancelConfirm(false);
    },
  });

  const revertMut = useMutation({
    mutationFn: () =>
      api(`/api/refund-requests/${r.id}/revert-to-pending`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      api(`/api/refund-requests/${r.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      setShowDeleteConfirm(false);
    },
  });

  const { data: invoiceData } = useQuery<InvoiceUrlResp>({
    queryKey: ["refund-invoice", r.id],
    queryFn: () => api(`/api/refund-requests/${r.id}/invoice-url`),
    enabled: open,
    staleTime: 300_000,
  });

  return (
    <div className={`border-2 rounded-xl ${meta.bg} ${meta.border}`}>
      <div className="p-4 flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow flex-shrink-0"
          style={{ background: meta.color }}
        >
          <RotateCcw size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-0.5">
            <div className="text-sm font-bold text-text">
              {r.dropshipper_name}
              {r.dropshipper_fantasy_name && (
                <span className="text-text-muted font-normal"> · {r.dropshipper_fantasy_name}</span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-2 flex-wrap justify-end">
              <span>{meta.label}</span>
              <span className="font-mono normal-case tracking-normal bg-bg border border-border rounded px-1.5 py-0.5 text-[10px]">
                {displayCode(r)}
              </span>
              <span>· {fmtDate(r.created_at)}</span>
            </div>
          </div>
          <div className="text-xs text-text-muted">
            DNI {r.dropshipper_dni} · {r.dropshipper_email}
            {r.subscription_plan_name && <> · plan {r.subscription_plan_name}</>}
            {r.paid_subscription_total_arg != null && r.paid_subscription_total_arg > 0 && (
              <> · pagó <span className="font-semibold text-text">{fmtMoney(r.paid_subscription_total_arg)}</span> ({r.paid_subscription_count} cobros)</>
            )}
            {r.refund_amount_arg != null && (
              <> · solicita <span className="font-semibold text-text">{fmtMoney(r.refund_amount_arg)}</span></>
            )}
            {r.abandonment_reason && (
              <> · <span className="font-semibold text-text">{ABANDONMENT_LABELS[r.abandonment_reason] ?? r.abandonment_reason}</span></>
            )}
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
          {/* Datos bancarios */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Datos bancarios
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Field label="Titular" value={r.bank_holder_name} />
              <Field label="CUIT" value={r.bank_holder_cuit} copyable />
              <Field label="Banco" value={r.bank_name} />
              <Field label="CBU/CVU" value={r.bank_cbu} copyable mono />
              <Field label="Alias" value={r.bank_alias ?? "—"} copyable={!!r.bank_alias} />
              <Field label="Monto solicitado" value={fmtMoney(r.refund_amount_arg)} />
              <Field
                label="Total pagado en suscripción"
                value={
                  r.paid_subscription_total_arg != null
                    ? `${fmtMoney(r.paid_subscription_total_arg)} (${r.paid_subscription_count ?? 0} cobros)`
                    : "—"
                }
              />
              <Field
                label="Causa de abandono"
                value={
                  r.abandonment_reason
                    ? (ABANDONMENT_LABELS[r.abandonment_reason] ?? r.abandonment_reason)
                    : "—"
                }
              />
            </div>
          </div>

          {r.reason && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">
                Comentario adicional del dropshipper
              </div>
              <div className="text-xs text-text bg-bg border border-border rounded p-2 italic whitespace-pre-line">
                "{r.reason}"
              </div>
            </div>
          )}

          {/* Audit timeline */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
              Historial
            </div>
            <div className="space-y-1.5 text-xs">
              <TimelineItem
                label="Solicitud recibida"
                date={r.created_at}
                detail={r.submitter_ip ? `desde IP ${r.submitter_ip}` : null}
              />
              {r.transferred_at && (
                <TimelineItem
                  label="Transferencia marcada"
                  date={r.transferred_at}
                  detail={
                    [
                      r.transferred_by_email,
                      r.transferred_note ? `nota: "${r.transferred_note}"` : null,
                    ].filter(Boolean).join(" · ")
                  }
                />
              )}
              {r.integration_cancelled_at && (
                <TimelineItem
                  label="Integración MELI cancelada"
                  date={r.integration_cancelled_at}
                  detail={
                    [
                      r.integration_cancelled_by_email,
                      r.integration_cancel_response ? `respuesta: ${r.integration_cancel_response}` : null,
                    ].filter(Boolean).join(" · ")
                  }
                />
              )}
              {r.rejected_at && (
                <TimelineItem
                  label="Rechazada"
                  date={r.rejected_at}
                  detail={
                    [
                      r.rejected_by_email,
                      r.rejection_reason ? `razón: "${r.rejection_reason}"` : null,
                    ].filter(Boolean).join(" · ")
                  }
                />
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Link
              href={`/dashboard/dropshipper/${r.dropshipper_user_id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text hover:bg-bg transition"
            >
              <ExternalLink size={12} /> Vista 360
            </Link>

            {invoiceData?.url && (
              <InvoiceButton data={invoiceData} />
            )}

            {r.status === "pending" && (
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

            {r.status === "transferred" && (
              <>
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow hover:bg-red-700 transition"
                >
                  <AlertCircle size={12} /> Cancelar integración MELI
                </button>
                <button
                  onClick={() => {
                    if (confirm("¿Revertir esta solicitud a Pendiente? Se borrarán los datos de la transferencia (fecha, autor, nota). Útil solo para pruebas o corrección de errores.")) {
                      revertMut.mutate();
                    }
                  }}
                  disabled={revertMut.isPending}
                  title="Vuelve la solicitud al estado Pendiente (borra el audit de la transferencia)"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text hover:bg-bg text-xs font-semibold transition disabled:opacity-50"
                >
                  <RotateCcw size={12} /> {revertMut.isPending ? "Revirtiendo..." : "Revertir a Pendiente"}
                </button>
              </>
            )}

            {isAdmin && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                title="Eliminar definitivamente (solo admin)"
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 transition"
              >
                <Trash2 size={12} /> Eliminar
              </button>
            )}
          </div>

          {(transferMut.isError || rejectMut.isError || cancelMut.isError || revertMut.isError || deleteMut.isError) && (
            <div className="text-xs bg-red-50 border border-red-200 text-error rounded-lg px-3 py-2">
              {(transferMut.error as Error)?.message ??
                (rejectMut.error as Error)?.message ??
                (cancelMut.error as Error)?.message ??
                (revertMut.error as Error)?.message ??
                (deleteMut.error as Error)?.message}
            </div>
          )}
        </div>
      )}

      {showTransferModal && (
        <TransferModal
          loading={transferMut.isPending}
          onCancel={() => setShowTransferModal(false)}
          onConfirm={(note, amount) => transferMut.mutate({ note, refund_amount_arg: amount })}
          defaultAmount={r.refund_amount_arg}
        />
      )}
      {showRejectModal && (
        <RejectModal
          loading={rejectMut.isPending}
          onCancel={() => setShowRejectModal(false)}
          onConfirm={(reason) => rejectMut.mutate({ reason })}
        />
      )}
      {showCancelConfirm && (
        <CancelIntegrationModal
          loading={cancelMut.isPending}
          dropshipperUserId={r.dropshipper_user_id}
          dropshipperName={r.dropshipper_name}
          onCancel={() => setShowCancelConfirm(false)}
          onConfirm={() => cancelMut.mutate()}
        />
      )}
      {showDeleteConfirm && (
        <DeleteModal
          loading={deleteMut.isPending}
          dropshipperName={r.dropshipper_name}
          code={displayCode(r)}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => deleteMut.mutate()}
        />
      )}
    </div>
  );
}

function DeleteModal({
  loading, dropshipperName, code, onCancel, onConfirm,
}: {
  loading: boolean;
  dropshipperName: string;
  code: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={onCancel} title="Eliminar solicitud">
      <div className="space-y-3 text-sm text-text">
        <p>
          Vas a eliminar <span className="font-bold">{dropshipperName}</span>
          <span className="font-mono text-xs text-text-muted"> · {code}</span>.
        </p>
        <p className="text-xs text-text-muted">
          La acción es <span className="font-semibold text-red-700">irreversible</span>. Se borra el registro completo, incluido todo el audit. Usar solo para pruebas o duplicados sin valor histórico.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold"
        >
          Cancelar
        </button>
        <button
          disabled={loading}
          onClick={onConfirm}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow disabled:opacity-60"
        >
          {loading ? "Eliminando..." : "Eliminar definitivamente"}
        </button>
      </div>
    </ModalShell>
  );
}

function InvoiceButton({ data }: { data: InvoiceUrlResp }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = data.url && data.numero
    ? `${data.tipo ? data.tipo + " " : ""}${data.numero}`.trim()
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

  if (!data.url) return null;
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <a
        href={data.url}
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
  defaultAmount: number | null;
  onCancel: () => void;
  onConfirm: (note: string | null, amount: number | null) => void;
}) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : "");
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
            placeholder={defaultAmount != null ? "" : "Opcional"}
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
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold"
        >
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
          {loading ? "Guardando..." : "Confirmar transferencia"}
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
    <ModalShell onClose={onCancel} title="Rechazar solicitud">
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Razón del rechazo (mín 5 caracteres)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text outline-none focus:border-primary resize-none"
          placeholder="Ej: No corresponde devolución, suscripción ya cancelada por el dropshipper..."
        />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold"
        >
          Cancelar
        </button>
        <button
          disabled={loading || !valid}
          onClick={() => onConfirm(reason.trim())}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow disabled:opacity-60"
        >
          {loading ? "Rechazando..." : "Rechazar"}
        </button>
      </div>
    </ModalShell>
  );
}

function CancelIntegrationModal({
  loading, dropshipperUserId, dropshipperName, onCancel, onConfirm,
}: {
  loading: boolean;
  dropshipperUserId: number;
  dropshipperName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [openedUnidrop, setOpenedUnidrop] = useState(false);
  const unidropUrl = `https://unidrop.com.ar/panel/users/${dropshipperUserId}`;

  function handleOpenUnidrop() {
    window.open(unidropUrl, "_blank", "noopener,noreferrer");
    setOpenedUnidrop(true);
  }

  return (
    <ModalShell onClose={onCancel} title="Cancelar integración MELI">
      <div className="space-y-3">
        <div className="text-sm text-text">
          La desvinculación de Mercado Libre se hace manual desde el panel de
          Unidrop de <span className="font-bold">{dropshipperName}</span>.
        </div>
        <ol className="text-xs text-text-muted list-decimal list-inside space-y-1 bg-bg border border-border rounded p-3">
          <li>Abrí el panel del dropshipper (botón abajo).</li>
          <li>En el bloque <span className="font-semibold">Integraciones</span>, marcá el checkbox <span className="font-semibold">Mercado Libre</span> y apretá <span className="font-semibold">Desvincular</span>.</li>
          <li>Volvé acá y apretá <span className="font-semibold">Marcar como cancelada</span> para cerrar la solicitud.</li>
        </ol>
        <div className="text-[11px] text-text-muted">
          URL: <code className="bg-bg px-1.5 py-0.5 rounded font-mono">{unidropUrl}</code>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:bg-bg text-xs font-semibold"
        >
          Cerrar
        </button>
        <button
          onClick={handleOpenUnidrop}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition"
        >
          <ExternalLink size={12} /> Abrir panel Unidrop
        </button>
        <button
          disabled={loading || !openedUnidrop}
          onClick={onConfirm}
          title={!openedUnidrop ? "Primero abrí el panel de Unidrop y desvinculá MELI" : ""}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Marcando..." : "Marcar como cancelada"}
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
