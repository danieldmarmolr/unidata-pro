"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate } from "../_components/helpers";

type Recurrencia = {
  id: number; descripcion: string; monto_base: number | string | null; frecuencia: string;
  fecha_inicio: string; fecha_fin: string | null; cuotas_totales: number | null;
  proveedor_id: number | null; empresa_id: number | null; banco_id: number | null;
  activa: boolean; proveedor_nombre?: string; empresa_nombre?: string; banco_nombre?: string;
};
type Maestro = { id: number; nombre: string };
const FRECUENCIAS = ["mensual", "semanal", "quincenal", "trimestral", "anual", "custom"] as const;

export default function RecurrenciasPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Recurrencia | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const q = useQuery<{ items: Recurrencia[]; count: number }>({ queryKey: ["ff", "recurrencias"], queryFn: () => api("/api/flujo-fondos/recurrencias") });
  const proveedores = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "proveedores"], queryFn: () => api("/api/flujo-fondos/proveedores"), staleTime: 5 * 60_000 });
  const empresas = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "empresas"], queryFn: () => api("/api/flujo-fondos/empresas"), staleTime: 5 * 60_000 });
  const bancos = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "bancos"], queryFn: () => api("/api/flujo-fondos/bancos"), staleTime: 5 * 60_000 });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/flujo-fondos/recurrencias/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "recurrencias"] }) });

  const columns: Column<Recurrencia>[] = [
    { key: "descripcion", label: "Descripcion", getValue: (r) => r.descripcion },
    {
      key: "frecuencia", label: "Frecuencia", getValue: (r) => r.frecuencia,
      render: (r) => <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100">{r.frecuencia}</span>,
    },
    {
      key: "monto_base", label: "Monto base", align: "right", type: "number",
      getValue: (r) => r.monto_base != null ? Number(r.monto_base) : null,
      render: (r) => r.monto_base != null ? <span className="font-semibold">{fmtArs(r.monto_base)}</span> : <span className="text-text-muted">—</span>,
    },
    { key: "fecha_inicio", label: "Desde", type: "date", getValue: (r) => r.fecha_inicio, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.fecha_inicio)}</span> },
    {
      key: "fecha_fin", label: "Hasta", type: "date",
      getValue: (r) => r.fecha_fin ?? "",
      render: (r) => r.fecha_fin ? <span className="whitespace-nowrap">{fmtDate(r.fecha_fin)}</span> : <span className="text-text-muted">indef.</span>,
    },
    { key: "proveedor_nombre", label: "Proveedor", getValue: (r) => r.proveedor_nombre ?? "", className: "text-text-muted" },
    { key: "activa", label: "Activa", align: "center", getValue: (r) => r.activa ? "si" : "no", render: (r) => r.activa ? "✓" : "—" },
  ];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} recurrencias definidas</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nueva recurrencia</button>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={q.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "fecha_inicio", dir: "desc" }}
          emptyLabel="Aun no hay recurrencias definidas"
          renderActions={(r) => (
            <>
              <button onClick={() => setEditing(r)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
              <button onClick={() => { if (confirm(`Eliminar recurrencia?`)) del.mutate(r.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
            </>
          )}
        />
      )}
      {(showCreate || editing) && (
        <RecurrenciaModal item={editing} proveedores={proveedores.data?.items ?? []} empresas={empresas.data?.items ?? []} bancos={bancos.data?.items ?? []} onClose={() => { setShowCreate(false); setEditing(null); }} onSaved={() => { setShowCreate(false); setEditing(null); qc.invalidateQueries({ queryKey: ["ff", "recurrencias"] }); }} />
      )}
    </PageWrapper>
  );
}

function RecurrenciaModal({ item, proveedores, empresas, bancos, onClose, onSaved }: { item: Recurrencia | null; proveedores: Maestro[]; empresas: Maestro[]; bancos: Maestro[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    descripcion: item?.descripcion ?? "",
    monto_base: item?.monto_base?.toString() ?? "",
    frecuencia: item?.frecuencia ?? "mensual",
    fecha_inicio: item?.fecha_inicio?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    fecha_fin: item?.fecha_fin?.slice(0, 10) ?? "",
    cuotas_totales: item?.cuotas_totales?.toString() ?? "",
    proveedor_id: item?.proveedor_id?.toString() ?? "",
    empresa_id: item?.empresa_id?.toString() ?? "",
    banco_id: item?.banco_id?.toString() ?? "",
    activa: item?.activa ?? true,
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/recurrencias/${item.id}` : "/api/flujo-fondos/recurrencias",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">{item ? "Editar recurrencia" : "Nueva recurrencia"}</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { descripcion: form.descripcion.trim(), frecuencia: form.frecuencia, fecha_inicio: form.fecha_inicio, activa: form.activa };
          if (form.monto_base) body.monto_base = Number(form.monto_base);
          if (form.fecha_fin) body.fecha_fin = form.fecha_fin;
          if (form.cuotas_totales) body.cuotas_totales = Number(form.cuotas_totales);
          if (form.proveedor_id) body.proveedor_id = Number(form.proveedor_id);
          if (form.empresa_id) body.empresa_id = Number(form.empresa_id);
          if (form.banco_id) body.banco_id = Number(form.banco_id);
          m.mutate(body);
        }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Descripcion *</label><input required value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Frecuencia *</label><select required value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Monto base</label><input type="number" step="0.01" value={form.monto_base} onChange={(e) => setForm({ ...form, monto_base: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha inicio *</label><input required type="date" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha fin</label><input type="date" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Cuotas totales (opcional)</label><input type="number" value={form.cuotas_totales} onChange={(e) => setForm({ ...form, cuotas_totales: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Proveedor</label><select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">—</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Empresa</label><select value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">—</option>{empresas.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Banco</label><select value={form.banco_id} onChange={(e) => setForm({ ...form, banco_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">—</option>{bancos.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} /> Activa</label>
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
