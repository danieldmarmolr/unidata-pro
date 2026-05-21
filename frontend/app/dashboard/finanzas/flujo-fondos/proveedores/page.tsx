"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs } from "../_components/helpers";

type Proveedor = { id: number; nombre: string; cuit: string | null; prioridad: string; saldo_pendiente: number | string; notas: string | null; tags: string[] };
const PRIORIDADES = ["alta", "media", "baja"] as const;
const PRIORIDAD_COLOR: Record<string, string> = { alta: "bg-rose-100 text-rose-700", media: "bg-amber-100 text-amber-700", baja: "bg-slate-100 text-slate-600" };

export default function ProveedoresPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const q = useQuery<{ items: Proveedor[]; count: number }>({
    queryKey: ["ff", "proveedores"],
    queryFn: () => api(`/api/flujo-fondos/proveedores`),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/flujo-fondos/proveedores/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "proveedores"] }),
  });
  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} proveedores</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nuevo proveedor</button>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left px-3 py-2">Nombre</th><th className="text-left px-3 py-2">CUIT</th><th className="text-center px-3 py-2">Prioridad</th><th className="text-right px-3 py-2">Saldo pendiente</th><th className="text-left px-3 py-2">Tags</th><th className="text-right px-3 py-2">Acciones</th></tr>
            </thead>
            <tbody>
              {q.data?.items.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 font-semibold">{p.nombre}</td>
                  <td className="px-3 py-2 text-text-muted">{p.cuit ?? "—"}</td>
                  <td className="px-3 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${PRIORIDAD_COLOR[p.prioridad] ?? ""}`}>{p.prioridad}</span></td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtArs(p.saldo_pendiente)}</td>
                  <td className="px-3 py-2 text-text-muted text-xs">{p.tags?.length ? p.tags.join(", ") : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(p)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`Eliminar ${p.nombre}?`)) del.mutate(p.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(showCreate || editing) && <ProveedorModal item={editing} onClose={() => { setShowCreate(false); setEditing(null); }} onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "proveedores"] }); }} />}
    </PageWrapper>
  );
}

function ProveedorModal({ item, onClose, onSaved }: { item: Proveedor | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    nombre: item?.nombre ?? "", cuit: item?.cuit ?? "", prioridad: item?.prioridad ?? "media",
    saldo_pendiente: item?.saldo_pendiente?.toString() ?? "0",
    notas: item?.notas ?? "", tags: item?.tags?.join(", ") ?? "",
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/proveedores/${item.id}` : "/api/flujo-fondos/proveedores",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">{item ? "Editar proveedor" : "Nuevo proveedor"}</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
          m.mutate({ nombre: form.nombre.trim(), cuit: form.cuit.trim() || null, prioridad: form.prioridad, saldo_pendiente: Number(form.saldo_pendiente) || 0, notas: form.notas.trim() || null, tags });
        }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Nombre *</label><input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">CUIT</label><input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Prioridad</label><select value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Saldo pendiente</label><input type="number" step="0.01" value={form.saldo_pendiente} onChange={(e) => setForm({ ...form, saldo_pendiente: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Tags (separados por coma)</label><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="ej: critico, mensual, importacion" className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Notas</label><textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5">{m.isPending && <Loader2 size={12} className="animate-spin" />}{item ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
