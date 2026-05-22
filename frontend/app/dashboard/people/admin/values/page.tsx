"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Edit3, Check, X } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import type { PeopleValue } from "@/components/people/types";

function canManage(): boolean {
  const me = getUser();
  return (
    !!me?.is_admin ||
    me?.role === "admin" ||
    me?.role === "gerencia" ||
    me?.area_slug === "people"
  );
}

export default function ValuesAdminPage() {
  const qc = useQueryClient();
  const allowed = canManage();

  const { data } = useQuery<{ items: PeopleValue[] }>({
    queryKey: ["people-values-all"],
    queryFn: () => api("/api/people/values?only_active=false"),
    enabled: allowed,
    staleTime: 60_000,
  });

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createMut = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api("/api/people/values", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["people-values-all"] });
      qc.invalidateQueries({ queryKey: ["people-values"] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/people/values/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["people-values-all"] });
      qc.invalidateQueries({ queryKey: ["people-values"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api(`/api/people/values/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-values-all"] });
      qc.invalidateQueries({ queryKey: ["people-values"] });
    },
  });

  if (!allowed) {
    return (
      <>
        <Topbar title="Valores" subtitle="Configuracion de la empresa" />
        <div className="flex-1 px-8 py-6 overflow-y-auto">
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <div className="text-sm font-semibold mb-2">Acceso restringido</div>
            <div className="text-xs text-text-muted">
              Solo admin / gerencia / People puede gestionar los valores de la empresa.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Valores de la empresa"
        subtitle="Configura las categorias para los kudos"
      />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-text-muted">
              {data?.items?.filter((v) => v.is_active).length ?? 0} activos · {data?.items?.length ?? 0} totales
            </div>
            {!creating && (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-full hover:opacity-90"
              >
                <Plus size={14} /> Agregar valor
              </button>
            )}
          </div>

          {creating && (
            <ValueForm
              onCancel={() => setCreating(false)}
              onSubmit={(body) => createMut.mutate(body)}
              submitting={createMut.isPending}
            />
          )}

          <div className="space-y-2">
            {data?.items?.map((v) => (
              <div key={v.id}>
                {editingId === v.id ? (
                  <ValueForm
                    initial={v}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(body) => updateMut.mutate({ id: v.id, body })}
                    submitting={updateMut.isPending}
                  />
                ) : (
                  <div
                    className={`bg-surface border rounded-xl p-4 flex items-center gap-4 ${
                      v.is_active ? "border-border" : "border-border opacity-50"
                    }`}
                  >
                    <div className="text-3xl">{v.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text">{v.name}</span>
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                          style={{
                            background: `${v.color}15`,
                            color: v.color,
                          }}
                        >
                          #{v.slug}
                        </span>
                        {!v.is_active && (
                          <span className="text-[10px] font-bold uppercase text-text-muted bg-bg-muted px-2 py-0.5 rounded-full">
                            inactivo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">{v.description}</div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingId(v.id)}
                        className="p-1.5 text-text-muted hover:bg-bg-muted rounded transition"
                        title="Editar"
                      >
                        <Edit3 size={14} />
                      </button>
                      {v.is_active && (
                        <button
                          onClick={() => {
                            if (confirm(`Desactivar el valor "${v.name}"?`)) deleteMut.mutate(v.id);
                          }}
                          className="p-1.5 text-text-muted hover:text-error hover:bg-error/10 rounded transition"
                          title="Desactivar"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {!v.is_active && (
                        <button
                          onClick={() => updateMut.mutate({ id: v.id, body: { is_active: true } })}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                          title="Reactivar"
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ValueForm({
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial?: PeopleValue;
  onCancel: () => void;
  onSubmit: (body: Record<string, string>) => void;
  submitting: boolean;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "⭐");
  const [color, setColor] = useState(initial?.color ?? "#7a3eae");
  const [description, setDescription] = useState(initial?.description ?? "");

  const isEdit = !!initial;
  const canSave = name.trim() && emoji.trim() && (isEdit || slug.trim());

  return (
    <div className="bg-surface border border-primary/40 ring-2 ring-primary/10 rounded-xl p-4 mb-2">
      <div className="grid grid-cols-1 md:grid-cols-[80px_140px_1fr] gap-3">
        <Field label="Emoji">
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className="w-full text-2xl text-center bg-bg-muted border border-border rounded-lg py-1.5 focus:outline-none focus:border-primary"
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full h-10 bg-bg-muted border border-border rounded-lg cursor-pointer"
          />
        </Field>
        <Field label="Nombre">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
          />
        </Field>
      </div>

      {!isEdit && (
        <Field label="Slug (identificador unico, no editable luego)">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            placeholder="ej: colaboracion"
            className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
          />
        </Field>
      )}

      <Field label="Descripcion">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
        />
      </Field>

      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-full hover:bg-bg-muted transition inline-flex items-center gap-1"
        >
          <X size={12} /> Cancelar
        </button>
        <button
          onClick={() => {
            const body: Record<string, string> = { name, emoji, color, description };
            if (!isEdit) body.slug = slug;
            onSubmit(body);
          }}
          disabled={!canSave || submitting}
          className="px-3 py-1.5 bg-primary text-white text-sm rounded-full hover:opacity-90 disabled:opacity-40 transition inline-flex items-center gap-1"
        >
          <Check size={12} /> {submitting ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mt-2 first:mt-0">
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">{label}</div>
      {children}
    </label>
  );
}
