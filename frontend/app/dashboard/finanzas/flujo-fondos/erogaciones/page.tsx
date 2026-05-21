"use client";

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2, Plus, X } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate, ESTADO_LABEL, ESTADO_COLOR } from "../_components/helpers";

type Erogacion = {
  id: number;
  fecha_pago: string;
  descripcion: string;
  monto: number | string;
  moneda: string;
  estado: string;
  empresa_nombre?: string;
  banco_nombre?: string;
  proveedor_nombre?: string;
  notas?: string | null;
};

type Lista = { items: Erogacion[]; total: number; limit: number; offset: number };
type Maestro = { id: number; nombre: string };

const ESTADOS = ["pendiente", "en_curso", "pagado", "cancelado", "rechazado"] as const;

export default function ErogacionesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const limit = 100;

  const empresasQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "empresas"], queryFn: () => api("/api/flujo-fondos/empresas"), staleTime: 5 * 60_000 });
  const bancosQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "bancos"], queryFn: () => api("/api/flujo-fondos/bancos"), staleTime: 5 * 60_000 });
  const proveedoresQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "proveedores"], queryFn: () => api("/api/flujo-fondos/proveedores"), staleTime: 5 * 60_000 });

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(page * limit));
  const listQ = useQuery<Lista>({
    queryKey: ["ff", "erogaciones", page],
    queryFn: () => api<Lista>(`/api/flujo-fondos/erogaciones?${params.toString()}`),
    staleTime: 30_000,
  });

  const totalPages = listQ.data ? Math.ceil(listQ.data.total / limit) : 0;

  const columns: Column<Erogacion>[] = [
    {
      key: "fecha_pago", label: "Fecha", type: "date",
      getValue: (r) => r.fecha_pago,
      render: (r) => <span className="whitespace-nowrap">{fmtDate(r.fecha_pago)}</span>,
    },
    {
      key: "descripcion", label: "Descripcion",
      getValue: (r) => r.descripcion,
      render: (r) => <span className="block max-w-md truncate" title={r.descripcion}>{r.descripcion}</span>,
    },
    { key: "empresa_nombre", label: "Empresa", getValue: (r) => r.empresa_nombre ?? "", className: "text-text-muted whitespace-nowrap" },
    { key: "proveedor_nombre", label: "Proveedor", getValue: (r) => r.proveedor_nombre ?? "", className: "text-text-muted whitespace-nowrap" },
    { key: "banco_nombre", label: "Banco", getValue: (r) => r.banco_nombre ?? "", className: "text-text-muted whitespace-nowrap" },
    {
      key: "monto", label: "Monto", align: "right", type: "number",
      getValue: (r) => Number(r.monto),
      render: (r) => <span className="font-semibold whitespace-nowrap">{fmtArs(r.monto)}</span>,
    },
    {
      key: "estado", label: "Estado",
      getValue: (r) => r.estado,
      render: (r) => <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[r.estado] ?? "bg-slate-100"}`}>{ESTADO_LABEL[r.estado] ?? r.estado}</span>,
    },
  ];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-muted">
          {listQ.data ? `${listQ.data.total} erogaciones totales` : "Cargando..."}
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Nueva erogacion
        </button>
      </div>

      {listQ.isLoading ? <LoadingState label="Cargando erogaciones..." /> : listQ.error ? <ErrorState message={(listQ.error as Error).message} /> : (
        <DataTable
          data={listQ.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "fecha_pago", dir: "desc" }}
          emptyLabel="Sin erogaciones"
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Pagina {page + 1} de {totalPages} (mostrando lotes de {limit})</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-3 py-1.5 border border-border rounded-md text-text hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border border-border rounded-md text-text hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed">Siguiente</button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateModal
          empresas={empresasQ.data?.items ?? []}
          bancos={bancosQ.data?.items ?? []}
          proveedores={proveedoresQ.data?.items ?? []}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["ff", "erogaciones"] });
            qc.invalidateQueries({ queryKey: ["ff", "kpis"] });
          }}
        />
      )}
    </PageWrapper>
  );
}

function CreateModal({ empresas, bancos, proveedores, onClose, onCreated }: { empresas: Maestro[]; bancos: Maestro[]; proveedores: Maestro[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    fecha_pago: new Date().toISOString().slice(0, 10),
    descripcion: "", monto: "",
    empresa_id: empresas[0]?.id ?? 0,
    banco_id: bancos[0]?.id ?? 0,
    proveedor_id: "", estado: "pendiente",
    categoria: "", notas: "", es_critico: false,
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/flujo-fondos/erogaciones", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => onCreated(),
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      fecha_pago: form.fecha_pago, descripcion: form.descripcion.trim(), monto: Number(form.monto),
      empresa_id: Number(form.empresa_id), banco_id: Number(form.banco_id),
      estado: form.estado, es_critico: form.es_critico,
    };
    if (form.proveedor_id) body.proveedor_id = Number(form.proveedor_id);
    if (form.categoria.trim()) body.categoria = form.categoria.trim();
    if (form.notas.trim()) body.notas = form.notas.trim();
    m.mutate(body);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-text">Nueva erogacion</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Descripcion *</label><input required type="text" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Fecha de pago *</label><input required type="date" value={form.fecha_pago} onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Monto *</label><input required type="number" min="0" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Empresa *</label><select required value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Banco *</label><select required value={form.banco_id} onChange={(e) => setForm({ ...form, banco_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Proveedor</label><select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">(sin proveedor)</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
            <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Estado</label><select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}</select></div>
          </div>
          <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Categoria</label><input type="text" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Notas</label><textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={form.es_critico} onChange={(e) => setForm({ ...form, es_critico: e.target.checked })} /> Pago critico (alertas priorizadas)</label>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">{m.isPending && <Loader2 size={12} className="animate-spin" />}Crear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
