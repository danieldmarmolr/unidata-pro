"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs } from "../_components/helpers";

type Banco = { id: number; nombre: string; tipo: string; saldo_actual: number | string | null; moneda: string; activo: boolean };
const TIPOS = ["banco", "billetera_digital", "efectivo", "otro"] as const;

export default function BancosPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Banco | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const q = useQuery<{ items: Banco[]; count: number }>({
    queryKey: ["ff", "bancos", "all"],
    queryFn: () => api(`/api/flujo-fondos/bancos?only_active=false`),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/flujo-fondos/bancos/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "bancos"] }),
  });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} bancos</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nuevo banco</button>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left px-3 py-2">Nombre</th><th className="text-left px-3 py-2">Tipo</th><th className="text-right px-3 py-2">Saldo declarado</th><th className="text-left px-3 py-2">Moneda</th><th className="text-center px-3 py-2">Activo</th><th className="text-right px-3 py-2">Acciones</th></tr>
            </thead>
            <tbody>
              {q.data?.items.map((b) => (
                <tr key={b.id} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 font-semibold">{b.nombre}</td>
                  <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">{b.tipo}</span></td>
                  <td className="px-3 py-2 text-right font-semibold">{b.saldo_actual != null ? fmtArs(b.saldo_actual) : "—"}</td>
                  <td className="px-3 py-2 text-text-muted">{b.moneda}</td>
                  <td className="px-3 py-2 text-center">{b.activo ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(b)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`Eliminar ${b.nombre}?`)) del.mutate(b.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(showCreate || editing) && <BancoModal item={editing} onClose={() => { setShowCreate(false); setEditing(null); }} onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "bancos"] }); }} />}
    </PageWrapper>
  );
}

function BancoModal({ item, onClose, onSaved }: { item: Banco | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nombre: item?.nombre ?? "", tipo: item?.tipo ?? "banco", saldo_actual: item?.saldo_actual?.toString() ?? "", moneda: item?.moneda ?? "ARS", activo: item?.activo ?? true });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/bancos/${item.id}` : "/api/flujo-fondos/bancos",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">{item ? "Editar banco" : "Nuevo banco"}</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ nombre: form.nombre.trim(), tipo: form.tipo, saldo_actual: form.saldo_actual ? Number(form.saldo_actual) : null, moneda: form.moneda, activo: form.activo }); }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Nombre *</label><input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Tipo</label><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{TIPOS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Moneda</label><input value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Saldo declarado (opcional)</label><input type="number" step="0.01" value={form.saldo_actual} onChange={(e) => setForm({ ...form, saldo_actual: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
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
