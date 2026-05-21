"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2, Sparkles, Check, X as XIcon } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState, Tile } from "../_components/PageWrapper";
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
    mutationFn: (c: number) => api<{ sugerencias: Sugerencia[]; colchon: number; saldo_inicial: number; horizonte_dias: number }>(`/api/flujo-fondos/pagos-atrasados/sugerir?colchon=${c}`, { method: "POST" }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ff", "pagos-atrasados"] });
      qc.invalidateQueries({ queryKey: ["ff", "kpis"] });
    },
  });

  return (
    <PageWrapper>
      {/* Resumen */}
      {q.data && q.data.items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Pagos atrasados" value={`${q.data.count}`} highlight />
          <Tile label="Monto total" value={fmtArs(q.data.total_monto)} color="text-rose-700" />
          <Tile label="Colchon configurado" value={fmtArs(colchon)} />
        </div>
      )}

      {/* Controles motor */}
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

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? <EmptyState label="Sin pagos atrasados — todo al dia ✓" /> : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left px-3 py-2">Fecha original</th>
                  <th className="text-center px-3 py-2">Dias atraso</th>
                  <th className="text-left px-3 py-2">Descripcion</th>
                  <th className="text-left px-3 py-2">Proveedor</th>
                  <th className="text-right px-3 py-2">Monto</th>
                  <th className="text-center px-3 py-2">Prioridad</th>
                  <th className="text-left px-3 py-2">Tentativa actual</th>
                  <th className="text-left px-3 py-2">Sugerencia motor</th>
                  <th className="text-right px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.items.map((p) => {
                  const sug = sugerencias[p.id];
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-soft">
                      <td className="px-3 py-2 whitespace-nowrap text-text-muted">{fmtDate(p.fecha_pago)}</td>
                      <td className="px-3 py-2 text-center"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">{p.dias_atraso}d</span></td>
                      <td className="px-3 py-2 max-w-md truncate">{p.descripcion}</td>
                      <td className="px-3 py-2 text-text-muted">{p.proveedor_nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{fmtArs(p.monto)}</td>
                      <td className="px-3 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${p.prioridad_atraso === "normal" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{p.prioridad_atraso}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{p.fecha_sugerida_tentativa ? <span className="text-blue-700 font-semibold">{fmtDate(p.fecha_sugerida_tentativa)}</span> : <span className="text-text-muted">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{sug === undefined ? <span className="text-text-muted">—</span> : sug ? <span className="text-emerald-700 font-semibold">{fmtDate(sug)}</span> : <span className="text-rose-600 text-xs">Sin dia viable</span>}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        {sug && (
                          <button onClick={() => aplicarTentativa.mutate({ id: p.id, fecha: sug })} title="Aplicar sugerencia como tentativa" className="text-blue-700 hover:bg-blue-50 p-1 rounded"><Sparkles size={14} /></button>
                        )}
                        {p.fecha_sugerida_tentativa && (
                          <>
                            <button onClick={() => confirmar.mutate(p.id)} title="Confirmar fecha tentativa como real" className="text-emerald-700 hover:bg-emerald-50 p-1 rounded"><Check size={14} /></button>
                            <button onClick={() => aplicarTentativa.mutate({ id: p.id, fecha: null })} title="Cancelar tentativa" className="text-rose-600 hover:bg-rose-50 p-1 rounded"><XIcon size={14} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
