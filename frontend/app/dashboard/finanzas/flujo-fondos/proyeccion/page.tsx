"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact, fmtDate } from "../_components/helpers";

type Dia = {
  fecha: string;
  saldo_inicial: number;
  ingresos_proyectados: number;
  ingresos_puntuales: number;
  egresos: number;
  neto: number;
  saldo_final: number;
};

type ProyResp = {
  dias: Dia[];
  resumen: {
    saldo_inicial: number; saldo_final: number;
    total_ingresos_proyectados: number; total_ingresos_puntuales: number;
    total_egresos: number; neto_periodo: number;
    fecha_inicio: string; fecha_fin: string; dias: number;
  };
  promedios: { unidad_nombre: string | null; total_semanal_ponderado: number; dias_diferimiento: number; filas_usadas: number }[];
};

export default function ProyeccionPage() {
  const [dias, setDias] = useState(30);
  const [saldoOverride, setSaldoOverride] = useState<string>("");
  const [umbral, setUmbral] = useState(6_000_000);

  const params = new URLSearchParams();
  params.set("dias", String(dias));
  if (saldoOverride.trim()) params.set("saldo_inicial", saldoOverride.trim());

  const q = useQuery<ProyResp>({
    queryKey: ["ff", "proyeccion", dias, saldoOverride],
    queryFn: () => api<ProyResp>(`/api/flujo-fondos/proyeccion?${params.toString()}`),
    staleTime: 30_000,
  });

  const primerDiaCritico = q.data?.dias.find((d) => d.saldo_final < umbral);
  const diasCriticos = q.data?.dias.filter((d) => d.saldo_final < umbral).length ?? 0;

  function exportCSV() {
    if (!q.data) return;
    const headers = ["Fecha", "Saldo inicial", "Ingresos proyectados", "Ingresos puntuales", "Egresos", "Neto", "Saldo final", "Bajo umbral"];
    const rows = q.data.dias.map((d) => [
      d.fecha, String(d.saldo_inicial), String(d.ingresos_proyectados),
      String(d.ingresos_puntuales), String(d.egresos), String(d.neto), String(d.saldo_final),
      d.saldo_final < umbral ? "si" : "no",
    ]);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = "﻿" + [headers.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proyeccion-${q.data.resumen.fecha_inicio}-a-${q.data.resumen.fecha_fin}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Horizonte</label>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface">
            {[7, 15, 30, 45, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Saldo inicial (override)</label>
          <input type="number" placeholder="Auto (suma bancos)" value={saldoOverride} onChange={(e) => setSaldoOverride(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface w-48" />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Umbral estreñimiento</label>
          <input type="number" step="100000" value={umbral} onChange={(e) => setUmbral(Number(e.target.value))} className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface w-48" />
        </div>
        <button onClick={exportCSV} disabled={!q.data} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-medium hover:bg-soft disabled:opacity-50"><Download size={12} /> Exportar CSV</button>
      </div>

      {q.isLoading ? <LoadingState label="Calculando proyeccion..." /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <>
          {primerDiaCritico && (
            <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4 flex gap-3 items-start">
              <AlertTriangle size={20} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-rose-900">
                <div className="font-bold text-base">Estrenimiento del flujo detectado</div>
                <div className="mt-1">
                  Primer dia critico: <strong>{fmtDate(primerDiaCritico.fecha)}</strong> · saldo proyectado <strong>{fmtArs(primerDiaCritico.saldo_final)}</strong> · cae por debajo del umbral de {fmtArs(umbral)}.
                </div>
                <div className="text-xs mt-1 text-rose-700">{diasCriticos} de {q.data.dias.length} dias caen bajo el umbral.</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Saldo inicial" value={fmtArs(q.data.resumen.saldo_inicial)} />
            <Tile label="Saldo final" value={fmtArs(q.data.resumen.saldo_final)} highlight />
            <Tile label="Ingresos proy." value={fmtArs(q.data.resumen.total_ingresos_proyectados)} />
            <Tile label="Egresos" value={fmtArs(q.data.resumen.total_egresos)} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold text-text mb-3">Evolucion del saldo · {q.data.resumen.fecha_inicio} → {q.data.resumen.fecha_fin}</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={q.data.dias}>
                  <defs>
                    <linearGradient id="saldoGradOk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7a3eae" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#7a3eae" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtArsCompact(v)} />
                  <Tooltip formatter={(v) => [fmtArs(Number(v)), "Saldo"] as [string, string]} labelFormatter={(v) => fmtDate(String(v))} />
                  <ReferenceLine y={umbral} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `Umbral ${fmtArsCompact(umbral)}`, fill: "#dc2626", fontSize: 10, position: "insideTopRight" }} />
                  <Area type="monotone" dataKey="saldo_final" stroke="#7a3eae" strokeWidth={2} fill="url(#saldoGradOk)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {q.data.promedios.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-bold text-text mb-3">Promedios semanales ponderados</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {q.data.promedios.map((p) => (
                  <div key={p.unidad_nombre} className="rounded-lg bg-soft p-3 border border-border">
                    <div className="text-xs font-bold text-text">{p.unidad_nombre ?? "—"}</div>
                    <div className="text-lg font-bold text-primary mt-1">{fmtArs(p.total_semanal_ponderado)}</div>
                    <div className="text-[10px] text-text-muted mt-1">{p.filas_usadas} dias usados · diferimiento {p.dias_diferimiento}d</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-bold text-text">Detalle dia a dia</h2></div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-right px-3 py-2">Inicial</th>
                    <th className="text-right px-3 py-2">Ingresos</th>
                    <th className="text-right px-3 py-2">Ing. puntuales</th>
                    <th className="text-right px-3 py-2">Egresos</th>
                    <th className="text-right px-3 py-2">Neto</th>
                    <th className="text-right px-3 py-2">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.dias.map((d) => {
                    const critico = d.saldo_final < umbral;
                    return (
                      <tr key={d.fecha} className={`border-t border-border ${critico ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-soft"}`}>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {fmtDate(d.fecha)}
                          {critico && <AlertTriangle size={11} className="inline text-rose-600 ml-1" />}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-muted">{fmtArs(d.saldo_inicial)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{fmtArs(d.ingresos_proyectados)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{d.ingresos_puntuales > 0 ? fmtArs(d.ingresos_puntuales) : "—"}</td>
                        <td className="px-3 py-1.5 text-right text-rose-700">{d.egresos > 0 ? fmtArs(d.egresos) : "—"}</td>
                        <td className={`px-3 py-1.5 text-right font-semibold ${d.neto >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtArs(d.neto)}</td>
                        <td className={`px-3 py-1.5 text-right font-bold ${critico ? "text-rose-700" : "text-text"}`}>{fmtArs(d.saldo_final)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </PageWrapper>
  );
}
