"use client";

import { useState } from "react";
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

  // Augmentar items con la sugerencia para que sea filtrable/sortable
  const rows = (q.data?.items ?? []).map((p) => ({ ...p, sugerencia: sugerencias[p.id] ?? null }));
  type Row = Pago & { sugerencia: string | null };

  const columns: Column<Row>[] = [
    {
      key: "fecha_pago", label: "Fecha original", type: "date",
      getValue: (r) => r.fecha_pago,
      render: (r) => <span className="whitespace-nowrap text-text-muted">{fmtDate(r.fecha_pago)}</span>,
    },
    {
      key: "dias_atraso", label: "Dias atraso", align: "center", type: "number",
      getValue: (r) => r.dias_atraso,
      render: (r) => <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">{r.dias_atraso}d</span>,
    },
    {
      key: "descripcion", label: "Descripcion",
      getValue: (r) => r.descripcion,
      render: (r) => <span className="block max-w-md truncate" title={r.descripcion}>{r.descripcion}</span>,
    },
    { key: "proveedor_nombre", label: "Proveedor", getValue: (r) => r.proveedor_nombre ?? "", className: "text-text-muted" },
    {
      key: "monto", label: "Monto", align: "right", type: "number",
      getValue: (r) => Number(r.monto),
      render: (r) => <span className="font-semibold whitespace-nowrap">{fmtArs(r.monto)}</span>,
    },
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Pagos atrasados" value={`${q.data.count}`} highlight />
          <Tile label="Monto total" value={fmtArs(q.data.total_monto)} color="text-rose-700" />
          <Tile label="Colchon configurado" value={fmtArs(colchon)} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Colchon (saldo minimo a mantener)</label>
          <input type="number" step="100000" value={colchon} onChange={(e) => setColchon(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm w-48" />
        </div>
        <button onClick={() => sugerir.mutate(colchon)} disabled={sugerir.isPending || !q.data || q.data.items.length === 0} className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {sugerir.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Sugerir fechas
        </button>
        {sugerir.isSuccess && <div className="text-xs text-emerald-700">Sugerencias calculadas. Revisa abajo y aplica/cancela cada una.</div>}
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "prioridad_atraso", dir: "asc" }}
          emptyLabel="Sin pagos atrasados — todo al dia ✓"
          renderActions={(r) => (
            <>
              {r.sugerencia && (
                <button onClick={() => aplicarTentativa.mutate({ id: r.id, fecha: r.sugerencia! })} title="Aplicar sugerencia" className="text-blue-700 hover:bg-blue-50 p-1 rounded"><Sparkles size={14} /></button>
              )}
              {r.fecha_sugerida_tentativa && (
                <>
                  <button onClick={() => confirmar.mutate(r.id)} title="Confirmar fecha tentativa" className="text-emerald-700 hover:bg-emerald-50 p-1 rounded"><Check size={14} /></button>
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
