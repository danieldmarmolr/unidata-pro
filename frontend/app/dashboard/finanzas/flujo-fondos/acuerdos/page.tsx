"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate } from "../_components/helpers";

type Acuerdo = {
  id: number; proveedor_id: number; tipo: string; compromiso: string;
  fecha_compromiso: string | null; monto_compromiso: number | string | null;
  estado: string; contexto: string | null; erogacion_id: number | null;
  proveedor_nombre?: string;
};
type Maestro = { id: number; nombre: string };
const TIPOS = ["diferimiento", "pago_parcial", "plan_cuotas", "otro"] as const;
const ESTADOS = ["pendiente", "cumplido", "incumplido"] as const;
const ESTADO_COLOR: Record<string, string> = { pendiente: "bg-amber-100 text-amber-700", cumplido: "bg-emerald-100 text-emerald-700", incumplido: "bg-rose-100 text-rose-700" };

function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null;
  const d = new Date(fecha + "T00:00:00").getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  return Math.floor((d - today) / (1000 * 60 * 60 * 24));
}

export default function AcuerdosPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Acuerdo | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [filtroTipo, setFiltroTipo] = useState<string>("");
  const [filtroProveedor, setFiltroProveedor] = useState<string>("");

  const url = filtroEstado ? `/api/flujo-fondos/acuerdos?estado=${filtroEstado}` : `/api/flujo-fondos/acuerdos`;
  const q = useQuery<{ items: Acuerdo[]; count: number }>({ queryKey: ["ff", "acuerdos", filtroEstado], queryFn: () => api(url) });
  const proveedores = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "proveedores"], queryFn: () => api("/api/flujo-fondos/proveedores"), staleTime: 5 * 60_000 });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/flujo-fondos/acuerdos/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "acuerdos"] }) });

  // KPIs sobre TODOS los items (sin filtro estado) - usamos data del filtro all
  const allQ = useQuery<{ items: Acuerdo[] }>({ queryKey: ["ff", "acuerdos-all"], queryFn: () => api("/api/flujo-fondos/acuerdos") });
  const all = allQ.data?.items ?? [];
  const pendientes = all.filter((a) => a.estado === "pendiente").length;
  const cumplidos = all.filter((a) => a.estado === "cumplido").length;
  const incumplidos = all.filter((a) => a.estado === "incumplido").length;

  // Filtros client-side adicionales
  const items = (q.data?.items ?? []).filter((a) => {
    if (filtroTipo && a.tipo !== filtroTipo) return false;
    if (filtroProveedor && String(a.proveedor_id) !== filtroProveedor) return false;
    return true;
  });

  const columns: Column<Acuerdo>[] = [
    {
      key: "proveedor_nombre", label: "Proveedor", getValue: (r) => r.proveedor_nombre ?? `#${r.proveedor_id}`,
      render: (r) => <Link href={`/dashboard/finanzas/flujo-fondos/proveedores/${r.proveedor_id}`} className="font-semibold text-primary hover:underline">{r.proveedor_nombre ?? `#${r.proveedor_id}`}</Link>,
    },
    { key: "tipo", label: "Tipo", getValue: (r) => r.tipo, render: (r) => <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100">{r.tipo}</span> },
    { key: "compromiso", label: "Compromiso", getValue: (r) => r.compromiso, render: (r) => <span className="block max-w-md truncate" title={r.compromiso}>{r.compromiso}</span> },
    {
      key: "fecha_compromiso", label: "Fecha", type: "date",
      getValue: (r) => r.fecha_compromiso ?? "",
      render: (r) => {
        if (!r.fecha_compromiso) return <span className="text-text-muted">—</span>;
        const d = diasHasta(r.fecha_compromiso);
        if (d === null || r.estado !== "pendiente") return <span className="whitespace-nowrap">{fmtDate(r.fecha_compromiso)}</span>;
        if (d < 0) return <span className="whitespace-nowrap"><span className="text-rose-700 font-semibold">{fmtDate(r.fecha_compromiso)}</span><br /><span className="text-[10px] text-rose-600">Vencido hace {Math.abs(d)}d</span></span>;
        if (d <= 7) return <span className="whitespace-nowrap"><span className="text-amber-700 font-semibold">{fmtDate(r.fecha_compromiso)}</span><br /><span className="text-[10px] text-amber-600">En {d}d</span></span>;
        return <span className="whitespace-nowrap">{fmtDate(r.fecha_compromiso)}</span>;
      },
    },
    {
      key: "monto_compromiso", label: "Monto", align: "right", type: "number",
      getValue: (r) => r.monto_compromiso != null ? Number(r.monto_compromiso) : null,
      render: (r) => r.monto_compromiso != null ? <span className="font-semibold">{fmtArs(r.monto_compromiso)}</span> : <span className="text-text-muted">—</span>,
    },
    {
      key: "estado", label: "Estado", align: "center", getValue: (r) => r.estado,
      render: (r) => <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_COLOR[r.estado] ?? ""}`}>{r.estado}</span>,
    },
  ];

  return (
    <PageWrapper>
      {/* KPI clickable cards */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => setFiltroEstado(filtroEstado === "pendiente" ? "" : "pendiente")} className={`rounded-lg p-3 text-left transition border-2 ${filtroEstado === "pendiente" ? "border-amber-500 bg-amber-50" : "border-amber-200 bg-amber-50/50 hover:border-amber-300"}`}>
          <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">Pendientes</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{pendientes}</div>
        </button>
        <button onClick={() => setFiltroEstado(filtroEstado === "cumplido" ? "" : "cumplido")} className={`rounded-lg p-3 text-left transition border-2 ${filtroEstado === "cumplido" ? "border-emerald-500 bg-emerald-50" : "border-emerald-200 bg-emerald-50/50 hover:border-emerald-300"}`}>
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">Cumplidos</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{cumplidos}</div>
        </button>
        <button onClick={() => setFiltroEstado(filtroEstado === "incumplido" ? "" : "incumplido")} className={`rounded-lg p-3 text-left transition border-2 ${filtroEstado === "incumplido" ? "border-rose-500 bg-rose-50" : "border-rose-200 bg-rose-50/50 hover:border-rose-300"}`}>
          <div className="text-[10px] uppercase tracking-wider text-rose-700 font-bold">Incumplidos</div>
          <div className="text-2xl font-bold text-rose-700 mt-1">{incumplidos}</div>
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-muted">{items.length} acuerdos {filtroEstado && `· estado: ${filtroEstado}`}</div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">Tipo: todos</option>{TIPOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)} className="px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="">Proveedor: todos</option>{proveedores.data?.items.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Nuevo acuerdo</button>
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={items}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "fecha_compromiso", dir: "asc" }}
          emptyLabel="Aun no hay acuerdos cargados"
          renderActions={(r) => (
            <>
              <button onClick={() => setEditing(r)} className="text-text-muted hover:text-primary p-1"><Pencil size={14} /></button>
              <button onClick={() => { if (confirm(`Eliminar acuerdo?`)) del.mutate(r.id); }} className="text-text-muted hover:text-rose-600 p-1"><Trash2 size={14} /></button>
            </>
          )}
        />
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
