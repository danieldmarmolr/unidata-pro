"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { PageWrapper, LoadingState, ErrorState, EmptyState, Tile } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact, fmtDate } from "../_components/helpers";

type Item = { fecha: string; real: number; proyectado: number; delta: number; count_real: number; count_proyectado: number };

const RANGOS = [
  { dias: 7, label: "7 dias" },
  { dias: 14, label: "14 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 60, label: "60 dias" },
];

export default function PrecisionPage() {
  const today = new Date();
  const [diasAtras, setDiasAtras] = useState(60);

  const desde = new Date(today.getTime() - diasAtras * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const hasta = today.toISOString().slice(0, 10);

  const q = useQuery<{ items: Item[]; count: number }>({
    queryKey: ["ff", "precision", diasAtras],
    queryFn: () => api(`/api/flujo-fondos/precision?fecha_desde=${desde}&fecha_hasta=${hasta}`),
  });

  // Métricas (solo días con ambos valores)
  const metricas = useMemo(() => {
    const dias = q.data?.items.filter((i) => i.real > 0 && i.proyectado > 0) ?? [];
    if (dias.length === 0) return null;
    // MAPE: error porcentual absoluto medio
    const mape = dias.reduce((a, i) => a + Math.abs(i.real - i.proyectado) / i.proyectado, 0) / dias.length * 100;
    // MAE: error absoluto medio
    const mae = dias.reduce((a, i) => a + Math.abs(i.real - i.proyectado), 0) / dias.length;
    // Sesgo: tendencia (positivo = sobreestimamos, negativo = subestimamos)
    const sesgo = dias.reduce((a, i) => a + (i.proyectado - i.real), 0) / dias.length;
    // Cobertura ±25%: % de días donde |error| / proyectado < 25%
    const cobertura = dias.filter((i) => Math.abs(i.real - i.proyectado) / i.proyectado < 0.25).length / dias.length * 100;
    return { mape, mae, sesgo, cobertura, n: dias.length };
  }, [q.data]);

  const totalReal = q.data?.items.reduce((a, i) => a + i.real, 0) ?? 0;
  const totalProy = q.data?.items.reduce((a, i) => a + i.proyectado, 0) ?? 0;

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Periodo</label>
          <div className="flex gap-1">
            {RANGOS.map((r) => (
              <button key={r.dias} onClick={() => setDiasAtras(r.dias)} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${diasAtras === r.dias ? "bg-primary text-white" : "border border-border text-text-muted hover:bg-soft"}`}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="text-xs text-text-muted">
          Compara real vs proyectado en `facturacion_diaria`. Solo dias con ambos valores cuentan para metricas.
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : !q.data || q.data.items.length === 0 ? (
        <EmptyState label="Sin datos de facturacion en el periodo" />
      ) : (
        <>
          {/* Metricas */}
          {metricas && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="MAPE" value={`${metricas.mape.toFixed(1)}%`} sub={`error % promedio (${metricas.n} dias)`} color={metricas.mape < 15 ? "text-emerald-700" : metricas.mape < 30 ? "text-amber-700" : "text-rose-700"} highlight />
              <Tile label="MAE" value={fmtArs(metricas.mae)} sub="error absoluto promedio" />
              <Tile label="Sesgo" value={fmtArs(metricas.sesgo)} sub={metricas.sesgo > 0 ? "sobreestimamos" : "subestimamos"} color={Math.abs(metricas.sesgo) < metricas.mae * 0.3 ? "text-emerald-700" : "text-amber-700"} />
              <Tile label="Cobertura ±25%" value={`${metricas.cobertura.toFixed(0)}%`} sub="dias dentro tolerancia" color={metricas.cobertura > 70 ? "text-emerald-700" : metricas.cobertura > 50 ? "text-amber-700" : "text-rose-700"} />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Tile label="Total real" value={fmtArs(totalReal)} color="text-emerald-700" />
            <Tile label="Total proyectado" value={fmtArs(totalProy)} color="text-blue-700" />
            <Tile label="Delta total" value={fmtArs(totalReal - totalProy)} color={(totalReal - totalProy) >= 0 ? "text-emerald-700" : "text-rose-700"} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold mb-3">Comparativa diaria</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={q.data.items}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtArsCompact(v)} />
                  <Tooltip formatter={(v, name) => [fmtArs(Number(v)), name === "real" ? "Real" : "Proyectado"] as [string, string]} labelFormatter={(v) => fmtDate(String(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="real" stroke="#16a34a" strokeWidth={2} dot={{ r: 2.5, fill: "#16a34a" }} connectNulls={true} />
                  <Line type="monotone" dataKey="proyectado" stroke="#2563eb" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2, fill: "#2563eb" }} connectNulls={true} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabla detalle */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-bold">Detalle dia a dia</h2></div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted sticky top-0">
                  <tr><th className="text-left px-3 py-2">Fecha</th><th className="text-right px-3 py-2">Real</th><th className="text-right px-3 py-2">Proyectado</th><th className="text-right px-3 py-2">Error</th><th className="text-center px-3 py-2">Estado</th></tr>
                </thead>
                <tbody>
                  {q.data.items.map((i) => {
                    const tieneAmbos = i.real > 0 && i.proyectado > 0;
                    const errorPct = tieneAmbos ? Math.abs(i.real - i.proyectado) / i.proyectado * 100 : 0;
                    const dentroRango = tieneAmbos && errorPct < 25;
                    return (
                      <tr key={i.fecha} className="border-t border-border hover:bg-soft">
                        <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(i.fecha)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{i.real > 0 ? fmtArs(i.real) : "—"}</td>
                        <td className="px-3 py-1.5 text-right text-blue-700">{i.proyectado > 0 ? fmtArs(i.proyectado) : "—"}</td>
                        <td className="px-3 py-1.5 text-right">
                          {tieneAmbos ? (
                            <span className={dentroRango ? "text-emerald-700" : "text-rose-700"}>±{errorPct.toFixed(1)}%</span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {tieneAmbos ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${dentroRango ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{dentroRango ? "OK" : "OUT"}</span>
                          ) : <span className="text-text-muted text-xs">parcial</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </PageWrapper>
  );
}
