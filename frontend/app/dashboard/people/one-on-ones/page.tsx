"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Check, Calendar, Users as UsersIcon } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type { DirectoryItem } from "@/components/people/types";
import type { OneOnOne } from "@/components/people/hr-types";

export default function OneOnOnesPage() {
  const me = getUser();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data } = useQuery<{ items: OneOnOne[] }>({
    queryKey: ["one-on-ones"],
    queryFn: () => api("/api/people/one-on-ones"),
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const upcoming = items.filter((o) => !o.completed_at && new Date(o.scheduled_at) >= new Date(Date.now() - 86400000));
  const past = items.filter((o) => o.completed_at || new Date(o.scheduled_at) < new Date(Date.now() - 86400000));

  const active = items.find((o) => o.id === activeId);

  return (
    <>
      <Topbar title="1:1s" subtitle="Tus encuentros recurrentes con manager y reportes" />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-text-muted">{items.length} encuentros</div>
            <button
              onClick={() => setNewOpen(true)}
              className="text-sm px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90 inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Nuevo 1:1
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
            <div className="space-y-3">
              <Section title={`Proximos (${upcoming.length})`}>
                {upcoming.map((o) => (
                  <Row
                    key={o.id}
                    item={o}
                    myId={me?.id}
                    active={o.id === activeId}
                    onClick={() => setActiveId(o.id)}
                  />
                ))}
              </Section>
              {past.length > 0 && (
                <Section title={`Historial (${past.length})`}>
                  {past.map((o) => (
                    <Row
                      key={o.id}
                      item={o}
                      myId={me?.id}
                      active={o.id === activeId}
                      onClick={() => setActiveId(o.id)}
                    />
                  ))}
                </Section>
              )}
            </div>

            <div>
              {active ? (
                <Detail oneOnOne={active} myId={me?.id} />
              ) : (
                <div className="bg-surface border border-border rounded-xl py-16 text-center">
                  <UsersIcon size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
                  <div className="text-sm font-semibold">Selecciona un 1:1</div>
                  <div className="text-xs text-text-muted">O crea uno nuevo</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {newOpen && <NewModal onClose={() => setNewOpen(false)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-text-muted">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ item, myId, active, onClick }: { item: OneOnOne; myId: number | undefined; active: boolean; onClick: () => void }) {
  const partner = myId === item.manager_id
    ? { name: item.report_name, avatar: item.report_avatar }
    : { name: item.manager_name, avatar: item.manager_avatar };
  const isPast = !!item.completed_at;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-2 px-3 py-2.5 border-b border-border last:border-b-0 transition",
        active ? "bg-primary/10" : "hover:bg-bg-muted",
      )}
    >
      <Avatar name={partner.name} url={partner.avatar} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{partner.name}</div>
        <div className="text-[10px] text-text-muted">
          {new Date(item.scheduled_at).toLocaleString("es-AR", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
      {isPast && <Check size={12} className="text-emerald-500" />}
    </button>
  );
}

function Detail({ oneOnOne, myId }: { oneOnOne: OneOnOne; myId: number | undefined }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(oneOnOne.notes);
  const [actionItems, setActionItems] = useState(oneOnOne.action_items);
  const [newAction, setNewAction] = useState("");

  const partner = myId === oneOnOne.manager_id
    ? { name: oneOnOne.report_name, avatar: oneOnOne.report_avatar }
    : { name: oneOnOne.manager_name, avatar: oneOnOne.manager_avatar };

  const saveMut = useMutation({
    mutationFn: () =>
      api(`/api/people/one-on-ones/${oneOnOne.id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes, action_items: actionItems }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["one-on-ones"] }),
  });

  const completeMut = useMutation({
    mutationFn: () =>
      api(`/api/people/one-on-ones/${oneOnOne.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true, notes, action_items: actionItems }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["one-on-ones"] }),
  });

  function addAction() {
    if (!newAction.trim()) return;
    setActionItems((prev) => [...prev, { text: newAction.trim(), done: false }]);
    setNewAction("");
  }

  function toggleAction(i: number) {
    setActionItems((prev) => prev.map((a, j) => (j === i ? { ...a, done: !a.done } : a)));
  }

  function removeAction(i: number) {
    setActionItems((prev) => prev.filter((_, j) => j !== i));
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Avatar name={partner.name} url={partner.avatar} size="md" />
          <div className="flex-1">
            <div className="text-sm font-bold">1:1 con {partner.name}</div>
            <div className="text-xs text-text-muted">
              <Calendar size={11} className="inline mr-1" />
              {new Date(oneOnOne.scheduled_at).toLocaleString("es-AR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
          {oneOnOne.completed_at && (
            <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
              Completado
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
            Notas compartidas
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Que conversamos hoy? Que aprendi? Que decisiones tomamos?"
            className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
            Action items ({actionItems.length})
          </div>
          <div className="space-y-1.5">
            {actionItems.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => toggleAction(i)}
                  className={cn(
                    "w-4 h-4 rounded border-2 flex items-center justify-center",
                    a.done ? "bg-emerald-500 border-emerald-500" : "border-border",
                  )}
                >
                  {a.done && <Check size={10} className="text-white" />}
                </button>
                <span className={cn("flex-1", a.done && "line-through text-text-muted")}>{a.text}</span>
                <button onClick={() => removeAction(i)} className="text-text-muted hover:text-error">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAction()}
              placeholder="Nuevo action item..."
              className="flex-1 bg-bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
            />
            <button
              onClick={addAction}
              className="text-xs px-2 py-1 bg-primary text-white rounded font-semibold hover:opacity-90"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="text-sm px-3 py-1.5 bg-surface border border-border rounded-full hover:bg-bg-muted disabled:opacity-50"
          >
            {saveMut.isPending ? "Guardando..." : "Guardar"}
          </button>
          {!oneOnOne.completed_at && (
            <button
              onClick={() => completeMut.mutate()}
              disabled={completeMut.isPending}
              className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-full hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Check size={12} /> Marcar completo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const me = getUser();
  const [reportId, setReportId] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");

  const { data: dir } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
  });

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/one-on-ones", {
        method: "POST",
        body: JSON.stringify({ manager_id: me?.id, report_id: reportId, scheduled_at: scheduledAt }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["one-on-ones"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-bold">Nuevo 1:1</div>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">
              Con quien
            </div>
            <select
              value={reportId ?? ""}
              onChange={(e) => setReportId(parseInt(e.target.value, 10))}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
            >
              <option value="">Selecciona...</option>
              {dir?.items
                .filter((u) => u.id !== me?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.area_name ? `· ${u.area_name}` : ""}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">
              Cuando
            </div>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-border bg-bg-muted/30 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-full hover:bg-bg-muted">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!reportId || !scheduledAt || mut.isPending}
            className="text-sm px-4 py-1.5 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
          >
            {mut.isPending ? "Creando..." : "Crear 1:1"}
          </button>
        </div>
      </div>
    </div>
  );
}
