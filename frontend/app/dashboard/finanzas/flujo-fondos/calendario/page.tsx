"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ChevronLeft, ChevronRight, Loader2, X, Flame, Sparkles } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { fmtArs, fmtArsCompact, fmtDate, ESTADO_LABEL, ESTADO_COLOR } from "../_components/helpers";

type Calendario = {
  year: number; month: number;
  egresos_por_dia: Record<string, { count: number; total: number; con_tentativa: number }>;
  ingresos_por_dia: Record<string, { count: number; total: number }>;
};

type DetalleDia = {
  fecha: string;
  erogaciones: { id: number; descripcion: string; monto: number; estado: string; es_critico: boolean; fecha_sugerida_tentativa: string | null; empresa_nombre?: string; banco_nombre?: string; proveedor_nombre?: string }[];
  ingresos_puntuales: { id: number; descripcion: string; monto: number; categoria: string | null; empresa_nombre?: string; banco_nombre?: string }[];
  total_egresos: number;
  total_ingresos_puntuales: number;
};

const MES_NOMBRES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DOW_LABELS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

export default function CalendarioPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);

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
  function goToday() {
    setYear(today.getFullYear()); setMonth(today.getMonth() + 1);
  }

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const firstDow = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const totalEgresos = q.data ? Object.values(q.data.egresos_por_dia).reduce((a, b) => a + b.total, 0) : 0;
  const totalIngresos = q.data ? Object.values(q.data.ingresos_por_dia).reduce((a, b) => a + b.total, 0) : 0;
  const diasEnRojo = q.data ? Object.entries(q.data.egresos_por_dia).filter(([fecha, e]) => {
    const ing = q.data!.ingresos_por_dia[fecha];
    return (ing?.total ?? 0) < e.total;
  }).length : 0;
  // Encontrar maximo egreso para escala de color
  const maxEgreso = q.data ? Math.max(0, ...Object.values(q.data.egresos_por_dia).map((e) => e.total)) : 0;
  const maxIngreso = q.data ? Math.max(0, ...Object.values(q.data.ingresos_por_dia).map((i) => i.total)) : 0;

  function colorIntensity(fecha: string): string {
    if (!q.data) return "";
    const egr = q.data.egresos_por_dia[fecha]?.total ?? 0;
    const ing = q.data.ingresos_por_dia[fecha]?.total ?? 0;
    if (egr === 0 && ing === 0) return "";
    const neto = ing - egr;
    if (neto > 0) {
      const ratio = ing / Math.max(maxIngreso, 1);
      return ratio > 0.6 ? "bg-emerald-100" : "bg-emerald-50";
    }
    if (neto < 0) {
      const ratio = egr / Math.max(maxEgreso, 1);
      return ratio > 0.6 ? "bg-rose-100" : "bg-rose-50";
    }
    return "";
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-2 rounded-lg border border-border hover:bg-soft"><ChevronLeft size={14} /></button>
          <div className="text-base font-bold text-text">{MES_NOMBRES[month - 1]} {year}</div>
          <button onClick={next} className="p-2 rounded-lg border border-border hover:bg-soft"><ChevronRight size={14} /></button>
          <button onClick={goToday} className="ml-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-soft">Hoy</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Ingresos del mes" value={fmtArs(totalIngresos)} color="text-emerald-700" />
        <Tile label="Egresos del mes" value={fmtArs(totalEgresos)} color="text-rose-700" />
        <Tile label="Neto" value={fmtArs(totalIngresos - totalEgresos)} color={totalIngresos - totalEgresos >= 0 ? "text-emerald-700" : "text-rose-700"} highlight />
        <Tile label="Dias en rojo" value={`${diasEnRojo}`} color={diasEnRojo > 0 ? "text-rose-700" : "text-emerald-700"} />
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
              const egresos = q.data!.egresos_por_dia[iso];
              const ingresos = q.data!.ingresos_por_dia[iso];
              const isToday = iso === today.toISOString().slice(0, 10);
              const tieneAlgo = egresos || ingresos;
              return (
                <button
                  key={iso}
                  onClick={() => tieneAlgo ? setDiaSeleccionado(iso) : null}
                  disabled={!tieneAlgo}
                  className={`aspect-square text-left border-b border-r border-border p-1.5 text-[10px] transition ${tieneAlgo ? "cursor-pointer hover:ring-2 hover:ring-primary/40 hover:z-10" : "cursor-default"} ${colorIntensity(iso)} ${isToday ? "ring-2 ring-primary ring-inset" : ""}`}
                >
                  <div className={`font-bold ${isToday ? "text-primary" : "text-text"}`}>{d}</div>
                  {ingresos && <div className="text-emerald-700 truncate" title={`${ingresos.count} ingresos`}>+{fmtArsCompact(ingresos.total)}</div>}
                  {egresos && (
                    <div className="text-rose-700 truncate" title={`${egresos.count} egresos${egresos.con_tentativa > 0 ? ` (${egresos.con_tentativa} tentativas)` : ""}`}>
                      −{fmtArsCompact(egresos.total)}
                      {egresos.con_tentativa > 0 && <span className="text-blue-600 ml-1">·t</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-100 border border-border rounded" /> Dia con neto positivo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-rose-100 border border-border rounded" /> Dia con neto negativo</span>
        <span className="flex items-center gap-1.5"><span className="text-blue-600 font-bold">·t</span> Pago con fecha tentativa</span>
        <span className="flex items-center gap-1.5"><Flame size={11} className="text-amber-600" /> Pago critico</span>
      </div>

      {diaSeleccionado && <DiaSheet fecha={diaSeleccionado} onClose={() => setDiaSeleccionado(null)} />}
    </PageWrapper>
  );
}

function DiaSheet({ fecha, onClose }: { fecha: string; onClose: () => void }) {
  const q = useQuery<DetalleDia>({
    queryKey: ["ff", "calendario", "dia", fecha],
    queryFn: () => api(`/api/flujo-fondos/calendario/dia/${fecha}`),
  });

  const fechaDate = new Date(fecha + "T12:00:00");
  const diaSemana = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][fechaDate.getDay()];
  const dia = fechaDate.getDate();
  const mes = MES_NOMBRES[fechaDate.getMonth()];
  const anio = fechaDate.getFullYear();

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={onClose}>
      <div className="bg-surface w-full max-w-md shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{diaSemana}</div>
            <h2 className="text-lg font-bold text-text">{dia} de {mes} de {anio}</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        {q.isLoading ? <LoadingState label="Cargando detalle..." /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data ? (
          <div className="p-5 space-y-5">
            {/* Resumen del dia */}
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Ingresos puntuales" value={fmtArs(q.data.total_ingresos_puntuales)} color="text-emerald-700" />
              <Tile label="Egresos" value={fmtArs(q.data.total_egresos)} color="text-rose-700" />
            </div>

            {/* Ingresos puntuales */}
            {q.data.ingresos_puntuales.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-text mb-2 flex items-center gap-1.5"><Sparkles size={14} className="text-emerald-600" /> Ingresos puntuales</h3>
                <div className="space-y-2">
                  {q.data.ingresos_puntuales.map((i) => (
                    <div key={i.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-semibold text-text">{i.descripcion}</div>
                        <div className="font-bold text-emerald-700 whitespace-nowrap">+{fmtArs(i.monto)}</div>
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 flex flex-wrap gap-x-2">
                        {i.categoria && <span>· {i.categoria}</span>}
                        {i.empresa_nombre && <span>· {i.empresa_nombre}</span>}
                        {i.banco_nombre && <span>· {i.banco_nombre}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Egresos */}
            {q.data.erogaciones.length > 0 ? (
              <div>
                <h3 className="text-sm font-bold text-text mb-2">Egresos comprometidos ({q.data.erogaciones.length})</h3>
                <div className="space-y-2">
                  {q.data.erogaciones.map((e) => (
                    <div key={e.id} className="rounded-lg border border-border bg-soft p-3 text-sm">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-text flex items-center gap-1">
                            {e.es_critico && <Flame size={12} className="text-amber-600 shrink-0" />}
                            <span className="truncate">{e.descripcion}</span>
                          </div>
                        </div>
                        <div className="font-bold text-rose-700 whitespace-nowrap">−{fmtArs(e.monto)}</div>
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 flex flex-wrap gap-x-2 items-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border ${ESTADO_COLOR[e.estado] ?? ""}`}>{ESTADO_LABEL[e.estado] ?? e.estado}</span>
                        {e.empresa_nombre && <span>· {e.empresa_nombre}</span>}
                        {e.banco_nombre && <span>· {e.banco_nombre}</span>}
                        {e.proveedor_nombre && <span>· {e.proveedor_nombre}</span>}
                        {e.fecha_sugerida_tentativa && <span className="text-blue-700 font-semibold">· Tentativa: {fmtDate(e.fecha_sugerida_tentativa)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {q.data.erogaciones.length === 0 && q.data.ingresos_puntuales.length === 0 && (
              <div className="text-text-muted text-sm text-center py-8">Sin movimientos en este dia</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
