"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate } from "../_components/helpers";

type Ingreso = {
  id: number; fecha: string; descripcion: string; monto: number | string;
  empresa_id: number; banco_id: number | null; categoria: string | null; notas: string | null;
  empresa_nombre?: string; banco_nombre?: string;
};
type Maestro = { id: number; nombre: string };

export default function IngresosPuntualesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Ingreso | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const q = useQuery<{ items: Ingreso[]; count: number }>({ queryKey: ["ff", "ingresos-puntuales"], queryFn: () => api("/api/flujo-fondos/ingresos-puntuales") });
  const empresas = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "empresas"], queryFn: () => api("/api/flujo-fondos/empresas"), staleTime: 5 * 60_000 });
  const bancos = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "bancos"], queryFn: () => api("/api/flujo-fondos/bancos"), staleTime: 5 * 60_000 });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/flujo-fondos/ingresos-puntuales/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "ingresos-puntuales"] }) });

  const columns: Column<Ingreso>[] = [
    { key: "fecha", label: "Fecha", type: "date", getValue: (r) => r.fecha, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.fecha)}</span> },
    { key: "descripcion", label: "Descripcion", getValue: (r) => r.descripcion, render: (r) => <span className="block max-w-md truncate" title={r.descripcion}>{r.descripcion}</span> },
    { key: "empresa_nombre", label: "Empresa", getValue: (r) => r.empresa_nombre ?? "", className: "text-text-muted" },
    { key: "banco_nombre", label: "Banco", getValue: (r) => r.banco_nombre ?? "", className: "text-text-muted" },
    { key: "categoria", label: "Categoria", getValue: (r) => r.categoria ?? "", className: "text-text-muted" },
    {
      key: "monto", label: "Monto", align: "right", type: "number",
      getValue: (r) => Number(r.monto),
      render: (r) => <span className="font-semibold text-emerald-700 whitespace-nowrap">{fmtArs(r.monto)}</span>,
    },
  ];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} ingresos puntuales · NO afectan los promedios de proyeccion</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nuevo ingreso</button>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={q.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "fecha", dir: "desc" }}
          renderActions={(r) => (
            <>
              <button onClick={() => setEditing(r)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
              <button onClick={() => { if (confirm(`Eliminar este ingreso?`)) del.mutate(r.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
            </>
          )}
        />
      )}
      {(showCreate || editing) && (
        <IngresoModal item={editing} empresas={empresas.data?.items ?? []} bancos={bancos.data?.items ?? []} onClose={() => { setShowCreate(false); setEditing(null); }} onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "ingresos-puntuales"] }); }} />
      )}
    </PageWrapper>
  );
}

function IngresoModal({ item, empresas, bancos, onClose, onSaved }: { item: Ingreso | null; empresas: Maestro[]; bancos: Maestro[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fecha: item?.fecha?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    descripcion: item?.descripcion ?? "", monto: item?.monto?.toString() ?? "",
    empresa_id: item?.empresa_id ?? empresas[0]?.id ?? 0,
    banco_id: item?.banco_id?.toString() ?? "",
    categoria: item?.categoria ?? "", notas: item?.notas ?? "",
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/ingresos-puntuales/${item.id}` : "/api/flujo-fondos/ingresos-puntuales",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">{item ? "Editar ingreso" : "Nuevo ingreso puntual"}</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { fecha: form.fecha, descripcion: form.descripcion.trim(), monto: Number(form.monto), empresa_id: Number(form.empresa_id) };
          if (form.banco_id) body.banco_id = Number(form.banco_id);
          if (form.categoria.trim()) body.categoria = form.categoria.trim();
          if (form.notas.trim()) body.notas = form.notas.trim();
          m.mutate(body);
        }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Descripcion *</label><input required value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha *</label><input required type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Monto *</label><input required type="number" step="0.01" min="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Empresa *</label><select required value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Banco</label><select value={form.banco_id} onChange={(e) => setForm({ ...form, banco_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">(sin banco)</option>{bancos.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Categoria</label><input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" placeholder="ej: prestamo, cheque, devolucion" /></div>
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
