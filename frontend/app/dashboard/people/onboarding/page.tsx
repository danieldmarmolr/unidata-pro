"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Plus, Trash2, Users as UsersIcon, X } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type { DirectoryItem } from "@/components/people/types";
import type { OnboardingTask } from "@/components/people/hr-types";

export default function OnboardingPage() {
  const me = getUser();
  const [targetUserId, setTargetUserId] = useState<number | null>(me?.id ?? null);
  const canManage = !!me?.is_admin || me?.role === "admin" || me?.role === "gerencia" || me?.area_slug === "people";

  const { data: dir } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });

  const { data, isLoading } = useQuery<{ items: OnboardingTask[] }>({
    queryKey: ["onboarding", targetUserId],
    queryFn: () => api(`/api/people/onboarding/${targetUserId}`),
    enabled: !!targetUserId,
    staleTime: 30_000,
  });

  const qc = useQueryClient();
  const initMut = useMutation({
    mutationFn: () =>
      api("/api/people/onboarding/init", {
        method: "POST",
        body: JSON.stringify({ user_id: targetUserId, manager_id: dir?.items.find((u) => u.id === targetUserId)?.manager_user_id ?? null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding", targetUserId] }),
  });

  const isMine = targetUserId === me?.id;
  const targetUser = dir?.items.find((u) => u.id === targetUserId);
  const tasks = data?.items ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <Topbar
        title="Onboarding"
        subtitle={
          isMine ? "Tu checklist de bienvenida" : targetUser ? `Onboarding de ${targetUser.name}` : "Checklist por colaborador"
        }
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-4">
          {canManage && dir && dir.items.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-3">
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Ver onboarding de
              </div>
              <select
                value={targetUserId ?? ""}
                onChange={(e) => setTargetUserId(parseInt(e.target.value, 10))}
                className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              >
                {dir.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.id === me?.id ? "(yo)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Progress */}
          {tasks.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold">
                  Progreso: {done} / {total}
                </div>
                <div className="text-2xl font-extrabold tabular-nums text-primary">{pct}%</div>
              </div>
              <div className="h-2 bg-bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Tasks */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {isLoading && (
              <div className="text-center py-12 text-text-muted text-sm">Cargando...</div>
            )}
            {!isLoading && tasks.length === 0 && (
              <div className="text-center py-12 px-4">
                <UsersIcon size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
                <div className="text-sm font-semibold mb-1">Sin onboarding iniciado</div>
                <div className="text-xs text-text-muted mb-3">
                  {canManage ? "Inicializa el checklist con el template default" : "Pedile a tu manager o People que arranque tu onboarding"}
                </div>
                {canManage && (
                  <button
                    onClick={() => initMut.mutate()}
                    disabled={initMut.isPending}
                    className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90"
                  >
                    <Plus size={12} /> {initMut.isPending ? "Creando..." : "Iniciar con template"}
                  </button>
                )}
              </div>
            )}
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} canEdit={canManage || isMine} />
            ))}
          </div>

          {(canManage || isMine) && tasks.length > 0 && targetUserId && (
            <AddTaskBox userId={targetUserId} />
          )}
        </div>
      </div>
    </>
  );
}

function TaskRow({ task, canEdit }: { task: OnboardingTask; canEdit: boolean }) {
  const qc = useQueryClient();
  const updateMut = useMutation({
    mutationFn: (status: OnboardingTask["status"]) =>
      api(`/api/people/onboarding/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => api(`/api/people/onboarding/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const isDone = task.status === "done";
  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex items-start gap-3">
      <button
        onClick={() => canEdit && updateMut.mutate(isDone ? "pending" : "done")}
        disabled={!canEdit}
        className={cn(
          "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0",
          isDone ? "bg-emerald-500 border-emerald-500" : "border-border hover:border-primary",
          !canEdit && "cursor-default",
        )}
      >
        {isDone && <Check size={12} className="text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-semibold", isDone && "line-through text-text-muted")}>
          {task.title}
        </div>
        {task.description && (
          <div className="text-xs text-text-muted mt-0.5">{task.description}</div>
        )}
        <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
          {task.assignee_name && (
            <div className="inline-flex items-center gap-1">
              <Avatar name={task.assignee_name} url={task.assignee_avatar} size="xs" />
              {task.assignee_name}
            </div>
          )}
          {task.due_date && <span>· vence {task.due_date}</span>}
          {task.completed_at && <span>· completado {task.completed_at.slice(0, 10)}</span>}
        </div>
      </div>
      {canEdit && (
        <button
          onClick={() => {
            if (confirm("Eliminar esta tarea?")) deleteMut.mutate();
          }}
          className="text-text-muted hover:text-error"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function AddTaskBox({ userId }: { userId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api(`/api/people/onboarding/${userId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, description: desc }),
      }),
    onSuccess: () => {
      setTitle("");
      setDesc("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["onboarding", userId] });
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-primary font-semibold inline-flex items-center gap-1 hover:underline"
      >
        <Plus size={12} /> Agregar tarea
      </button>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titulo de la tarea..."
        autoFocus
        className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Descripcion (opcional)"
        rows={2}
        className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary resize-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="text-xs px-3 py-1 rounded-full hover:bg-bg-muted">
          Cancelar
        </button>
        <button
          onClick={() => title.trim() && mut.mutate()}
          disabled={!title.trim() || mut.isPending}
          className="text-xs px-3 py-1 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
        >
          {mut.isPending ? "Agregando..." : "Agregar"}
        </button>
      </div>
    </div>
  );
}
