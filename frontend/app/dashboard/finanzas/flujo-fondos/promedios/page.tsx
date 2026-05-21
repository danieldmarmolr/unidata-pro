"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact } from "../_components/helpers";

type Promedio = {
  unidad_negocio_id: number; unidad_nombre: string;
  dias_diferimiento: number; total_semanal_ponderado: number; total_semanal_simple: number;
  filas_usadas: number; filas_excluidas_evento_puntual: number;
  por_dow: Record<string, { ponderado: number; simple: number; n: number; desvio_pct: number }>;
};

const DOW_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

export default function PromediosPage() {
  const [semanas, setSemanas] = useState(12);
  const [decay, setDecay] = useState(0.85);

  const q = useQuery<{ items: Promedio[]; fecha_referencia: string }>({
    queryKey: ["ff", "promedios", semanas, decay],
    queryFn: () => api(`/api/flujo-fondos/promedios?semanas_ventana=${semanas}&decay=${decay}`),
  });

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Ventana (semanas)</label>
          <select value={semanas} onChange={(e) => setSemanas(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface">{[4, 8, 12, 16, 24, 36, 52].map(n => <option key={n} value={n}>{n}</option>)}</select>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Decay (peso)</label>
          <select value={decay} onChange={(e) => setDecay(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface">{[0.95, 0.9, 0.85, 0.8, 0.7].map(d => <option key={d} value={d}>{d}</option>)}</select>
        </div>
        <div className="text-xs text-text-muted">Peso geometrico: las semanas mas recientes pesan mas. decay=0.85 significa que cada semana retroactiva pesa 85% de la anterior.</div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <div className="space-y-4">
          {q.data.items.map((p) => (
            <div key={p.unidad_negocio_id} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div>
                  <h2 className="text-base font-bold text-text">{p.unidad_nombre}</h2>
                  <div className="text-xs text-text-muted">
                    {p.filas_usadas} filas usadas · {p.filas_excluidas_evento_puntual} excluidas por evento puntual
                    {p.dias_diferimiento > 0 && <span className="ml-2 text-amber-700">· diferimiento {p.dias_diferimiento}d</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Total semanal ponderado</div>
                  <div className="text-lg font-bold text-primary">{fmtArs(p.total_semanal_ponderado)}</div>
                </div>
              </div>
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                  <tr><th className="text-left px-3 py-2">DOW</th><th className="text-right px-3 py-2">Ponderado</th><th className="text-right px-3 py-2">Simple</th><th className="text-center px-3 py-2">N</th><th className="text-center px-3 py-2">Desvio %</th></tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                    const dow = p.por_dow[String(d)];
                    if (!dow || dow.n === 0) return (
                      <tr key={d} className="border-t border-border text-text-muted">
                        <td className="px-3 py-1.5 font-semibold">{DOW_NAMES[d]}</td><td className="px-3 py-1.5 text-right">—</td><td className="px-3 py-1.5 text-right">—</td><td className="px-3 py-1.5 text-center">0</td><td className="px-3 py-1.5 text-center">—</td>
                      </tr>
                    );
                    return (
                      <tr key={d} className="border-t border-border hover:bg-soft">
                        <td className="px-3 py-1.5 font-semibold">{DOW_NAMES[d]}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-primary">{fmtArs(dow.ponderado)}</td>
                        <td className="px-3 py-1.5 text-right text-text-muted">{fmtArs(dow.simple)}</td>
                        <td className="px-3 py-1.5 text-center text-text-muted">{dow.n}</td>
                        <td className={`px-3 py-1.5 text-center text-xs ${dow.desvio_pct > 50 ? "text-rose-600" : dow.desvio_pct > 25 ? "text-amber-600" : "text-emerald-600"}`}>{dow.desvio_pct.toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : null}
    </PageWrapper>
  );
}
