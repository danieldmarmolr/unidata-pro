"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";

type Empresa = { id: number; nombre: string; cuit: string | null; activa: boolean; created_at: string };

export default function EmpresasPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Empresa | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const q = useQuery<{ items: Empresa[]; count: number }>({
    queryKey: ["ff", "empresas", "all"],
    queryFn: () => api(`/api/flujo-fondos/empresas?only_active=false`),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/flujo-fondos/empresas/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "empresas"] }),
  });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} empresas</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Nueva empresa
        </button>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-3 py-2">Nombre</th>
                <th className="text-left px-3 py-2">CUIT</th>
                <th className="text-center px-3 py-2">Activa</th>
                <th className="text-right px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.items.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 font-semibold">{e.nombre}</td>
                  <td className="px-3 py-2 text-text-muted">{e.cuit ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {e.activa ? <span className="text-emerald-600 text-xs">✓</span> : <span className="text-text-muted text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(e)} className="text-text-muted hover:text-primary p-1" title="Editar"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`Eliminar ${e.nombre}?`)) del.mutate(e.id); }} className="text-text-muted hover:text-rose-600 p-1" title="Eliminar"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editing) && (
        <EmpresaModal
          item={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "empresas"] }); }}
        />
      )}
    </PageWrapper>
  );
}

function EmpresaModal({ item, onClose, onSaved }: { item: Empresa | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nombre: item?.nombre ?? "", cuit: item?.cuit ?? "", activa: item?.activa ?? true });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/empresas/${item.id}` : "/api/flujo-fondos/empresas",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold">{item ? "Editar empresa" : "Nueva empresa"}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={18} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ nombre: form.nombre.trim(), cuit: form.cuit.trim() || null, activa: form.activa }); }} className="p-5 space-y-3">
          <Field label="Nombre *">
            <input required type="text" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none" />
          </Field>
          <Field label="CUIT">
            <input type="text" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none" />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} /> Activa</label>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
              {m.isPending && <Loader2 size={12} className="animate-spin" />}{item ? "Guardar" : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
