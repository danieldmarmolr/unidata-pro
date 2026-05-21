"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2, Plus, X, Pencil, Trash2, Eye, EyeOff, Check, Download, Sparkles } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate, ESTADO_LABEL, ESTADO_COLOR } from "../_components/helpers";

type Erogacion = {
  id: number;
  fecha_pago: string;
  descripcion: string;
  monto: number | string;
  moneda: string;
  estado: string;
  empresa_id: number;
  empresa_nombre?: string;
  banco_id: number;
  banco_nombre?: string;
  proveedor_id: number | null;
  proveedor_nombre?: string;
  categoria: string | null;
  notas?: string | null;
  es_critico: boolean;
  oculto: boolean;
};

type Lista = { items: Erogacion[]; total: number; limit: number; offset: number };
type Maestro = { id: number; nombre: string };

const ESTADOS = ["pendiente", "en_curso", "pagado", "cancelado", "rechazado"] as const;

type Vista = "todas" | "atrasadas" | "para_hoy" | "proximos_7d" | "proximos_30d" | "ocultas";

const VISTAS: { key: Vista; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "para_hoy", label: "Para hoy" },
  { key: "proximos_7d", label: "Proximos 7d" },
  { key: "proximos_30d", label: "Proximos 30d" },
  { key: "ocultas", label: "Ocultas" },
];

function buildParams(vista: Vista, page: number, limit: number): URLSearchParams {
  const p = new URLSearchParams();
  p.set("limit", String(limit));
  p.set("offset", String(page * limit));
  const today = new Date().toISOString().slice(0, 10);
  const plus7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const plus30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (vista === "atrasadas") p.set("solo_atrasadas", "true");
  if (vista === "para_hoy") { p.set("fecha_desde", today); p.set("fecha_hasta", today); }
  if (vista === "proximos_7d") { p.set("fecha_desde", today); p.set("fecha_hasta", plus7); }
  if (vista === "proximos_30d") { p.set("fecha_desde", today); p.set("fecha_hasta", plus30); }
  if (vista === "ocultas") p.set("incluir_ocultas", "true");
  return p;
}

export default function ErogacionesPage() {
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>("todas");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Erogacion | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | { kind: "estado" | "fecha" | "ocultar" | "borrar"; estado?: string; oculto?: boolean }>(null);
  const limit = 100;

  const empresasQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "empresas"], queryFn: () => api("/api/flujo-fondos/empresas"), staleTime: 5 * 60_000 });
  const bancosQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "bancos"], queryFn: () => api("/api/flujo-fondos/bancos"), staleTime: 5 * 60_000 });
  const proveedoresQ = useQuery<{ items: Maestro[] }>({ queryKey: ["ff", "proveedores"], queryFn: () => api("/api/flujo-fondos/proveedores"), staleTime: 5 * 60_000 });

  const params = buildParams(vista, page, limit);
  const listQ = useQuery<Lista>({ queryKey: ["ff", "erogaciones", vista, page], queryFn: () => api<Lista>(`/api/flujo-fondos/erogaciones?${params.toString()}`), staleTime: 30_000 });

  // Hotkey: N = nueva
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setShowCreate(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = listQ.data?.items ?? [];
  const totalPages = listQ.data ? Math.ceil(listQ.data.total / limit) : 0;

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected((prev) => prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  }
  function clearSelection() { setSelected(new Set()); }

  const bulkUpdate = useMutation({
    mutationFn: (body: { ids: number[]; changes: Record<string, unknown> }) =>
      api("/api/flujo-fondos/erogaciones/bulk-update", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ff", "erogaciones"] });
      qc.invalidateQueries({ queryKey: ["ff", "kpis"] });
      clearSelection();
      setBulkAction(null);
    },
  });
  const bulkDelete = useMutation({
    mutationFn: (ids: number[]) => api("/api/flujo-fondos/erogaciones/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ff", "erogaciones"] });
      qc.invalidateQueries({ queryKey: ["ff", "kpis"] });
      clearSelection();
      setBulkAction(null);
    },
  });

  function exportCSV() {
    const headers = ["Fecha", "Descripcion", "Monto", "Moneda", "Empresa", "Banco", "Proveedor", "Estado", "Categoria", "Critico", "Notas", "Oculto"];
    const rows = items.map((r) => [
      r.fecha_pago.slice(0, 10),
      r.descripcion,
      String(r.monto),
      r.moneda,
      r.empresa_nombre ?? "",
      r.banco_nombre ?? "",
      r.proveedor_nombre ?? "",
      r.estado,
      r.categoria ?? "",
      r.es_critico ? "si" : "no",
      r.notas ?? "",
      r.oculto ? "si" : "no",
    ]);
    const esc = (v: string) => `"${v.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const csv = "﻿" + [headers.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `erogaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<Erogacion>[] = [
    {
      key: "_sel", label: "", filterable: false, sortable: false, width: "w-10", align: "center",
      render: (r) => (
        <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(r.id); }} onClick={(e) => e.stopPropagation()} />
      ),
    },
    {
      key: "fecha_pago", label: "Fecha", type: "date",
      getValue: (r) => r.fecha_pago,
      render: (r) => {
        const today = new Date().toISOString().slice(0, 10);
        const atrasada = r.fecha_pago < today && ["pendiente", "en_curso"].includes(r.estado);
        return (
          <span className="whitespace-nowrap">
            {fmtDate(r.fecha_pago)}
            {atrasada && <span className="ml-1 text-[9px] text-rose-600 font-bold uppercase">vencido</span>}
          </span>
        );
      },
    },
    {
      key: "descripcion", label: "Descripcion",
      getValue: (r) => r.descripcion,
      render: (r) => (
        <span className="block max-w-md truncate" title={r.descripcion}>
          {r.es_critico && <span className="text-amber-600 mr-1">🔥</span>}
          {r.descripcion}
        </span>
      ),
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
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Total cargado" value={listQ.data ? `${listQ.data.total}` : "..."} />
        <Tile label="Mostradas" value={`${items.length}`} />
        <Tile label="Seleccionadas" value={`${selected.size}`} highlight={selected.size > 0} />
        <Tile label="Pagina" value={totalPages > 0 ? `${page + 1}/${totalPages}` : "1/1"} />
      </div>

      {/* Vistas predefinidas */}
      <div className="rounded-xl border border-border bg-surface p-3 flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {VISTAS.map((v) => (
            <button
              key={v.key}
              onClick={() => { setVista(v.key); setPage(0); clearSelection(); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${vista === v.key ? "bg-primary text-white" : "text-text-muted hover:text-text hover:bg-soft"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} disabled={items.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-medium hover:bg-soft disabled:opacity-50"><Download size={12} /> Exportar CSV</button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"><Plus size={12} /> Nueva <kbd className="ml-1 px-1 py-0.5 text-[9px] bg-white/20 rounded">N</kbd></button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="rounded-xl border-2 border-primary bg-primary/5 p-3 flex flex-wrap gap-2 items-center justify-between sticky top-0 z-20">
          <div className="text-sm text-text">
            <strong>{selected.size}</strong> seleccionadas
            <button onClick={clearSelection} className="ml-3 text-xs text-text-muted hover:text-text underline">Deseleccionar</button>
            <button onClick={selectAll} className="ml-3 text-xs text-text-muted hover:text-text underline">Todas en pagina</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setBulkAction({ kind: "estado", estado: "pagado" })} className="px-2.5 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:opacity-90 flex items-center gap-1"><Check size={11} /> Pagado</button>
            <button onClick={() => setBulkAction({ kind: "estado", estado: "en_curso" })} className="px-2.5 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:opacity-90">En curso</button>
            <button onClick={() => setBulkAction({ kind: "estado", estado: "cancelado" })} className="px-2.5 py-1.5 text-xs rounded-md bg-slate-600 text-white hover:opacity-90">Cancelado</button>
            <button onClick={() => setBulkAction({ kind: "fecha" })} className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-surface text-text hover:bg-soft">Cambiar fecha</button>
            <button onClick={() => setBulkAction({ kind: "ocultar", oculto: true })} className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-surface text-text hover:bg-soft flex items-center gap-1"><EyeOff size={11} /> Ocultar</button>
            <button onClick={() => setBulkAction({ kind: "ocultar", oculto: false })} className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-surface text-text hover:bg-soft flex items-center gap-1"><Eye size={11} /> Mostrar</button>
            <button onClick={() => { if (confirm(`Eliminar ${selected.size} erogaciones?`)) bulkDelete.mutate(Array.from(selected)); }} className="px-2.5 py-1.5 text-xs rounded-md bg-rose-600 text-white hover:opacity-90 flex items-center gap-1"><Trash2 size={11} /> Borrar</button>
          </div>
        </div>
      )}

      {listQ.isLoading ? <LoadingState label="Cargando erogaciones..." /> : listQ.error ? <ErrorState message={(listQ.error as Error).message} /> : (
        <DataTable
          data={items}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "fecha_pago", dir: "desc" }}
          emptyLabel="Sin erogaciones"
          renderActions={(r) => (
            <>
              <button onClick={() => setEditing(r)} className="text-text-muted hover:text-primary p-1" title="Editar"><Pencil size={14} /></button>
              <button onClick={() => bulkUpdate.mutate({ ids: [r.id], changes: { oculto: !r.oculto } })} className="text-text-muted hover:text-primary p-1" title={r.oculto ? "Mostrar" : "Ocultar"}>{r.oculto ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              <button onClick={() => { if (confirm(`Eliminar?`)) bulkDelete.mutate([r.id]); }} className="text-text-muted hover:text-rose-600 p-1" title="Eliminar"><Trash2 size={14} /></button>
            </>
          )}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Pagina {page + 1} de {totalPages} · lotes de {limit}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => { setPage((p) => Math.max(0, p - 1)); clearSelection(); }} className="px-3 py-1.5 border border-border rounded-md hover:bg-soft disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages - 1} onClick={() => { setPage((p) => p + 1); clearSelection(); }} className="px-3 py-1.5 border border-border rounded-md hover:bg-soft disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      )}

      {bulkAction && bulkAction.kind === "estado" && (
        <ConfirmBulk
          title={`Marcar ${selected.size} como ${ESTADO_LABEL[bulkAction.estado!]}?`}
          onConfirm={() => bulkUpdate.mutate({ ids: Array.from(selected), changes: { estado: bulkAction.estado } })}
          onCancel={() => setBulkAction(null)}
          pending={bulkUpdate.isPending}
        />
      )}
      {bulkAction && bulkAction.kind === "fecha" && (
        <BulkFechaModal
          count={selected.size}
          onConfirm={(fecha) => bulkUpdate.mutate({ ids: Array.from(selected), changes: { fecha_pago: fecha } })}
          onCancel={() => setBulkAction(null)}
          pending={bulkUpdate.isPending}
        />
      )}
      {bulkAction && bulkAction.kind === "ocultar" && (
        <ConfirmBulk
          title={`${bulkAction.oculto ? "Ocultar" : "Mostrar"} ${selected.size} erogaciones?`}
          onConfirm={() => bulkUpdate.mutate({ ids: Array.from(selected), changes: { oculto: bulkAction.oculto } })}
          onCancel={() => setBulkAction(null)}
          pending={bulkUpdate.isPending}
        />
      )}

      {(showCreate || editing) && (
        <ErogacionModal
          item={editing}
          empresas={empresasQ.data?.items ?? []}
          bancos={bancosQ.data?.items ?? []}
          proveedores={proveedoresQ.data?.items ?? []}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => {
            setShowCreate(false); setEditing(null);
            qc.invalidateQueries({ queryKey: ["ff", "erogaciones"] });
            qc.invalidateQueries({ queryKey: ["ff", "kpis"] });
          }}
        />
      )}
    </PageWrapper>
  );
}

function ConfirmBulk({ title, onConfirm, onCancel, pending }: { title: string; onConfirm: () => void; onCancel: () => void; pending: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-5">
          <h3 className="text-sm font-bold mb-3">{title}</h3>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button onClick={onConfirm} disabled={pending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {pending && <Loader2 size={12} className="animate-spin" />}Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BulkFechaModal({ count, onConfirm, onCancel, pending }: { count: number; onConfirm: (fecha: string) => void; onCancel: () => void; pending: boolean }) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-5 space-y-3">
          <h3 className="text-sm font-bold">Cambiar fecha de pago a {count} erogaciones</h3>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" />
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button onClick={() => onConfirm(fecha)} disabled={pending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {pending && <Loader2 size={12} className="animate-spin" />}Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErogacionModal({ item, empresas, bancos, proveedores, onClose, onSaved }: { item: Erogacion | null; empresas: Maestro[]; bancos: Maestro[]; proveedores: Maestro[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fecha_pago: item?.fecha_pago?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    descripcion: item?.descripcion ?? "",
    monto: item?.monto?.toString() ?? "",
    empresa_id: item?.empresa_id ?? empresas[0]?.id ?? 0,
    banco_id: item?.banco_id ?? bancos[0]?.id ?? 0,
    proveedor_id: item?.proveedor_id?.toString() ?? "",
    estado: item?.estado ?? "pendiente",
    categoria: item?.categoria ?? "",
    notas: item?.notas ?? "",
    es_critico: item?.es_critico ?? false,
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(item ? `/api/flujo-fondos/erogaciones/${item.id}` : "/api/flujo-fondos/erogaciones",
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      fecha_pago: form.fecha_pago, descripcion: form.descripcion.trim(), monto: Number(form.monto),
      empresa_id: Number(form.empresa_id), banco_id: Number(form.banco_id),
      estado: form.estado, es_critico: form.es_critico,
    };
    body.proveedor_id = form.proveedor_id ? Number(form.proveedor_id) : null;
    body.categoria = form.categoria.trim() || null;
    body.notas = form.notas.trim() || null;
    m.mutate(body);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-text">{item ? "Editar erogacion" : "Nueva erogacion"}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Descripcion *</label><input required type="text" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.es_critico} onChange={(e) => setForm({ ...form, es_critico: e.target.checked })} /> Pago critico</label>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">{m.isPending && <Loader2 size={12} className="animate-spin" />}{item ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
