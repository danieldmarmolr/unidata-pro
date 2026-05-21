"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
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
    saldo_inicial: number;
    saldo_final: number;
    total_ingresos_proyectados: number;
    total_ingresos_puntuales: number;
    total_egresos: number;
    neto_periodo: number;
    fecha_inicio: string;
    fecha_fin: string;
    dias: number;
  };
  promedios: { unidad_nombre: string | null; total_semanal_ponderado: number; dias_diferimiento: number; filas_usadas: number }[];
};

export default function ProyeccionPage() {
  const [dias, setDias] = useState(30);
  const [saldoOverride, setSaldoOverride] = useState<string>("");

  const params = new URLSearchParams();
  params.set("dias", String(dias));
  if (saldoOverride.trim()) params.set("saldo_inicial", saldoOverride.trim());

  const q = useQuery<ProyResp>({
    queryKey: ["flujo-fondos", "proyeccion", dias, saldoOverride],
    queryFn: () => api<ProyResp>(`/api/flujo-fondos/proyeccion?${params.toString()}`),
    staleTime: 30_000,
  });

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-4">
      {/* Controles */}
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Horizonte</label>
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface focus:ring-1 focus:ring-primary outline-none"
          >
            {[7, 15, 30, 45, 60, 90, 120, 180].map((d) => (
              <option key={d} value={d}>{d} dias</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1">Saldo inicial (opcional)</label>
          <input
            type="number"
            placeholder="Auto (suma bancos)"
            value={saldoOverride}
            onChange={(e) => setSaldoOverride(e.target.value)}
            className="px-3 py-1.5 border border-border rounded-md text-sm bg-surface focus:ring-1 focus:ring-primary outline-none w-48"
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-text-muted flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Calculando proyeccion...
        </div>
      ) : q.error ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-rose-600">
          {(q.error as Error).message}
        </div>
      ) : q.data ? (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Saldo inicial" value={fmtArs(q.data.resumen.saldo_inicial)} />
            <Tile label="Saldo final" value={fmtArs(q.data.resumen.saldo_final)} highlight />
            <Tile label="Ingresos proy." value={fmtArs(q.data.resumen.total_ingresos_proyectados)} />
            <Tile label="Egresos" value={fmtArs(q.data.resumen.total_egresos)} />
          </div>

          {/* Grafico */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold text-text mb-3">
              Evolucion del saldo · {q.data.resumen.fecha_inicio} → {q.data.resumen.fecha_fin}
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={q.data.dias}>
                  <defs>
                    <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7a3eae" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#7a3eae" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtArsCompact(v)} />
                  <Tooltip
                    formatter={(v) => [fmtArs(Number(v)), "Saldo"] as [string, string]}
                    labelFormatter={(v) => fmtDate(String(v))}
                  />
                  <Area type="monotone" dataKey="saldo_final" stroke="#7a3eae" strokeWidth={2} fill="url(#saldoGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Promedios por unidad */}
          {q.data.promedios.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-bold text-text mb-3">Promedios semanales ponderados</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {q.data.promedios.map((p) => (
                  <div key={p.unidad_nombre} className="rounded-lg bg-soft p-3 border border-border">
                    <div className="text-xs font-bold text-text">{p.unidad_nombre ?? "—"}</div>
                    <div className="text-lg font-bold text-primary mt-1">{fmtArs(p.total_semanal_ponderado)}</div>
                    <div className="text-[10px] text-text-muted mt-1">
                      {p.filas_usadas} dias usados · diferimiento {p.dias_diferimiento}d
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabla dia a dia */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-text">Detalle dia a dia</h2>
            </div>
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
                  {q.data.dias.map((d) => (
                    <tr key={d.fecha} className="border-t border-border hover:bg-soft">
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(d.fecha)}</td>
                      <td className="px-3 py-1.5 text-right text-text-muted">{fmtArs(d.saldo_inicial)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-700">{fmtArs(d.ingresos_proyectados)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-700">{d.ingresos_puntuales > 0 ? fmtArs(d.ingresos_puntuales) : "—"}</td>
                      <td className="px-3 py-1.5 text-right text-rose-700">{d.egresos > 0 ? fmtArs(d.egresos) : "—"}</td>
                      <td className={`px-3 py-1.5 text-right font-semibold ${d.neto >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmtArs(d.neto)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold text-text">{fmtArs(d.saldo_final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-soft border border-primary/30" : "bg-soft"}`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</div>
      <div className={`text-base font-bold mt-1 ${highlight ? "text-primary" : "text-text"}`}>{value}</div>
    </div>
  );
}
