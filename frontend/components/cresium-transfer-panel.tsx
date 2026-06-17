"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send, RefreshCw, AlertCircle, ShieldCheck, Loader2, X, Clock, Copy, MessageCircle, UserCog,
} from "lucide-react";
import { api } from "@/lib/api";

// Panel "Enviar a Cresium" embebido (estilo Unidev): 5 tabs por estado del
// payout, multi-select + envio masivo, SLA y acciones por fila.

type Source = "ml" | "subscription";

type Row = {
  key: string;
  source_type: "ml_return" | "subscription";
  ml_order_id?: number | null;
  return_idx?: number | null;
  subscription_refund_request_id?: number | null;
  order_id?: number | null;
  titular: string;
  dni: string;
  banco: string | null;
  cuenta: string | null;
  needs_bank?: boolean;
  monto: number;
  estado: string;
  error_category?: string | null;
  cresium_status?: string | null;
  tab: string;
  created_at: string | null;
  failure_reason?: string | null;
  cresium_transaction_id?: string | null;
  receipt_url?: string | null;
};

type TabTotal = { count: number; monto: number };
type Resp = { rows: Row[]; counts: Record<string, number>; totals: Record<string, TabTotal> };
type Health = { enabled: boolean };
type PedirResult = { link: string; message: string; email?: string | null; dropshipper_name?: string | null };

const TABS: { v: string; l: string }[] = [
  { v: "pendiente", l: "Pendiente" },
  { v: "en_cresium", l: "En Cresium" },
  { v: "error_cliente", l: "Errores cliente" },
  { v: "error_cresium", l: "Errores Cresium" },
  { v: "realizada", l: "Realizadas" },
];

const TONE: Record<string, { bg: string; text: string }> = {
  amber: { bg: "bg-amber-100", text: "text-amber-700" },
  cyan: { bg: "bg-cyan-100", text: "text-cyan-700" },
  indigo: { bg: "bg-indigo-100", text: "text-indigo-700" },
  emerald: { bg: "bg-emerald-100", text: "text-emerald-700" },
  red: { bg: "bg-red-100", text: "text-red-700" },
  zinc: { bg: "bg-zinc-100", text: "text-zinc-600" },
};

// Estado informativo por fila: label + "qué está pasando / qué hacer".
function stateInfo(r: Row): { label: string; hint: string; tone: keyof typeof TONE } {
  const cs = (r.cresium_status || "").toUpperCase();
  switch (r.estado) {
    case "pendiente":
      return { label: "Pendiente", hint: r.needs_bank ? "Falta cargar datos bancarios" : "Lista para enviar a Cresium", tone: "amber" };
    case "PENDING_VERIFICATION":
      return { label: "Pendiente de verificar", hint: "Falta validar la cuenta contra Cresium", tone: "amber" };
    case "READY_TO_TRANSFER":
      return { label: "Lista para enviar", hint: "Cuenta verificada · falta enviar a Cresium", tone: "amber" };
    case "SUBMITTING":
      return { label: "Enviando…", hint: "Creando la transferencia en Cresium", tone: "cyan" };
    case "SIGNATURE_REQUEST_CREATED":
      if (cs === "PROCESSING" || cs === "PENDING")
        return { label: "Procesando acreditación", hint: "El firmante aprobó · Cresium está acreditando", tone: "cyan" };
      return { label: "Esperando firma", hint: "Falta que el firmante la apruebe con token en el panel de Cresium", tone: "indigo" };
    case "PROCESSING":
      return { label: "Procesando acreditación", hint: "El firmante aprobó · Cresium está acreditando", tone: "cyan" };
    case "SUCCESS":
      return { label: "Transferida", hint: "Acreditada al dropshipper", tone: "emerald" };
    case "FAILED":
      return r.error_category === "cliente"
        ? { label: "Datos a corregir", hint: r.failure_reason || "La cuenta no verificó (titular/CBU/alias)", tone: "red" }
        : { label: "Rechazada por Cresium", hint: r.failure_reason || "Cresium/banco rechazó la transferencia", tone: "red" };
    case "CANCELED":
      return { label: "Cancelada por el firmante", hint: "El firmante rechazó la transferencia en Cresium", tone: "zinc" };
    default:
      return { label: r.estado, hint: "", tone: "zinc" };
  }
}

const SLA_HOURS = 48;
function sla(createdAt: string | null): { label: string; cls: string } | null {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const elapsedH = (Date.now() - created) / 36e5;
  const leftH = SLA_HOURS - elapsedH;
  if (leftH <= 0) return { label: "Vencido", cls: "bg-zinc-200 text-zinc-600" };
  if (leftH < 6) return { label: `${Math.ceil(leftH)}h`, cls: "bg-red-100 text-red-700" };
  if (leftH < 24) return { label: `${Math.ceil(leftH)}h`, cls: "bg-amber-100 text-amber-700" };
  return { label: `${Math.ceil(leftH / 24)}d`, cls: "bg-emerald-100 text-emerald-700" };
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);
}
function fmtMoneyFull(v: number | null | undefined): string {
  if (v == null) return "$0";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(v);
}

function KpiCard({ title, monto, sub, tone }: { title: string; monto: number | undefined; sub: string; tone: "violet" | "amber" | "emerald" }) {
  const map = {
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${map[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{title}</div>
      <div className="mt-1 text-2xl font-bold">{fmtMoneyFull(monto)}</div>
      <div className="mt-0.5 text-xs opacity-70">{sub}</div>
    </div>
  );
}

function itemFromRow(r: Row): object {
  return r.source_type === "ml_return"
    ? { source_type: "ml_return", ml_order_id: r.ml_order_id, return_idx: r.return_idx ?? 1 }
    : { source_type: "subscription", subscription_refund_request_id: r.subscription_refund_request_id };
}

export function CresiumTransferPanel({ source }: { source: Source }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pedir, setPedir] = useState<PedirResult | null>(null);

  const { data: health } = useQuery<Health>({
    queryKey: ["cresium-health"],
    queryFn: () => api("/api/cresium-payouts/health"),
    staleTime: 60_000,
  });
  const enabled = !!health?.enabled;

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["cresium-transferencias", source, tab, search],
    queryFn: () => {
      const p = new URLSearchParams({ source, tab });
      if (search.trim()) p.set("search", search.trim());
      return api(`/api/cresium-payouts/transferencias?${p.toString()}`);
    },
    staleTime: 10_000,
  });
  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cresium-transferencias", source] });

  const isRetry = tab === "error_cliente" || tab === "error_cresium";
  const bulkable = tab === "pendiente" || isRetry;

  const sendMut = useMutation({
    mutationFn: (items: object[]) => api("/api/cresium-payouts/send", { method: "POST", body: JSON.stringify({ items }) }),
    onSuccess: () => { setSelected(new Set()); setConfirmOpen(false); invalidate(); },
  });
  const retryMut = useMutation({
    mutationFn: (orderId: number) => api(`/api/cresium-payouts/orders/${orderId}/reintentar`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const pedirMut = useMutation({
    mutationFn: (orderId: number) => api<PedirResult>(`/api/cresium-payouts/orders/${orderId}/pedir-datos`, { method: "POST" }),
    onSuccess: (d) => { setPedir(d); invalidate(); },
  });
  const retryBulkMut = useMutation({
    mutationFn: (ids: number[]) => api("/api/cresium-payouts/reintentar", { method: "POST", body: JSON.stringify({ order_ids: ids }) }),
    onSuccess: () => { setSelected(new Set()); setConfirmOpen(false); invalidate(); },
  });
  const bulkPending = sendMut.isPending || retryBulkMut.isPending;
  const bulkData = isRetry ? retryBulkMut.data : sendMut.data;

  const selectableKeys = useMemo(
    () => rows.filter((r) => (isRetry ? !!r.order_id : !r.needs_bank)).map((r) => r.key),
    [rows, isRetry],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));
  const selectedRows = rows.filter((r) => selected.has(r.key));
  const selectedTotal = selectedRows.reduce((s, r) => s + (r.monto || 0), 0);

  function toggle(k: string) {
    setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set<string>() : new Set(selectableKeys));
  }
  function doBulk() {
    if (isRetry) {
      const ids = selectedRows.map((r) => r.order_id).filter((x): x is number => typeof x === "number");
      if (ids.length) retryBulkMut.mutate(ids);
    } else {
      const items = selectedRows.map(itemFromRow);
      if (items.length) sendMut.mutate(items);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {!enabled && (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Cresium <b>deshabilitado</b> — podés ver el estado pero el botón “Enviar a Cresium” está bloqueado hasta cargar los secrets <code>CRESIUM_*</code> y prender el flag.</span>
        </div>
      )}

      {/* KPIs financieros */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-4 sm:grid-cols-3">
        <KpiCard title="Pendiente de transferir" monto={totals.pendiente?.monto} sub={`${totals.pendiente?.count ?? 0} reintegros por enviar`} tone="violet" />
        <KpiCard title="En curso (Cresium)" monto={totals.en_cresium?.monto} sub={`${totals.en_cresium?.count ?? 0} esperando acreditación`} tone="amber" />
        <KpiCard title="Transferido" monto={totals.realizada?.monto} sub={`${totals.realizada?.count ?? 0} realizadas`} tone="emerald" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pt-4">
        {TABS.map((t) => (
          <button
            key={t.v}
            onClick={() => { setTab(t.v); setSelected(new Set()); }}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium ${tab === t.v ? "bg-violet-600 text-white" : "bg-bg text-text-muted hover:text-text"}`}
          >
            {t.l} <span className="opacity-70">({counts[t.v] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          {bulkable && (
            <button onClick={toggleAll} disabled={!selectableKeys.length} className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm font-medium text-text disabled:opacity-40">
              {allSelected ? "Deseleccionar" : `Seleccionar todas (${selectableKeys.length})`}
            </button>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="DNI, titular, CBU…"
            className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
        </div>
        {bulkable && (
          <div className="flex items-center gap-3">
            {selected.size > 0 && (
              <span className="text-sm text-text-muted">
                Seleccionadas <b className="text-text">{selected.size}</b> · acumulado{" "}
                <b className="text-violet-700">{fmtMoneyFull(selectedTotal)}</b>
              </span>
            )}
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!enabled || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              title={!enabled ? "Cresium deshabilitado" : isRetry ? "Reintentar las seleccionadas" : "Enviar las seleccionadas a Cresium"}
            >
              {isRetry ? <RefreshCw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {isRetry ? "Reintentar" : "Enviar a Cresium"} ({selected.size})
            </button>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-xs uppercase text-text-muted">
            <tr>
              {bulkable && <th className="w-10 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>}
              <th className="px-3 py-2">Titular</th>
              <th className="px-3 py-2">Banco</th>
              <th className="px-3 py-2">CBU/Alias</th>
              <th className="px-3 py-2">Monto</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">SLA</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="py-8 text-center text-text-muted">Cargando…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-text-muted">Sin devoluciones en este estado.</td></tr>}
            {rows.map((r) => {
              const si = stateInfo(r);
              const tone = TONE[si.tone];
              const s = sla(r.created_at);
              return (
                <tr key={r.key} className="border-t border-border">
                  {bulkable && (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(r.key)} disabled={isRetry ? !r.order_id : r.needs_bank} onChange={() => toggle(r.key)} title={!isRetry && r.needs_bank ? "Sin datos bancarios" : ""} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{r.titular || "—"}</div>
                    <div className="text-xs text-text-muted">DNI {r.dni || "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.banco || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {r.needs_bank ? <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">Sin datos</span> : (r.cuenta || "—")}
                  </td>
                  <td className="px-3 py-2 font-semibold text-text">{fmtMoney(r.monto)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}>{si.label}</span>
                    {si.hint && <div className="mt-0.5 max-w-[260px] text-[11px] leading-tight text-text-muted" title={si.hint}>{si.hint}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {s ? <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${s.cls}`}><Clock className="h-3 w-3" />{s.label}</span> : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {tab === "error_cliente" && r.source_type === "subscription" && r.order_id && (
                        <button
                          onClick={() => pedirMut.mutate(r.order_id!)}
                          disabled={pedirMut.isPending}
                          className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 disabled:opacity-40"
                          title="Generar link para que el dropshipper corrija sus datos bancarios"
                        >
                          {pedirMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCog className="h-3 w-3" />}
                          Pedir datos
                        </button>
                      )}
                      {(tab === "error_cliente" || tab === "error_cresium") && r.order_id && enabled && (
                        <button
                          onClick={() => retryMut.mutate(r.order_id!)}
                          disabled={retryMut.isPending}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-40"
                        >
                          {retryMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {tab === "error_cliente" ? "Re-verificar" : "Reintentar"}
                        </button>
                      )}
                      {tab === "realizada" && r.cresium_transaction_id && <span className="text-xs text-text-muted">tx {r.cresium_transaction_id}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(sendMut.isError || retryMut.isError) && (
        <p className="px-4 pb-3 text-sm text-red-600">{((sendMut.error || retryMut.error) as Error)?.message}</p>
      )}

      {/* ConfirmModal: mueve plata real */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-text"><ShieldCheck className="h-5 w-5 text-violet-600" /> {isRetry ? "Reintentar transferencias" : "Enviar a Cresium"}</h3>
              <button onClick={() => setConfirmOpen(false)} className="text-text-muted hover:text-text"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-3 text-sm text-text-muted">
              Vas a {isRetry ? "reintentar" : "enviar"} <b className="text-text">{selected.size}</b> transferencia(s) por <b className="text-text">{fmtMoneyFull(selectedTotal)}</b> a Cresium.
              Cada cuenta se verifica; las que no validen quedan en <b>Errores cliente</b>. <b className="text-red-600">Esta acción mueve dinero real</b> (un firmante de Cresium aprueba cada una con token).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-text">Cancelar</button>
              <button onClick={doBulk} disabled={bulkPending} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {bulkPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isRetry ? <RefreshCw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {isRetry ? "Confirmar y reintentar" : "Confirmar y enviar"}
              </button>
            </div>
            {bulkData ? (
              <p className="mt-3 text-sm text-emerald-700">{((bulkData as { enviados?: number; reintentadas?: number }).enviados ?? (bulkData as { reintentadas?: number }).reintentadas ?? 0)}/{(bulkData as { total: number }).total} procesadas.</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Pedir datos al cliente: link + WhatsApp + copiar */}
      {pedir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-text"><UserCog className="h-5 w-5 text-violet-600" /> Pedir datos al dropshipper</h3>
              <button onClick={() => setPedir(null)} className="text-text-muted hover:text-text"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-3 text-sm text-text-muted">
              Generamos un link seguro para que <b className="text-text">{pedir.dropshipper_name || "el dropshipper"}</b> corrija sus datos bancarios. Cuando los actualice, la devolución vuelve a la cola automáticamente.
            </p>

            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
              <span className="flex-1 truncate font-mono text-xs text-text-muted">{pedir.link}</span>
              <CopyBtn text={pedir.link} label="Copiar link" />
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(pedir.message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" /> Enviar por WhatsApp
              </a>
              <CopyBtn text={pedir.message} label="Copiar mensaje" full />
            </div>

            <p className="mt-3 text-xs text-text-muted">El link expira cuando la devolución se procesa. Si el dropshipper carga datos válidos, se transfiere sin intervención.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyBtn({ text, label, full }: { text: string; label: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text ${full ? "w-full" : ""}`}
    >
      <Copy className="h-3.5 w-3.5" /> {copied ? "Copiado ✓" : label}
    </button>
  );
}
