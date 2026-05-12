"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, Check, RotateCcw, X, ChevronDown, ChevronRight, Inbox, Hand } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

type Action = {
  id: number;
  source_type: "rfm_segment" | "rfm_flow" | "manual";
  source_key: string;
  unit: "unistore" | "unidrop";
  title: string;
  suggested_action: string;
  target_ids: number[];
  target_count: number;
  metadata?: Record<string, any>;
  status: "pending" | "doing" | "done" | "cancelled";
  assigned_to: number | null;
  created_by: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type Resp = {
  items: Action[];
  pending_count: number;
  pending_unistore: number;
  pending_unidrop: number;
};

const STATUS_META: Record<Action["status"], { label: string; color: string; bg: string }> = {
  pending: { label: "Pendiente", color: "#7a3eae", bg: "bg-violet-50 border-violet-300" },
  doing: { label: "En curso", color: "#f59e0b", bg: "bg-amber-50 border-amber-300" },
  done: { label: "Hecha", color: "#059669", bg: "bg-emerald-50 border-emerald-300" },
  cancelled: { label: "Cancelada", color: "#94a3b8", bg: "bg-zinc-50 border-zinc-300" },
};

export default function CsAccionesPage() {
  const [filter, setFilter] = useState<"open" | "pending" | "doing" | "done" | "all">("open");
  const [unit, setUnit] = useState<"all" | "unistore" | "unidrop">("all");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["cs-actions", filter, unit],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter !== "open" && filter !== "all") p.set("status", filter);
      if (unit !== "all") p.set("unit", unit);
      return api(`/api/cs-actions?${p.toString()}`);
    },
    staleTime: 20_000,
  });

  const items = (data?.items || []).filter((a) => {
    if (filter === "open") return a.status === "pending" || a.status === "doing";
    if (filter === "all") return true;
    return a.status === filter;
  });

  const takeMut = useMutation({
    mutationFn: (id: number) => api(`/api/cs-actions/${id}/take`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cs-actions"] }),
  });
  const completeMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api(`/api/cs-actions/${id}/complete`, { method: "POST", body: JSON.stringify({ note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cs-actions"] }),
  });
  const cancelMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api(`/api/cs-actions/${id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cs-actions"] }),
  });

  return (
    <>
      <Topbar
        title="Bandeja CS"
        subtitle="Acciones generadas desde modales del dashboard - segmentar, contactar, hacer seguimiento"
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border flex-wrap">
            <TabBtn active={filter === "open"} onClick={() => setFilter("open")} label={`Abiertas${data ? ` (${data.pending_count})` : ""}`} />
            <TabBtn active={filter === "pending"} onClick={() => setFilter("pending")} label="Pendientes" />
            <TabBtn active={filter === "doing"} onClick={() => setFilter("doing")} label="En curso" />
            <TabBtn active={filter === "done"} onClick={() => setFilter("done")} label="Hechas" />
            <TabBtn active={filter === "all"} onClick={() => setFilter("all")} label="Todas" />
          </div>
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border">
            <TabBtn active={unit === "all"} onClick={() => setUnit("all")} label="Todas" />
            <TabBtn active={unit === "unistore"} onClick={() => setUnit("unistore")} label="Unistore" />
            <TabBtn active={unit === "unidrop"} onClick={() => setUnit("unidrop")} label="Unidrop" />
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
            <div className="text-sm font-bold text-text">Bandeja vacia</div>
            <div className="text-xs text-text-muted mt-1">
              No hay acciones {filter !== "all" ? STATUS_META[filter as keyof typeof STATUS_META]?.label?.toLowerCase() ?? filter : ""} para mostrar.
              Generalas desde los modales de RFM, Flujos, Devoluciones, etc.
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                onTake={() => takeMut.mutate(a.id)}
                onComplete={(note) => completeMut.mutate({ id: a.id, note })}
                onCancel={(note) => cancelMut.mutate({ id: a.id, note })}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ActionCard({
  action: a, onTake, onComplete, onCancel,
}: {
  action: Action;
  onTake: () => void;
  onComplete: (note: string) => void;
  onCancel: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const meta = STATUS_META[a.status];

  return (
    <div className={`border-2 rounded-xl ${a.status === "done" || a.status === "cancelled" ? "bg-surface border-border opacity-70" : meta.bg}`}>
      <div className="p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow flex-shrink-0" style={{ background: meta.color }}>
          <Target size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-0.5">
            <div className="text-sm font-bold text-text">{a.title}</div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">
              {meta.label} · {a.unit} · #{a.id} · {fmtDate(a.created_at)}
            </div>
          </div>
          <div className="text-xs text-text-muted">
            {a.target_count} {a.unit === "unidrop" ? "dropshippers" : "clientes"} · origen: {a.source_type} ({a.source_key})
          </div>
          {a.notes && (
            <div className="mt-1.5 text-[11px] text-text bg-surface/70 border border-border rounded p-2 italic">
              "{a.notes}"
            </div>
          )}
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
        <div className="border-t border-border bg-surface/50 p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Accion sugerida</div>
            <div className="text-xs text-text whitespace-pre-line">{a.suggested_action}</div>
          </div>

          {a.target_ids && a.target_ids.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">
                IDs ({a.target_ids.length})
              </div>
              <div className="text-[11px] text-text-muted font-mono break-all max-h-20 overflow-y-auto">
                {a.target_ids.slice(0, 80).join(", ")}
                {a.target_ids.length > 80 && ` ... (+${a.target_ids.length - 80} mas)`}
              </div>
            </div>
          )}

          {(a.status === "pending" || a.status === "doing") && (
            <div className="space-y-2 pt-2 border-t border-border">
              <textarea
                placeholder="Notas de seguimiento (ej: contacte a 30 via email, esperando respuesta)..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full text-xs px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary resize-none"
              />
              <div className="flex flex-wrap gap-2">
                {a.status === "pending" && (
                  <button
                    onClick={onTake}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition"
                  >
                    <Hand size={12} /> Tomar accion
                  </button>
                )}
                <button
                  onClick={() => onComplete(note)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                >
                  <Check size={12} /> Marcar hecha
                </button>
                <button
                  onClick={() => onCancel(note)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-border bg-surface hover:bg-soft transition"
                >
                  <X size={12} /> Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 text-xs font-bold rounded-lg transition " +
        (active ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")
      }
    >
      {label}
    </button>
  );
}

function fmtDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return s;
  }
}
