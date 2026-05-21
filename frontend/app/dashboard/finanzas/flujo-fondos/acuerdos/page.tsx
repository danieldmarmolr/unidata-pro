"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs, fmtDate } from "../_components/helpers";

type Acuerdo = {
  id: number; proveedor_id: number; tipo: string; compromiso: string;
  fecha_compromiso: string | null; monto_compromiso: number | string | null;
  estado: string; contexto: string | null; erogacion_id: number | null;
  proveedor_nombre?: string; erogacion_descripcion?: string;
};
type Maestro = { id: number; nombre: string };
const TIPOS = ["diferimiento", "pago_parcial", "plan_cuotas", "otro"] as const;
const ESTADOS = ["pendiente", "cumplido", "incumplido"] as const;
const ESTADO_COLOR: Record<string, string> = { pendiente: "bg-amber-100 text-amber-700", cumplido: "bg-emerald-100 text-emerald-700", incumplido: "bg-rose-100 text-rose-700" };

export default function AcuerdosPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Acuerdo | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<string>("");

  const url = filtroEstado ? `/api/flujo-fondos/acuerdos?estado=${filtroEstado}` : `/api/flujo-fondos/acuerdos`;
  const q = useQuery<{ items: Acuerdo[]; count: number }>({ queryKey: ["ff", "acuerdos", filtroEstado], queryFn: () => api(url) });
  const proveedores = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "proveedores"], queryFn: () => api("/api/flujo-fondos/proveedores"), staleTime: 5 * 60_000 });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/flujo-fondos/acuerdos/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "acuerdos"] }) });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} acuerdos {filtroEstado && `(${filtroEstado})`}</div>
        <div className="flex gap-2 items-center">
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">Todos los estados</option>{ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nuevo acuerdo</button>
        </div>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState label="Aun no hay acuerdos cargados" /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left px-3 py-2">Proveedor</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Compromiso</th><th className="text-left px-3 py-2">Fecha</th><th className="text-right px-3 py-2">Monto</th><th className="text-center px-3 py-2">Estado</th><th className="text-right px-3 py-2">Acciones</th></tr>
            </thead>
            <tbody>
              {q.data?.items.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 font-semibold">{a.proveedor_nombre ?? `#${a.proveedor_id}`}</td>
                  <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100">{a.tipo}</span></td>
                  <td className="px-3 py-2 max-w-md truncate">{a.compromiso}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{a.fecha_compromiso ? fmtDate(a.fecha_compromiso) : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{a.monto_compromiso != null ? fmtArs(a.monto_compromiso) : "—"}</td>
                  <td className="px-3 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_COLOR[a.estado] ?? ""}`}>{a.estado}</span></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(a)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`Eliminar acuerdo?`)) del.mutate(a.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(showCreate || editing) && <AcuerdoModal item={editing} proveedores={proveedores.data?.items ?? []} onClose={() => { setShowCreate(false); setEditing(null); }} onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "acuerdos"] }); }} />}
    </PageWrapper>
  );
}

function AcuerdoModal({ item, proveedores, onClose, onSaved }: { item: Acuerdo | null; proveedores: Maestro[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    proveedor_id: item?.proveedor_id ?? proveedores[0]?.id ?? 0,
    tipo: item?.tipo ?? "diferimiento",
    compromiso: item?.compromiso ?? "",
    fecha_compromiso: item?.fecha_compromiso?.slice(0, 10) ?? "",
    monto_compromiso: item?.monto_compromiso?.toString() ?? "",
    estado: item?.estado ?? "pendiente",
    contexto: item?.contexto ?? "",
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/acuerdos/${item.id}` : "/api/flujo-fondos/acuerdos",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">{item ? "Editar acuerdo" : "Nuevo acuerdo"}</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { proveedor_id: Number(form.proveedor_id), tipo: form.tipo, compromiso: form.compromiso.trim(), estado: form.estado };
          if (form.fecha_compromiso) body.fecha_compromiso = form.fecha_compromiso;
          if (form.monto_compromiso) body.monto_compromiso = Number(form.monto_compromiso);
          if (form.contexto.trim()) body.contexto = form.contexto.trim();
          m.mutate(body);
        }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Proveedor *</label><select required value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Tipo *</label><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{TIPOS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Estado</label><select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Compromiso *</label><textarea required rows={2} value={form.compromiso} onChange={(e) => setForm({ ...form, compromiso: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha compromiso</label><input type="date" value={form.fecha_compromiso} onChange={(e) => setForm({ ...form, fecha_compromiso: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Monto compromiso</label><input type="number" step="0.01" value={form.monto_compromiso} onChange={(e) => setForm({ ...form, monto_compromiso: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Contexto</label><textarea rows={2} value={form.contexto} onChange={(e) => setForm({ ...form, contexto: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
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
