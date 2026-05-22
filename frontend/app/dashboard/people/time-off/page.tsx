"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange, Plus, X, Check, AlertCircle, Plane, Home, Heart, Briefcase, MoreHorizontal,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/people/avatar";
import type { TimeOff } from "@/components/people/hr-types";

const KIND_META: Record<TimeOff["kind"], { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  vacaciones:  { label: "Vacaciones",  icon: Plane,     color: "#0ea5e9" },
  licencia:    { label: "Licencia",    icon: Heart,     color: "#ef4444" },
  home_office: { label: "Home office", icon: Home,      color: "#10b981" },
  viaje_work:  { label: "Viaje work",  icon: Briefcase, color: "#8b5cf6" },
  otro:        { label: "Otro",        icon: MoreHorizontal, color: "#7a3eae" },
};

const STATUS_META: Record<TimeOff["status"], { label: string; color: string }> = {
  pending:   { label: "Pendiente", color: "#f59e0b" },
  approved:  { label: "Aprobada",  color: "#10b981" },
  rejected:  { label: "Rechazada", color: "#ef4444" },
  cancelled: { label: "Cancelada", color: "#94a3b8" },
};

export default function TimeOffPage() {
  const me = getUser();
  const [open, setOpen] = useState(false);

  const myQ = useQuery<{ items: TimeOff[] }>({
    queryKey: ["time-off-mine"],
    queryFn: () => api("/api/people/time-off"),
    staleTime: 30_000,
  });

  const approvalsQ = useQuery<{ items: TimeOff[] }>({
    queryKey: ["time-off-approvals"],
    queryFn: () => api("/api/people/time-off/approvals"),
    staleTime: 30_000,
  });

  return (
    <>
      <Topbar
        title="Vacaciones y ausencias"
        subtitle="Tus solicitudes + aprobaciones pendientes de tu equipo"
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Actions */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <Link
                href="/dashboard/people/time-off/calendar"
                className="text-sm px-3 py-1.5 bg-surface border border-border rounded-full hover:bg-bg-muted transition inline-flex items-center gap-1.5"
              >
                <CalendarRange size={14} /> Calendario equipo
              </Link>
            </div>
            <button
              onClick={() => setOpen(true)}
              className="text-sm px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90 inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Nueva solicitud
            </button>
          </div>

          {/* Approvals pendientes (si soy manager) */}
          {(approvalsQ.data?.items.length ?? 0) > 0 && (
            <Section title={`Pendientes de aprobacion (${approvalsQ.data!.items.length})`}>
              {approvalsQ.data!.items.map((t) => (
                <ApprovalRow key={t.id} item={t} />
              ))}
            </Section>
          )}

          {/* Mis solicitudes */}
          <Section title="Mis solicitudes">
            {myQ.isLoading && (
              <div className="px-3 py-6 text-center text-text-muted text-sm">Cargando...</div>
            )}
            {!myQ.isLoading && myQ.data?.items.length === 0 && (
              <div className="px-3 py-8 text-center">
                <CalendarRange size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
                <div className="text-sm font-semibold mb-1">Sin solicitudes</div>
                <div className="text-xs text-text-muted">
                  Crea tu primera solicitud de vacaciones, home office o licencia
                </div>
              </div>
            )}
            {myQ.data?.items.map((t) => (
              <MyRow key={t.id} item={t} />
            ))}
          </Section>
        </div>
      </div>

      {open && <NewRequestModal onClose={() => setOpen(false)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-text-muted">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function MyRow({ item }: { item: TimeOff }) {
  const qc = useQueryClient();
  const Meta = KIND_META[item.kind];
  const Status = STATUS_META[item.status];
  const Icon = Meta.icon;
  const cancelMut = useMutation({
    mutationFn: () => api(`/api/people/time-off/${item.id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-off-mine"] }),
  });

  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${Meta.color}15`, color: Meta.color }}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{Meta.label}</span>
          <span
            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{ background: `${Status.color}15`, color: Status.color }}
          >
            {Status.label}
          </span>
          <span className="text-xs text-text-muted ml-auto tabular-nums">
            {item.days_count} {item.days_count === 1 ? "dia" : "dias"}
          </span>
        </div>
        <div className="text-xs text-text-muted mt-0.5">
          {item.starts_on} → {item.ends_on}
          {item.reason && ` · ${item.reason}`}
        </div>
        {item.review_note && (
          <div className="text-[11px] text-text-muted italic mt-1">"{item.review_note}"</div>
        )}
      </div>
      {(item.status === "pending" || item.status === "approved") && (
        <button
          onClick={() => {
            if (confirm("Cancelar esta solicitud?")) cancelMut.mutate();
          }}
          className="text-xs text-text-muted hover:text-error"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

function ApprovalRow({ item }: { item: TimeOff }) {
  const qc = useQueryClient();
  const Meta = KIND_META[item.kind];
  const reviewMut = useMutation({
    mutationFn: (status: "approved" | "rejected") =>
      api(`/api/people/time-off/${item.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status, note: "" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-off-approvals"] });
      qc.invalidateQueries({ queryKey: ["people-badge"] });
    },
  });

  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex items-center gap-3">
      <Avatar name={item.user_name} url={item.user_avatar} size="sm" ringColor={item.area_color ?? undefined} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{item.user_name}</div>
        <div className="text-xs text-text-muted">
          <span style={{ color: Meta.color }} className="font-semibold">{Meta.label}</span>
          {" · "}
          {item.starts_on} → {item.ends_on}
          {" · "}
          {item.days_count}d
        </div>
        {item.reason && (
          <div className="text-[11px] text-text-muted italic mt-0.5">{item.reason}</div>
        )}
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => reviewMut.mutate("approved")}
          disabled={reviewMut.isPending}
          className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-full font-semibold transition inline-flex items-center gap-1"
        >
          <Check size={11} /> Aprobar
        </button>
        <button
          onClick={() => reviewMut.mutate("rejected")}
          disabled={reviewMut.isPending}
          className="text-xs px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-full font-semibold transition inline-flex items-center gap-1"
        >
          <X size={11} /> Rechazar
        </button>
      </div>
    </div>
  );
}

function NewRequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<TimeOff["kind"]>("vacaciones");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/time-off", {
        method: "POST",
        body: JSON.stringify({ kind, starts_on: startsOn, ends_on: endsOn, reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-off-mine"] });
      onClose();
    },
  });

  const valid = startsOn && endsOn && endsOn >= startsOn;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-bold">Nueva solicitud</div>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">Tipo</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {(Object.keys(KIND_META) as TimeOff["kind"][]).map((k) => {
                const m = KIND_META[k];
                const Icon = m.icon;
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "px-2 py-2 rounded-lg border text-xs flex flex-col items-center gap-1 transition",
                      kind === k ? "border-primary ring-2 ring-primary/20" : "border-border hover:bg-bg-muted",
                    )}
                    style={kind === k ? { background: `${m.color}10` } : undefined}
                  >
                    <span style={{ color: m.color }}><Icon size={14} /></span>
                    <span className="font-semibold">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Desde</div>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Hasta</div>
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                min={startsOn || undefined}
                className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Motivo (opcional)</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="text-[11px] text-text-muted inline-flex items-center gap-1">
            <AlertCircle size={11} /> Tu manager recibira una notificacion para aprobar.
          </div>
        </div>
        <div className="px-6 py-3 border-t border-border bg-bg-muted/30 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-full hover:bg-bg-muted">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!valid || mut.isPending}
            className="text-sm px-4 py-1.5 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
          >
            {mut.isPending ? "Enviando..." : "Enviar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
