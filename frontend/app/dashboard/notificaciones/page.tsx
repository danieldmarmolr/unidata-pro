"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, AlertCircle, Info, Check, RotateCcw, Bell } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

type Alert = {
  id: number;
  type: string;
  severity: "info" | "warning" | "critical";
  source: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  resolved: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
};

type Resp = {
  items: Alert[];
  pending_count: number;
  critical_pending_count: number;
};

const SEV_META: Record<Alert["severity"], { icon: any; color: string; bg: string; border: string; label: string }> = {
  critical: { icon: AlertCircle, color: "#dc2626", bg: "bg-red-50", border: "border-red-300", label: "Crítica" },
  warning: { icon: AlertTriangle, color: "#f59e0b", bg: "bg-amber-50", border: "border-amber-300", label: "Warning" },
  info: { icon: Info, color: "#3b82f6", bg: "bg-blue-50", border: "border-blue-300", label: "Info" },
};

export default function NotificacionesPage() {
  const [filter, setFilter] = useState<"pending" | "all" | "critical">("pending");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["notifications", filter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter === "pending") params.set("only_pending", "true");
      else if (filter === "critical") {
        params.set("only_pending", "true");
        params.set("severity", "critical");
      }
      return api(`/api/notifications?${params.toString()}`);
    },
    staleTime: 30_000,
  });

  const resolveMut = useMutation({
    mutationFn: (id: number) => api(`/api/notifications/${id}/resolve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unresolveMut = useMutation({
    mutationFn: (id: number) => api(`/api/notifications/${id}/unresolve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const syncMut = useMutation({
    mutationFn: () => api(`/api/notifications/sync`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <>
      <Topbar
        title="Notificaciones"
        subtitle="Alertas internas de IT · integraciones, fallas operativas, tokens vencidos"
        hidePeriod
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="inline-flex bg-soft rounded-xl p-1 border border-border">
            <TabBtn active={filter === "pending"} onClick={() => setFilter("pending")} label={`Pendientes${data ? ` (${data.pending_count})` : ""}`} />
            <TabBtn active={filter === "critical"} onClick={() => setFilter("critical")} label={`Críticas${data ? ` (${data.critical_pending_count})` : ""}`} />
            <TabBtn active={filter === "all"} onClick={() => setFilter("all")} label="Todas (recientes)" />
          </div>
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-primary to-accent text-white shadow disabled:opacity-50"
          >
            <RotateCcw size={12} /> {syncMut.isPending ? "Sincronizando..." : "Sincronizar ahora"}
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-surface border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <Bell size={32} className="mx-auto text-text-muted mb-3" />
            <div className="text-sm font-bold text-text">Nada que reportar</div>
            <div className="text-xs text-text-muted mt-1">
              {filter === "pending" ? "No hay alertas pendientes. Todo bajo control." : "Sin resultados para este filtro."}
            </div>
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="space-y-2">
            {data.items.map((a) => {
              const meta = SEV_META[a.severity];
              const Icon = meta.icon;
              return (
                <div
                  key={a.id}
                  className={`border-2 rounded-xl p-4 ${a.resolved ? "bg-surface border-border opacity-60" : `${meta.bg} ${meta.border}`}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon size={18} className="shrink-0 mt-0.5" style={{ color: a.resolved ? "var(--text-muted)" : meta.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                        <div className="text-sm font-bold text-text">{a.title}</div>
                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">
                          {meta.label} · {a.source} · {fmtDate(a.created_at)}
                        </div>
                      </div>
                      <div className="text-xs text-text leading-relaxed">{a.message}</div>
                      {a.resolved && a.resolved_at && (
                        <div className="text-[10px] text-text-muted mt-1.5 italic">
                          Revisada el {fmtDate(a.resolved_at)} {a.resolved_by ? `por user #${a.resolved_by}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {a.resolved ? (
                        <button
                          onClick={() => unresolveMut.mutate(a.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-border bg-surface hover:bg-soft transition"
                          title="Reabrir alerta"
                        >
                          <RotateCcw size={11} /> Reabrir
                        </button>
                      ) : (
                        <button
                          onClick={() => resolveMut.mutate(a.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                        >
                          <Check size={11} /> Marcar revisada
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-1.5 text-xs font-bold rounded-lg transition " +
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
