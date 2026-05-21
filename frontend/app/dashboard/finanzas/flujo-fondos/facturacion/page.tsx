"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, X, Loader2, Trash2 } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact, fmtDate } from "../_components/helpers";

type Fila = {
  id: number; fecha: string; monto: number | string; unidad_negocio_id: number;
  empresa_id: number | null; es_real: boolean; es_evento_puntual: boolean; origen: string;
  unidad_nombre?: string; unidad_canal?: string; empresa_nombre?: string;
};
type Unidad = { id: number; nombre: string };

export default function FacturacionPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [unidadFiltro, setUnidadFiltro] = useState<string>("");
  const today = new Date();
  const desde60 = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const unidades = useQuery<{ items: Unidad[] }>({ queryKey: ["ff", "unidades"], queryFn: () => api("/api/flujo-fondos/unidades-negocio"), staleTime: 5 * 60_000 });
  const empresas = useQuery<{ items: { id: number; nombre: string }[] }>({ queryKey: ["ff", "empresas"], queryFn: () => api("/api/flujo-fondos/empresas"), staleTime: 5 * 60_000 });

  const url = `/api/flujo-fondos/facturacion?fecha_desde=${desde60}&limit=500${unidadFiltro ? `&unidad_id=${unidadFiltro}` : ""}`;
  const q = useQuery<{ items: Fila[]; count: number }>({ queryKey: ["ff", "facturacion", unidadFiltro], queryFn: () => api(url) });

  const del = useMutation({ mutationFn: (id: number) => api(`/api/flujo-fondos/facturacion/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "facturacion"] }) });

  // Serie agregada por fecha
  const serie = (() => {
    if (!q.data) return [];
    const map = new Map<string, number>();
    for (const f of q.data.items) {
      const v = Number(f.monto);
      map.set(f.fecha.slice(0, 10), (map.get(f.fecha.slice(0, 10)) ?? 0) + v);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, monto]) => ({ fecha, monto }));
  })();

  return (
    <PageWrapper>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-muted">{q.data?.count ?? "..."} filas de facturacion (ultimos 60 dias)</div>
        <div className="flex gap-2 items-center">
          <select value={unidadFiltro} onChange={(e) => setUnidadFiltro(e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">Todas las unidades</option>{unidades.data?.items.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Carga manual</button>
        </div>
      </div>

      {/* Grafico */}
      {serie.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold mb-3">Evolucion diaria · {desde60} → hoy</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="fecha" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtArsCompact(v)} />
                <Tooltip formatter={(v) => [fmtArs(Number(v)), "Monto"] as [string, string]} labelFormatter={(v) => fmtDate(String(v))} />
                <Line type="monotone" dataKey="monto" stroke="#7a3eae" strokeWidth={2} dot={{ r: 2 }} connectNulls={true} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Unidad</th><th className="text-left px-3 py-2">Empresa</th><th className="text-right px-3 py-2">Monto</th><th className="text-center px-3 py-2">Real</th><th className="text-center px-3 py-2">Evento puntual</th><th className="text-left px-3 py-2">Origen</th><th className="text-right px-3 py-2">Acciones</th></tr>
            </thead>
            <tbody>
              {q.data?.items.slice(0, 200).map((f) => (
                <tr key={f.id} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(f.fecha)}</td>
                  <td className="px-3 py-2">{f.unidad_nombre ?? `#${f.unidad_negocio_id}`}</td>
                  <td className="px-3 py-2 text-text-muted">{f.empresa_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtArs(f.monto)}</td>
                  <td className="px-3 py-2 text-center">{f.es_real ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-center">{f.es_evento_puntual ? <span className="text-amber-700 text-xs">⚠</span> : "—"}</td>
                  <td className="px-3 py-2 text-text-muted text-xs">{f.origen}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { if (confirm(`Eliminar fila?`)) del.mutate(f.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && q.data.items.length > 200 && <div className="px-3 py-2 text-center text-text-muted text-xs bg-soft">Mostrando primeras 200 de {q.data.items.length} filas</div>}
        </div>
      )}

      {showCreate && <FacturacionModal unidades={unidades.data?.items ?? []} empresas={empresas.data?.items ?? []} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["ff", "facturacion"] }); }} />}
    </PageWrapper>
  );
}

function FacturacionModal({ unidades, empresas, onClose, onSaved }: { unidades: Unidad[]; empresas: { id: number; nombre: string }[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    monto: "", unidad_negocio_id: unidades[0]?.id ?? 0, empresa_id: "",
    es_real: true, es_evento_puntual: false,
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/flujo-fondos/facturacion", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">Carga manual de facturacion</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { fecha: form.fecha, monto: Number(form.monto), unidad_negocio_id: Number(form.unidad_negocio_id), es_real: form.es_real, es_evento_puntual: form.es_evento_puntual };
          if (form.empresa_id) body.empresa_id = Number(form.empresa_id);
          m.mutate(body);
        }} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha *</label><input required type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Monto *</label><input required type="number" step="0.01" min="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Unidad de negocio *</label><select required value={form.unidad_negocio_id} onChange={(e) => setForm({ ...form, unidad_negocio_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Empresa</label><select value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">—</option>{empresas.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}</select></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.es_real} onChange={(e) => setForm({ ...form, es_real: e.target.checked })} /> Es real (no proyectado)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.es_evento_puntual} onChange={(e) => setForm({ ...form, es_evento_puntual: e.target.checked })} /> Evento puntual (excluir de promedios)</label>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5">{m.isPending && <Loader2 size={12} className="animate-spin" />}Crear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
