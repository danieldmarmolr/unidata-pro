"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2, Sparkles, Check, X as XIcon } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate } from "../_components/helpers";

type Pago = {
  id: number; fecha_pago: string; monto: number; prioridad_atraso: string;
  descripcion: string; estado: string; fecha_sugerida_tentativa: string | null;
  empresa_nombre?: string; banco_nombre?: string; proveedor_nombre?: string;
  dias_atraso: number;
};
type Sugerencia = { id: number; fecha_sugerida: string | null };

const COLCHON_DEFAULT = 6_000_000;

export default function PagosAtrasadosPage() {
  const qc = useQueryClient();
  const [colchon, setColchon] = useState(COLCHON_DEFAULT);
  const [sugerencias, setSugerencias] = useState<Record<number, string | null>>({});
  const [filtroPrioridad, setFiltroPrioridad] = useState<"" | "normal" | "laxo">("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const q = useQuery<{ items: Pago[]; count: number; total_monto: number }>({
    queryKey: ["ff", "pagos-atrasados"],
    queryFn: () => api("/api/flujo-fondos/pagos-atrasados"),
  });

  const sugerir = useMutation({
    mutationFn: (c: number) => api<{ sugerencias: Sugerencia[] }>(`/api/flujo-fondos/pagos-atrasados/sugerir?colchon=${c}`, { method: "POST" }),
    onSuccess: (data) => {
      const map: Record<number, string | null> = {};
      for (const s of data.sugerencias) map[s.id] = s.fecha_sugerida;
      setSugerencias(map);
    },
  });
  const aplicarTentativa = useMutation({
    mutationFn: ({ id, fecha }: { id: number; fecha: string | null }) =>
      api(`/api/flujo-fondos/pagos-atrasados/${id}/aplicar-tentativa`, { method: "POST", body: JSON.stringify({ fecha_sugerida_tentativa: fecha }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ff", "pagos-atrasados"] }),
  });
  const confirmar = useMutation({
    mutationFn: (id: number) => api(`/api/flujo-fondos/pagos-atrasados/${id}/confirmar`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ff", "pagos-atrasados"] }); qc.invalidateQueries({ queryKey: ["ff", "kpis"] }); },
  });

  const items = q.data?.items ?? [];
  const filtered = useMemo(() => filtroPrioridad ? items.filter((p) => p.prioridad_atraso === filtroPrioridad) : items, [items, filtroPrioridad]);
  const rows = filtered.map((p) => ({ ...p, sugerencia: sugerencias[p.id] ?? null }));
  type Row = Pago & { sugerencia: string | null };

  function toggleSelect(id: number) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkAplicarSugerencias() {
    const promises = Array.from(selected).map((id) => {
      const sug = sugerencias[id];
      if (sug) return aplicarTentativa.mutateAsync({ id, fecha: sug });
      return Promise.resolve();
    });
    await Promise.all(promises);
    setSelected(new Set());
  }
  async function bulkConfirmar() {
    await Promise.all(Array.from(selected).map((id) => confirmar.mutateAsync(id)));
    setSelected(new Set());
  }
  async function bulkCancelar() {
    await Promise.all(Array.from(selected).map((id) => aplicarTentativa.mutateAsync({ id, fecha: null })));
    setSelected(new Set());
  }

  const conTentativaCount = items.filter((i) => i.fecha_sugerida_tentativa).length;
  const sinViabilidadCount = Object.values(sugerencias).filter((s) => s === null).length;
  const seleccionConSugerencia = Array.from(selected).filter((id) => sugerencias[id]).length;
  const seleccionConTentativa = Array.from(selected).filter((id) => items.find((p) => p.id === id)?.fecha_sugerida_tentativa).length;

  const columns: Column<Row>[] = [
    {
      key: "_sel", label: "", filterable: false, sortable: false, width: "w-10", align: "center",
      render: (r) => <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />,
    },
    { key: "fecha_pago", label: "Fecha original", type: "date", getValue: (r) => r.fecha_pago, render: (r) => <span className="whitespace-nowrap text-text-muted">{fmtDate(r.fecha_pago)}</span> },
    {
      key: "dias_atraso", label: "Dias atraso", align: "center", type: "number",
      getValue: (r) => r.dias_atraso,
      render: (r) => <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${r.dias_atraso > 30 ? "bg-rose-200 text-rose-900" : "bg-rose-100 text-rose-700"}`}>{r.dias_atraso}d</span>,
    },
    { key: "descripcion", label: "Descripcion", getValue: (r) => r.descripcion, render: (r) => <span className="block max-w-md truncate" title={r.descripcion}>{r.descripcion}</span> },
    { key: "proveedor_nombre", label: "Proveedor", getValue: (r) => r.proveedor_nombre ?? "", className: "text-text-muted" },
    { key: "monto", label: "Monto", align: "right", type: "number", getValue: (r) => Number(r.monto), render: (r) => <span className="font-semibold whitespace-nowrap">{fmtArs(r.monto)}</span> },
    {
      key: "prioridad_atraso", label: "Prioridad", align: "center", getValue: (r) => r.prioridad_atraso,
      render: (r) => <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${r.prioridad_atraso === "normal" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{r.prioridad_atraso}</span>,
    },
    {
      key: "fecha_sugerida_tentativa", label: "Tentativa actual", type: "date",
      getValue: (r) => r.fecha_sugerida_tentativa ?? "",
      render: (r) => r.fecha_sugerida_tentativa ? <span className="text-blue-700 font-semibold whitespace-nowrap">{fmtDate(r.fecha_sugerida_tentativa)}</span> : <span className="text-text-muted">—</span>,
    },
    {
      key: "sugerencia", label: "Sugerencia motor", type: "date",
      getValue: (r) => r.sugerencia ?? "",
      render: (r) => r.sugerencia === null && sugerencias[r.id] === undefined
        ? <span className="text-text-muted">—</span>
        : r.sugerencia
          ? <span className="text-emerald-700 font-semibold whitespace-nowrap">{fmtDate(r.sugerencia)}</span>
          : <span className="text-rose-600 text-xs">Sin dia viable</span>,
    },
  ];

  return (
    <PageWrapper>
      {q.data && q.data.items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Pagos atrasados" value={`${q.data.count}`} highlight />
          <Tile label="Monto total" value={fmtArs(q.data.total_monto)} color="text-rose-700" />
          <Tile label="Con tentativa" value={`${conTentativaCount}`} color="text-blue-700" />
          <Tile label="Colchon configurado" value={fmtArs(colchon)} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Colchon (saldo minimo a mantener)</label>
          <input type="number" step="100000" value={colchon} onChange={(e) => setColchon(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm w-48" />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Filtrar prioridad</label>
          <select value={filtroPrioridad} onChange={(e) => setFiltroPrioridad(e.target.value as "" | "normal" | "laxo")} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface">
            <option value="">Todas</option>
            <option value="normal">Solo normales</option>
            <option value="laxo">Solo laxos</option>
          </select>
        </div>
        <button onClick={() => sugerir.mutate(colchon)} disabled={sugerir.isPending || filtered.length === 0} className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {sugerir.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Sugerir fechas
        </button>
        {sugerir.isSuccess && (
          <div className="text-xs text-emerald-700">✓ Sugerencias calculadas {sinViabilidadCount > 0 ? `(${sinViabilidadCount} sin viabilidad)` : ""}</div>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="rounded-xl border-2 border-primary bg-primary/5 p-3 flex flex-wrap gap-2 items-center justify-between sticky top-0 z-20">
          <div className="text-sm text-text"><strong>{selected.size}</strong> seleccionados <button onClick={() => setSelected(new Set())} className="ml-2 text-xs text-text-muted underline">limpiar</button></div>
          <div className="flex flex-wrap gap-1.5">
            {seleccionConSugerencia > 0 && (
              <button onClick={bulkAplicarSugerencias} className="px-2.5 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:opacity-90 flex items-center gap-1"><Sparkles size={11} /> Colocar en sugerencia ({seleccionConSugerencia})</button>
            )}
            {seleccionConTentativa > 0 && (
              <>
                <button onClick={bulkConfirmar} className="px-2.5 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:opacity-90 flex items-center gap-1"><Check size={11} /> Confirmar tentativas ({seleccionConTentativa})</button>
                <button onClick={bulkCancelar} className="px-2.5 py-1.5 text-xs rounded-md bg-rose-600 text-white hover:opacity-90 flex items-center gap-1"><XIcon size={11} /> Cancelar tentativas ({seleccionConTentativa})</button>
              </>
            )}
          </div>
        </div>
      )}

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "dias_atraso", dir: "desc" }}
          emptyLabel="Sin pagos atrasados — todo al dia ✓"
          renderActions={(r) => (
            <>
              {r.sugerencia && <button onClick={() => aplicarTentativa.mutate({ id: r.id, fecha: r.sugerencia! })} title="Aplicar sugerencia" className="text-blue-700 hover:bg-blue-50 p-1 rounded"><Sparkles size={14} /></button>}
              {r.fecha_sugerida_tentativa && (
                <>
                  <button onClick={() => confirmar.mutate(r.id)} title="Confirmar tentativa" className="text-emerald-700 hover:bg-emerald-50 p-1 rounded"><Check size={14} /></button>
                  <button onClick={() => aplicarTentativa.mutate({ id: r.id, fecha: null })} title="Cancelar tentativa" className="text-rose-600 hover:bg-rose-50 p-1 rounded"><XIcon size={14} /></button>
                </>
              )}
            </>
          )}
        />
      )}
    </PageWrapper>
  );
}
