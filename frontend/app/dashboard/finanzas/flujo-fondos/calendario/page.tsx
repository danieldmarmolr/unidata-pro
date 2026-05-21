"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact } from "../_components/helpers";

type Calendario = {
  year: number; month: number;
  egresos_por_dia: Record<string, { count: number; total: number; con_tentativa: number }>;
  ingresos_por_dia: Record<string, { count: number; total: number }>;
};

const MES_NOMBRES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DOW_LABELS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

export default function CalendarioPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const q = useQuery<Calendario>({
    queryKey: ["ff", "calendario", year, month],
    queryFn: () => api(`/api/flujo-fondos/calendario?year=${year}&month=${month}`),
  });

  function prev() {
    if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
  }
  function next() {
    if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
  }

  // Calcular dias del mes
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  // weekday del 1: 0 (dom) - 6 (sab). Lo normalizamos a lun=0
  const firstDow = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Totales del mes
  const totalEgresos = q.data ? Object.values(q.data.egresos_por_dia).reduce((a, b) => a + b.total, 0) : 0;
  const totalIngresos = q.data ? Object.values(q.data.ingresos_por_dia).reduce((a, b) => a + b.total, 0) : 0;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-2 rounded-lg border border-border hover:bg-soft"><ChevronLeft size={14} /></button>
          <div className="text-base font-bold text-text">{MES_NOMBRES[month - 1]} {year}</div>
          <button onClick={next} className="p-2 rounded-lg border border-border hover:bg-soft"><ChevronRight size={14} /></button>
        </div>
        <div className="text-sm flex gap-4">
          <span className="text-emerald-700">Ingresos: <strong>{fmtArs(totalIngresos)}</strong></span>
          <span className="text-rose-700">Egresos: <strong>{fmtArs(totalEgresos)}</strong></span>
          <span className={`font-bold ${totalIngresos - totalEgresos >= 0 ? "text-emerald-700" : "text-rose-700"}`}>Neto: {fmtArs(totalIngresos - totalEgresos)}</span>
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="grid grid-cols-7 text-[10px] uppercase tracking-wider text-text-muted font-semibold bg-soft border-b border-border">
            {DOW_LABELS.map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} className="aspect-square border-b border-r border-border bg-soft/30" />;
              const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const egresos = q.data?.egresos_por_dia[iso];
              const ingresos = q.data?.ingresos_por_dia[iso];
              const isToday = iso === today.toISOString().slice(0, 10);
              return (
                <div key={iso} className={`aspect-square border-b border-r border-border p-1.5 text-[10px] hover:bg-soft transition ${isToday ? "bg-primary/5" : ""}`}>
                  <div className={`font-bold ${isToday ? "text-primary" : "text-text"}`}>{d}</div>
                  {ingresos && <div className="text-emerald-700 truncate" title={`${ingresos.count} ingresos`}>+{fmtArsCompact(ingresos.total)}</div>}
                  {egresos && (
                    <div className="text-rose-700 truncate" title={`${egresos.count} egresos${egresos.con_tentativa > 0 ? ` (${egresos.con_tentativa} tentativas)` : ""}`}>
                      −{fmtArsCompact(egresos.total)}
                      {egresos.con_tentativa > 0 && <span className="text-blue-600 ml-1">·t</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="text-xs text-text-muted">Tip: el indicador <span className="text-blue-600">·t</span> significa que hay erogaciones con fecha tentativa propuesta por el motor de pagos atrasados.</div>
    </PageWrapper>
  );
}
