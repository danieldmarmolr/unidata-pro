"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact, fmtDate } from "../_components/helpers";

type Item = { fecha: string; real: number; proyectado: number; delta: number; count_real: number; count_proyectado: number };

export default function PrecisionPage() {
  const today = new Date();
  const [desde, setDesde] = useState(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(today.toISOString().slice(0, 10));

  const q = useQuery<{ items: Item[]; count: number }>({
    queryKey: ["ff", "precision", desde, hasta],
    queryFn: () => api(`/api/flujo-fondos/precision?fecha_desde=${desde}&fecha_hasta=${hasta}`),
  });

  // Calcular metrica de precision: MAPE simplificado
  const conAmbos = q.data?.items.filter(i => i.real > 0 && i.proyectado > 0) ?? [];
  const mape = conAmbos.length > 0
    ? conAmbos.reduce((a, i) => a + Math.abs(i.real - i.proyectado) / i.proyectado, 0) / conAmbos.length * 100
    : null;
  const totalReal = q.data?.items.reduce((a, i) => a + i.real, 0) ?? 0;
  const totalProy = q.data?.items.reduce((a, i) => a + i.proyectado, 0) ?? 0;

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-3 items-end">
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div className="text-xs text-text-muted">Compara facturacion real vs proyectada cargada en `facturacion_diaria` (cuando coexisten ambos en el mismo dia).</div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : !q.data || q.data.items.length === 0 ? (
        <EmptyState label="Sin datos de facturacion en el periodo" />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Total real" value={fmtArs(totalReal)} color="text-emerald-700" />
            <Tile label="Total proyectado" value={fmtArs(totalProy)} color="text-blue-700" />
            <Tile label="Delta" value={fmtArs(totalReal - totalProy)} color={(totalReal - totalProy) >= 0 ? "text-emerald-700" : "text-rose-700"} />
            <Tile label="MAPE (precision)" value={mape !== null ? `${mape.toFixed(1)}%` : "—"} sub={mape !== null ? `${conAmbos.length} dias con ambos` : "Sin overlap"} />
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
        </>
      )}
    </PageWrapper>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg p-3 bg-soft">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</div>
      <div className={`text-base font-bold mt-1 ${color ?? "text-text"}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
