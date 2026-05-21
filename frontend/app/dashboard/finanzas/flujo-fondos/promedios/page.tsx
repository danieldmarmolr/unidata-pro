"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { fmtArs } from "../_components/helpers";

type Promedio = {
  unidad_negocio_id: number; unidad_nombre: string;
  dias_diferimiento: number; total_semanal_ponderado: number; total_semanal_simple: number;
  filas_usadas: number; filas_excluidas_evento_puntual: number;
  por_dow: Record<string, { ponderado: number; simple: number; n: number; desvio_pct: number }>;
};

const DOW_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const DECAY_PRESETS = [
  { value: 0.70, label: "Pesimista (0.70)" },
  { value: 0.80, label: "Conservador (0.80)" },
  { value: 0.85, label: "Default (0.85)" },
  { value: 0.90, label: "Neutral (0.90)" },
  { value: 0.95, label: "Optimista (0.95)" },
];

const VENTANA_PRESETS = [4, 8, 12, 16, 24, 36, 52];

export default function PromediosPage() {
  const [semanas, setSemanas] = useState(12);
  const [decay, setDecay] = useState(0.85);
  const [modo, setModo] = useState<"ponderado" | "simple">("ponderado");

  const q = useQuery<{ items: Promedio[]; fecha_referencia: string }>({
    queryKey: ["ff", "promedios", semanas, decay],
    queryFn: () => api(`/api/flujo-fondos/promedios?semanas_ventana=${semanas}&decay=${decay}`),
  });

  const totalSemanal = q.data?.items.reduce((a, p) => a + (modo === "ponderado" ? p.total_semanal_ponderado : p.total_semanal_simple), 0) ?? 0;
  const totalMensual = totalSemanal * 52 / 12;
  const totalFilas = q.data?.items.reduce((a, p) => a + p.filas_usadas, 0) ?? 0;
  const totalExcluidos = q.data?.items.reduce((a, p) => a + p.filas_excluidas_evento_puntual, 0) ?? 0;

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Ventana (semanas)</label>
          <div className="flex gap-1">
            {VENTANA_PRESETS.map((n) => (
              <button key={n} onClick={() => setSemanas(n)} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${semanas === n ? "bg-primary text-white" : "border border-border text-text-muted hover:bg-soft"}`}>{n}s</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Decay (peso semanas pasadas)</label>
          <select value={decay} onChange={(e) => setDecay(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface">
            {DECAY_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Modo</label>
          <div className="flex gap-1">
            <button onClick={() => setModo("ponderado")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${modo === "ponderado" ? "bg-primary text-white" : "border border-border text-text-muted hover:bg-soft"}`}>Ponderado</button>
            <button onClick={() => setModo("simple")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${modo === "simple" ? "bg-primary text-white" : "border border-border text-text-muted hover:bg-soft"}`}>Simple</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Semanal proyectado" value={fmtArs(totalSemanal)} highlight />
        <Tile label="Mensual proyectado" value={fmtArs(totalMensual)} color="text-emerald-700" sub="× 52/12" />
        <Tile label="Datos usados" value={`${totalFilas}`} sub="filas dentro ventana" />
        <Tile label="Eventos puntuales" value={`${totalExcluidos}`} sub="excluidos del calculo" />
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-bold">Matriz dia de semana × unidad ({modo})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-soft">DOW</th>
                  {q.data.items.map((p) => (
                    <th key={p.unidad_negocio_id} className="text-right px-3 py-2">
                      {p.unidad_nombre}
                      {p.dias_diferimiento > 0 && <div className="text-[9px] text-amber-700 normal-case font-normal">diferimiento {p.dias_diferimiento}d</div>}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2">Total dia</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                  const totalDia = q.data!.items.reduce((a, p) => {
                    const dow = p.por_dow[String(d)];
                    return a + (dow ? (modo === "ponderado" ? dow.ponderado : dow.simple) : 0);
                  }, 0);
                  return (
                    <tr key={d} className="border-t border-border hover:bg-soft">
                      <td className="px-3 py-2 font-semibold sticky left-0 bg-surface">{DOW_NAMES[d]}</td>
                      {q.data!.items.map((p) => {
                        const dow = p.por_dow[String(d)];
                        const val = dow ? (modo === "ponderado" ? dow.ponderado : dow.simple) : 0;
                        if (!dow || dow.n === 0) {
                          return <td key={p.unidad_negocio_id} className="px-3 py-2 text-right text-text-muted">—</td>;
                        }
                        return (
                          <td key={p.unidad_negocio_id} className="px-3 py-2 text-right">
                            <div className={`font-semibold ${modo === "ponderado" ? "text-primary" : "text-text"}`}>{fmtArs(val)}</div>
                            <div className="text-[9px] text-text-muted">n={dow.n} · ±{dow.desvio_pct.toFixed(0)}%</div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-bold">{fmtArs(totalDia)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border bg-soft font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-soft">Semanal</td>
                  {q.data.items.map((p) => (
                    <td key={p.unidad_negocio_id} className="px-3 py-2 text-right text-primary">{fmtArs(modo === "ponderado" ? p.total_semanal_ponderado : p.total_semanal_simple)}</td>
                  ))}
                  <td className="px-3 py-2 text-right text-primary">{fmtArs(totalSemanal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PageWrapper>
  );
}
