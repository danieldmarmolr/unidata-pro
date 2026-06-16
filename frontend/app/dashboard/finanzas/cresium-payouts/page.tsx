"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, AlertCircle, ShieldCheck,
  Send, RefreshCw, Inbox, Loader2,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type PayoutStatus =
  | "PENDING_VERIFICATION" | "READY_TO_TRANSFER" | "SIGNATURE_REQUEST_CREATED"
  | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELED";

type Order = {
  id: number;
  source_type: "ml_return" | "subscription";
  ml_order_id: number | null;
  return_idx: number | null;
  subscription_refund_request_id: number | null;
  dropshipper_user_id: number | null;
  dropshipper_dni: string | null;
  dropshipper_name: string | null;
  amount: number;
  currency: string;
  status: PayoutStatus;
  recipient_cbu: string | null;
  recipient_cvu: string | null;
  recipient_alias: string | null;
  recipient_holder_name: string | null;
  cresium_to_id: string | null;
  cresium_transaction_id: string | null;
  failure_reason: string | null;
  created_at: string;
};

type Batch = {
  id: number;
  created_by_email: string | null;
  status: "draft" | "confirmed" | "done";
  note: string | null;
  orders_count: number;
  total_amount: number;
  created_at: string;
  confirmed_at: string | null;
};

type Health = { enabled: boolean; polling_enabled: boolean; base_url: string; webhook_public_url: string | null };

type MlItem = {
  ml_order_id: number;
  amount_to_refund: number;
  dropshipper: { user_id: number | null; dni: string; name: string };
  bank: { cbu: string | null; cvu: string | null; alias: string | null; needs_bank: boolean } | null;
};
type MlResp = { items: MlItem[] };

type SubItem = {
  id: number;
  dropshipper_user_id: number;
  dropshipper_dni: string;
  dropshipper_name: string;
  refund_amount_arg: number | null;
  bank_cbu: string;
  bank_alias: string | null;
};
type SubResp = { items: SubItem[] };

const STATUS_META: Record<PayoutStatus, { label: string; bg: string; text: string }> = {
  PENDING_VERIFICATION:      { label: "Pend. verificación",  bg: "bg-amber-100",   text: "text-amber-700" },
  READY_TO_TRANSFER:         { label: "Lista p/ enviar",     bg: "bg-blue-100",    text: "text-blue-700" },
  SIGNATURE_REQUEST_CREATED: { label: "Esperando firma",     bg: "bg-indigo-100",  text: "text-indigo-700" },
  PROCESSING:                { label: "Procesando",          bg: "bg-cyan-100",    text: "text-cyan-700" },
  SUCCESS:                   { label: "Transferida",         bg: "bg-emerald-100", text: "text-emerald-700" },
  FAILED:                    { label: "Falló",               bg: "bg-red-100",     text: "text-red-700" },
  CANCELED:                  { label: "Cancelada",           bg: "bg-zinc-100",    text: "text-zinc-600" },
};

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}
function bankLabel(o: Pick<Order, "recipient_cbu" | "recipient_cvu" | "recipient_alias">): string {
  return o.recipient_cbu || o.recipient_cvu || o.recipient_alias || "—";
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CresiumPayoutsPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState<"ml_return" | "subscription">("ml_return");
  const [selectedMl, setSelectedMl] = useState<Set<number>>(new Set());
  const [selectedSub, setSelectedSub] = useState<Set<number>>(new Set());
  const [openBatch, setOpenBatch] = useState<number | null>(null);

  const { data: health } = useQuery<Health>({
    queryKey: ["cresium-health"],
    queryFn: () => api("/api/cresium-payouts/health"),
    staleTime: 60_000,
  });

  const { data: ml, isLoading: mlLoading } = useQuery<MlResp>({
    queryKey: ["cresium-pick-ml"],
    queryFn: () => api("/api/ml-return-actions?tab=TRANSFERENCIA_PENDIENTE&limit=200"),
    enabled: source === "ml_return",
    staleTime: 15_000,
  });
  const { data: subs, isLoading: subLoading } = useQuery<SubResp>({
    queryKey: ["cresium-pick-sub"],
    queryFn: () => api("/api/refund-requests?status=pending&limit=200"),
    enabled: source === "subscription",
    staleTime: 15_000,
  });

  const { data: batchesResp } = useQuery<{ batches: Batch[] }>({
    queryKey: ["cresium-batches"],
    queryFn: () => api("/api/cresium-payouts/batches"),
    staleTime: 10_000,
  });
  const batches = batchesResp?.batches ?? [];

  const buildBatch = useMutation({
    mutationFn: (items: object[]) =>
      api("/api/cresium-payouts/batches", { method: "POST", body: JSON.stringify({ items }) }),
    onSuccess: () => {
      setSelectedMl(new Set());
      setSelectedSub(new Set());
      qc.invalidateQueries({ queryKey: ["cresium-batches"] });
    },
  });

  const selectedCount = source === "ml_return" ? selectedMl.size : selectedSub.size;
  const selectedTotal = useMemo(() => {
    if (source === "ml_return") {
      return (ml?.items ?? []).filter((i) => selectedMl.has(i.ml_order_id)).reduce((s, i) => s + (i.amount_to_refund || 0), 0);
    }
    return (subs?.items ?? []).filter((i) => selectedSub.has(i.id)).reduce((s, i) => s + (i.refund_amount_arg || 0), 0);
  }, [source, ml, subs, selectedMl, selectedSub]);

  function onBuild() {
    let items: object[];
    if (source === "ml_return") {
      items = [...selectedMl].map((ml_order_id) => ({ source_type: "ml_return", ml_order_id }));
    } else {
      items = [...selectedSub].map((id) => ({ source_type: "subscription", subscription_refund_request_id: id }));
    }
    if (items.length) buildBatch.mutate(items);
  }

  return (
    <>
      <Topbar
        title="Transferencias masivas — Cresium"
        subtitle="Armá lotes de devoluciones (ML + suscripciones), previsualizá montos y cuentas, y enviá a Cresium con confirmación humana."
        hidePeriod
      />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <HealthBanner health={health} />

        {/* ── Seleccionar devoluciones ── */}
        <section className="mb-8 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => setSource("ml_return")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${source === "ml_return" ? "bg-violet-600 text-white" : "bg-bg text-text-muted"}`}
            >
              Devoluciones ML (a transferir)
            </button>
            <button
              onClick={() => setSource("subscription")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${source === "subscription" ? "bg-violet-600 text-white" : "bg-bg text-text-muted"}`}
            >
              Suscripciones (pendientes)
            </button>
          </div>

          {source === "ml_return" ? (
            <PickList
              loading={mlLoading}
              rows={(ml?.items ?? []).map((i) => ({
                key: i.ml_order_id,
                name: i.dropshipper.name,
                dni: i.dropshipper.dni,
                amount: i.amount_to_refund,
                bank: i.bank?.cbu || i.bank?.cvu || i.bank?.alias || null,
                needsBank: i.bank?.needs_bank ?? true,
              }))}
              selected={selectedMl}
              onToggle={(k) => setSelectedMl((s) => toggle(s, k))}
              onAll={(keys, on) => setSelectedMl((s) => bulk(s, keys, on))}
            />
          ) : (
            <PickList
              loading={subLoading}
              rows={(subs?.items ?? []).map((i) => ({
                key: i.id,
                name: i.dropshipper_name,
                dni: i.dropshipper_dni,
                amount: i.refund_amount_arg ?? 0,
                bank: i.bank_cbu || i.bank_alias || null,
                needsBank: !(i.bank_cbu || i.bank_alias),
              }))}
              selected={selectedSub}
              onToggle={(k) => setSelectedSub((s) => toggle(s, k))}
              onAll={(keys, on) => setSelectedSub((s) => bulk(s, keys, on))}
            />
          )}

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-text-muted">
              {selectedCount} seleccionadas · <span className="font-semibold text-text">{fmtMoney(selectedTotal)}</span>
            </span>
            <button
              onClick={onBuild}
              disabled={!selectedCount || buildBatch.isPending}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {buildBatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
              Armar lote ({selectedCount})
            </button>
          </div>
          {buildBatch.isError && (
            <p className="mt-2 text-sm text-red-600">{(buildBatch.error as Error)?.message}</p>
          )}
        </section>

        {/* ── Lotes ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-text">Lotes</h2>
          {batches.length === 0 && <p className="text-sm text-text-muted">Todavía no armaste ningún lote.</p>}
          <div className="space-y-3">
            {batches.map((b) => (
              <BatchCard
                key={b.id}
                batch={b}
                open={openBatch === b.id}
                onToggle={() => setOpenBatch((cur) => (cur === b.id ? null : b.id))}
                cresiumEnabled={!!health?.enabled}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function HealthBanner({ health }: { health: Health | undefined }) {
  if (!health) return null;
  if (health.enabled) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
        <ShieldCheck className="h-4 w-4" /> Cresium activo — las transferencias se ejecutan realmente.
      </div>
    );
  }
  return (
    <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Cresium <b>deshabilitado</b>. Podés armar y previsualizar lotes, pero no se envía ninguna transferencia
        hasta cargar los secrets <code>CRESIUM_*</code> y poner <code>FEATURE_CRESIUM_REFUNDS_ENABLED=true</code>.
      </span>
    </div>
  );
}

type PickRow = { key: number; name: string; dni: string; amount: number; bank: string | null; needsBank: boolean };

function PickList({
  loading, rows, selected, onToggle, onAll,
}: {
  loading: boolean; rows: PickRow[]; selected: Set<number>;
  onToggle: (k: number) => void; onAll: (keys: number[], on: boolean) => void;
}) {
  if (loading) return <p className="py-6 text-center text-sm text-text-muted">Cargando…</p>;
  if (!rows.length) return <p className="py-6 text-center text-sm text-text-muted">No hay devoluciones pendientes.</p>;
  const allKeys = rows.map((r) => r.key);
  const allOn = allKeys.every((k) => selected.has(k));
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-bg text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="w-10 px-3 py-2">
              <input type="checkbox" checked={allOn} onChange={(e) => onAll(allKeys, e.target.checked)} />
            </th>
            <th className="px-3 py-2">Dropshipper</th>
            <th className="px-3 py-2">Monto</th>
            <th className="px-3 py-2">Cuenta destino</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border hover:bg-bg/50">
              <td className="px-3 py-2">
                <input type="checkbox" checked={selected.has(r.key)} onChange={() => onToggle(r.key)} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-text">{r.name || "—"}</div>
                <div className="text-xs text-text-muted">DNI {r.dni || "—"}</div>
              </td>
              <td className="px-3 py-2 font-semibold text-text">{fmtMoney(r.amount)}</td>
              <td className="px-3 py-2">
                {r.needsBank ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Sin datos bancarios</span>
                ) : (
                  <span className="font-mono text-xs text-text-muted">{r.bank}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: PayoutStatus }) {
  const m = STATUS_META[status];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>{m.label}</span>;
}

function BatchCard({
  batch, open, onToggle, cresiumEnabled,
}: {
  batch: Batch; open: boolean; onToggle: () => void; cresiumEnabled: boolean;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ batch: Batch; orders: Order[] }>({
    queryKey: ["cresium-batch", batch.id],
    queryFn: () => api(`/api/cresium-payouts/batches/${batch.id}`),
    enabled: open,
    staleTime: 5_000,
  });
  const orders = data?.orders ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cresium-batch", batch.id] });
    qc.invalidateQueries({ queryKey: ["cresium-batches"] });
  };
  const verify = useMutation({
    mutationFn: () => api(`/api/cresium-payouts/batches/${batch.id}/verify`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const confirm = useMutation({
    mutationFn: () => api(`/api/cresium-payouts/batches/${batch.id}/confirm`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const readyCount = orders.filter((o) => o.status === "READY_TO_TRANSFER").length;
  const pendingCount = orders.filter((o) => o.status === "PENDING_VERIFICATION").length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-semibold text-text">Lote #{batch.id}</span>
          <span className="text-sm text-text-muted">{batch.orders_count} órdenes · {fmtMoney(batch.total_amount)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-bg px-2 py-0.5 text-xs text-text-muted">{batch.status}</span>
          <span className="text-xs text-text-muted">{fmtDate(batch.created_at)}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          {isLoading ? (
            <p className="text-sm text-text-muted">Cargando órdenes…</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => verify.mutate()}
                  disabled={!cresiumEnabled || pendingCount === 0 || verify.isPending}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm font-medium text-text disabled:opacity-40"
                  title={!cresiumEnabled ? "Cresium deshabilitado" : "Verificar cuentas contra Cresium"}
                >
                  {verify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Verificar cuentas ({pendingCount})
                </button>
                <button
                  onClick={() => confirm.mutate()}
                  disabled={!cresiumEnabled || readyCount === 0 || confirm.isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                  title={!cresiumEnabled ? "Cresium deshabilitado" : "Enviar transferencias a Cresium"}
                >
                  {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Confirmar y enviar ({readyCount})
                </button>
                {(verify.isError || confirm.isError) && (
                  <span className="text-sm text-red-600">
                    {((verify.error || confirm.error) as Error)?.message}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg text-left text-xs uppercase text-text-muted">
                    <tr>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Origen</th>
                      <th className="px-3 py-2">Dropshipper</th>
                      <th className="px-3 py-2">Monto</th>
                      <th className="px-3 py-2">Cuenta</th>
                      <th className="px-3 py-2">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-t border-border">
                        <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                        <td className="px-3 py-2 text-xs text-text-muted">
                          {o.source_type === "ml_return" ? "ML" : "Suscripción"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-text">{o.dropshipper_name || "—"}</div>
                          <div className="text-xs text-text-muted">DNI {o.dropshipper_dni || "—"}</div>
                        </td>
                        <td className="px-3 py-2 font-semibold text-text">{fmtMoney(o.amount)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-text-muted">{bankLabel(o)}</td>
                        <td className="px-3 py-2 text-xs">
                          {o.failure_reason ? (
                            <span className="text-red-600">{o.failure_reason}</span>
                          ) : o.cresium_transaction_id ? (
                            <span className="text-text-muted">tx {o.cresium_transaction_id}</span>
                          ) : o.status === "PENDING_VERIFICATION" ? (
                            <span className="text-amber-600">falta verificar cuenta</span>
                          ) : (
                            "—"
                          )}
                          {o.status === "FAILED" && cresiumEnabled && (
                            <RetryButton orderId={o.id} onDone={invalidate} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RetryButton({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const retry = useMutation({
    mutationFn: () => api(`/api/cresium-payouts/orders/${orderId}/retry`, { method: "POST" }),
    onSuccess: onDone,
  });
  return (
    <button
      onClick={() => retry.mutate()}
      disabled={retry.isPending}
      className="ml-2 inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-text disabled:opacity-40"
    >
      {retry.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      Reintentar
    </button>
  );
}

// ─── Helpers de selección ──────────────────────────────────────────────────────

function toggle(s: Set<number>, k: number): Set<number> {
  const n = new Set(s);
  if (n.has(k)) n.delete(k); else n.add(k);
  return n;
}
function bulk(s: Set<number>, keys: number[], on: boolean): Set<number> {
  const n = new Set(s);
  for (const k of keys) { if (on) n.add(k); else n.delete(k); }
  return n;
}
