"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact } from "../_components/helpers";

type Analisis = {
  por_categoria: { categoria: string; count: number; total: number }[];
  por_empresa: { empresa: string; count: number; total: number }[];
  por_banco: { banco: string; count: number; total: number }[];
  por_mes: { mes: string; total: number }[];
};

const PIE_COLORS = ["#7a3eae", "#dc2626", "#f59e0b", "#16a34a", "#2563eb", "#db2777", "#0891b2", "#65a30d", "#9333ea", "#ea580c"];

type Tab = "categoria" | "empresa" | "banco" | "temporal";

export default function AnalisisPage() {
  const today = new Date();
  const [desde, setDesde] = useState(new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(today.toISOString().slice(0, 10));
  const [tab, setTab] = useState<Tab>("categoria");

  const q = useQuery<Analisis>({
    queryKey: ["ff", "analisis", desde, hasta],
    queryFn: () => api(`/api/flujo-fondos/analisis?fecha_desde=${desde}&fecha_hasta=${hasta}`),
  });

  function setRangoRapido(dias: number) {
    setDesde(new Date(today.getTime() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    setHasta(today.toISOString().slice(0, 10));
  }

  const totalEgresos = q.data ? q.data.por_empresa.reduce((a, b) => a + b.total, 0) : 0;
  const cantidadPagos = q.data ? q.data.por_empresa.reduce((a, b) => a + b.count, 0) : 0;
  const ticketPromedio = cantidadPagos > 0 ? totalEgresos / cantidadPagos : 0;
  const empresasActivas = q.data?.por_empresa.length ?? 0;

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-3 items-end">
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-sm" /></div>
        <div className="flex gap-1">
          {[30, 60, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setRangoRapido(d)} className="px-2.5 py-1.5 text-xs rounded-md border border-border hover:bg-soft">Ultimos {d}d</button>
          ))}
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Total egresos" value={fmtArs(totalEgresos)} highlight color="text-rose-700" />
            <Tile label="Cantidad pagos" value={`${cantidadPagos}`} />
            <Tile label="Ticket promedio" value={fmtArs(ticketPromedio)} />
            <Tile label="Empresas activas" value={`${empresasActivas}`} />
          </div>

          {/* Tabs */}
          <div className="border-b border-border flex gap-1">
            {[
              { k: "categoria" as Tab, l: "Por categoria" },
              { k: "empresa" as Tab, l: "Por empresa" },
              { k: "banco" as Tab, l: "Por banco" },
              { k: "temporal" as Tab, l: "Evolucion mensual" },
            ].map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t.k ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>{t.l}</button>
            ))}
          </div>

          {tab === "categoria" && <PieAndTable data={q.data.por_categoria} labelKey="categoria" />}
          {tab === "empresa" && <PieAndTable data={q.data.por_empresa.map((x) => ({ categoria: x.empresa, count: x.count, total: x.total }))} labelKey="categoria" />}
          {tab === "banco" && <PieAndTable data={q.data.por_banco.map((x) => ({ categoria: x.banco, count: x.count, total: x.total }))} labelKey="categoria" />}
          {tab === "temporal" && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-bold mb-3">Evolucion mensual</h2>
              <div className="h-64">
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
          )}
        </>
      ) : null}
    </PageWrapper>
  );
}

function PieAndTable({ data }: { data: { categoria: string; count: number; total: number }[]; labelKey: string }) {
  const total = data.reduce((a, b) => a + b.total, 0);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-bold mb-3">Distribucion</h3>
        {data.length === 0 ? <div className="text-text-muted text-sm">Sin datos</div> : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.slice(0, 10)} dataKey="total" nameKey="categoria" innerRadius={50} outerRadius={100} paddingAngle={2}>
                  {data.slice(0, 10).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => [fmtArs(Number(v)), "Total"] as [string, string]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-bold mb-3">Detalle</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {data.map((d, i) => {
            const pct = total > 0 ? (d.total / total * 100) : 0;
            return (
              <div key={d.categoria}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-text">{d.categoria}</span>
                    <span className="text-text-muted">({d.count})</span>
                  </span>
                  <span className="font-semibold whitespace-nowrap">{fmtArs(d.total)} <span className="text-text-muted text-[10px]">({pct.toFixed(1)}%)</span></span>
                </div>
                <div className="h-1.5 bg-soft rounded-full overflow-hidden">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
