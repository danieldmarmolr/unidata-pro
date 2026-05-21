"use client";

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2, Plus, X, Search } from "lucide-react";
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

type Lista = {
  items: Erogacion[];
  total: number;
  limit: number;
  offset: number;
};

type Maestro = { id: number; nombre: string };

const ESTADOS = ["pendiente", "en_curso", "pagado", "cancelado", "rechazado"] as const;

export default function ErogacionesPage() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<string>("");
  const [empresaId, setEmpresaId] = useState<string>("");
  const [bancoId, setBancoId] = useState<string>("");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const limit = 25;

  const empresasQ = useQuery<{ items: Maestro[] }>({
    queryKey: ["flujo-fondos", "empresas"],
    queryFn: () => api("/api/flujo-fondos/empresas"),
    staleTime: 5 * 60_000,
  });
  const bancosQ = useQuery<{ items: Maestro[] }>({
    queryKey: ["flujo-fondos", "bancos"],
    queryFn: () => api("/api/flujo-fondos/bancos"),
    staleTime: 5 * 60_000,
  });
  const proveedoresQ = useQuery<{ items: Maestro[] }>({
    queryKey: ["flujo-fondos", "proveedores"],
    queryFn: () => api("/api/flujo-fondos/proveedores"),
    staleTime: 5 * 60_000,
  });

  const params = new URLSearchParams();
  if (estado) params.set("estado", estado);
  if (empresaId) params.set("empresa_id", empresaId);
  if (bancoId) params.set("banco_id", bancoId);
  if (proveedorId) params.set("proveedor_id", proveedorId);
  if (q.trim()) params.set("q", q.trim());
  params.set("limit", String(limit));
  params.set("offset", String(page * limit));

  const listQ = useQuery<Lista>({
    queryKey: ["flujo-fondos", "erogaciones", estado, empresaId, bancoId, proveedorId, q, page],
    queryFn: () => api<Lista>(`/api/flujo-fondos/erogaciones?${params.toString()}`),
    staleTime: 30_000,
  });

  const totalPages = listQ.data ? Math.ceil(listQ.data.total / limit) : 0;

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-4">
      {/* Header + acciones */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm text-text-muted">
            {listQ.data ? `${listQ.data.total} erogaciones` : "Cargando..."}
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"
        >
          <Plus size={14} /> Nueva erogacion
        </button>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-border bg-surface p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Select value={estado} onChange={(v) => { setEstado(v); setPage(0); }} label="Estado">
          <option value="">Todos</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
          ))}
        </Select>
        <Select value={empresaId} onChange={(v) => { setEmpresaId(v); setPage(0); }} label="Empresa">
          <option value="">Todas</option>
          {empresasQ.data?.items.map((e) => (
            <option key={e.id} value={String(e.id)}>{e.nombre}</option>
          ))}
        </Select>
        <Select value={bancoId} onChange={(v) => { setBancoId(v); setPage(0); }} label="Banco">
          <option value="">Todos</option>
          {bancosQ.data?.items.map((b) => (
            <option key={b.id} value={String(b.id)}>{b.nombre}</option>
          ))}
        </Select>
        <Select value={proveedorId} onChange={(v) => { setProveedorId(v); setPage(0); }} label="Proveedor">
          <option value="">Todos</option>
          {proveedoresQ.data?.items.map((p) => (
            <option key={p.id} value={String(p.id)}>{p.nombre}</option>
          ))}
        </Select>
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Buscar</label>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder="Descripcion, nota, categoria..."
              className="w-full pl-7 pr-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {listQ.isLoading ? (
          <div className="p-10 text-center text-text-muted flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando erogaciones...
          </div>
        ) : listQ.error ? (
          <div className="p-10 text-center text-rose-600">{(listQ.error as Error).message}</div>
        ) : listQ.data && listQ.data.items.length === 0 ? (
          <div className="p-10 text-center text-text-muted">Sin resultados</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-left px-3 py-2">Descripcion</th>
                  <th className="text-left px-3 py-2">Empresa</th>
                  <th className="text-left px-3 py-2">Proveedor</th>
                  <th className="text-left px-3 py-2">Banco</th>
                  <th className="text-right px-3 py-2">Monto</th>
                  <th className="text-left px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {listQ.data?.items.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-soft">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.fecha_pago)}</td>
                    <td className="px-3 py-2 max-w-md truncate text-text">{e.descripcion}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">{e.empresa_nombre ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">{e.proveedor_nombre ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">{e.banco_nombre ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-text whitespace-nowrap">{fmtArs(e.monto)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[e.estado] ?? "bg-slate-100"}`}>
                        {ESTADO_LABEL[e.estado] ?? e.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginacion */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Pagina {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1.5 border border-border rounded-md text-text hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-border rounded-md text-text hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
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
            qc.invalidateQueries({ queryKey: ["flujo-fondos", "erogaciones"] });
            qc.invalidateQueries({ queryKey: ["flujo-fondos", "kpis"] });
          }}
        />
      )}
    </div>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none bg-surface"
      >
        {children}
      </select>
    </div>
  );
}

function CreateModal({
  empresas,
  bancos,
  proveedores,
  onClose,
  onCreated,
}: {
  empresas: Maestro[];
  bancos: Maestro[];
  proveedores: Maestro[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    fecha_pago: new Date().toISOString().slice(0, 10),
    descripcion: "",
    monto: "",
    empresa_id: empresas[0]?.id ?? 0,
    banco_id: bancos[0]?.id ?? 0,
    proveedor_id: "",
    estado: "pendiente",
    categoria: "",
    notas: "",
    es_critico: false,
  });

  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/flujo-fondos/erogaciones", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => onCreated(),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      fecha_pago: form.fecha_pago,
      descripcion: form.descripcion.trim(),
      monto: Number(form.monto),
      empresa_id: Number(form.empresa_id),
      banco_id: Number(form.banco_id),
      estado: form.estado,
      es_critico: form.es_critico,
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
          <Field label="Descripcion *">
            <input
              required
              type="text"
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de pago *">
              <input
                required
                type="date"
                value={form.fecha_pago}
                onChange={(e) => setForm((f) => ({ ...f, fecha_pago: e.target.value }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </Field>
            <Field label="Monto (ARS) *">
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Empresa *">
              <select
                required
                value={form.empresa_id}
                onChange={(e) => setForm((f) => ({ ...f, empresa_id: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none bg-surface"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Banco *">
              <select
                required
                value={form.banco_id}
                onChange={(e) => setForm((f) => ({ ...f, banco_id: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none bg-surface"
              >
                {bancos.map((b) => (
                  <option key={b.id} value={b.id}>{b.nombre}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proveedor">
              <select
                value={form.proveedor_id}
                onChange={(e) => setForm((f) => ({ ...f, proveedor_id: e.target.value }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none bg-surface"
              >
                <option value="">(sin proveedor)</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Estado">
              <select
                value={form.estado}
                onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
                className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none bg-surface"
              >
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Categoria">
            <input
              type="text"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
              className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </Field>
          <Field label="Notas">
            <textarea
              rows={2}
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              className="w-full px-2 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.es_critico}
              onChange={(e) => setForm((f) => ({ ...f, es_critico: e.target.checked }))}
            />
            Pago critico (alertas priorizadas)
          </label>
          {m.error && (
            <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-soft"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={m.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {m.isPending && <Loader2 size={12} className="animate-spin" />}
              Crear
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
