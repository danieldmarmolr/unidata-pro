"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact } from "../_components/helpers";

type Analisis = {
  por_categoria: { categoria: string; count: number; total: number }[];
  por_empresa: { empresa: string; count: number; total: number }[];
  por_banco: { banco: string; count: number; total: number }[];
  por_mes: { mes: string; total: number }[];
};

export default function AnalisisPage() {
  const today = new Date();
  const [desde, setDesde] = useState(new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(today.toISOString().slice(0, 10));

  const q = useQuery<Analisis>({
    queryKey: ["ff", "analisis", desde, hasta],
    queryFn: () => api(`/api/flujo-fondos/analisis?fecha_desde=${desde}&fecha_hasta=${hasta}`),
  });

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-3 items-end">
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div className="text-xs text-text-muted">Agregados de erogaciones (excluyendo cancelado/rechazado)</div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Por categoria" data={q.data.por_categoria.slice(0, 10)} labelKey="categoria" />
          <Card title="Por empresa" data={q.data.por_empresa.map(x => ({ ...x, categoria: x.empresa }))} labelKey="categoria" />
          <Card title="Por banco" data={q.data.por_banco.map(x => ({ ...x, categoria: x.banco }))} labelKey="categoria" />
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold mb-3">Evolucion mensual</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={q.data.por_mes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtArsCompact(v)} />
                  <Tooltip formatter={(v) => [fmtArs(Number(v)), "Total"] as [string, string]} />
                  <Bar dataKey="total" fill="#7a3eae" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}
    </PageWrapper>
  );
}

function Card({ title, data, labelKey }: { title: string; data: { categoria: string; count: number; total: number }[]; labelKey: string }) {
  const max = Math.max(...data.map(d => d.total), 1);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold mb-3">{title}</h2>
      {data.length === 0 ? <div className="text-text-muted text-sm">Sin datos</div> : (
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.categoria}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text">{d.categoria} <span className="text-text-muted">({d.count})</span></span>
                <span className="font-semibold">{fmtArs(d.total)}</span>
              </div>
              <div className="h-2 bg-soft rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(d.total / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
