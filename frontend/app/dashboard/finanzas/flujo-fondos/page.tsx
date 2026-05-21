"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { fmtArs } from "./_components/helpers";

type KpisResp = {
  fecha_hoy: string;
  por_estado: Record<string, { count: number; total: number }>;
  atrasadas: { count: number; total: number };
  proximas_7d: { count: number; total: number };
  top_proveedores: { id: number; nombre: string; pendiente: number }[];
};

type ProyResp = {
  resumen: {
    saldo_inicial: number;
    saldo_final: number;
    total_ingresos_proyectados: number;
    total_egresos: number;
    neto_periodo: number;
    fecha_inicio: string;
    fecha_fin: string;
    dias: number;
  };
};

export default function FlujoFondosHomePage() {
  const kpisQ = useQuery<KpisResp>({
    queryKey: ["flujo-fondos", "kpis"],
    queryFn: () => api<KpisResp>("/api/flujo-fondos/kpis"),
    staleTime: 60_000,
  });
  const proyQ = useQuery<ProyResp>({
    queryKey: ["flujo-fondos", "proyeccion", 30],
    queryFn: () => api<ProyResp>("/api/flujo-fondos/proyeccion?dias=30"),
    staleTime: 60_000,
  });

  if (kpisQ.isLoading) {
    return (
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-10 flex items-center justify-center text-text-muted">
        <Loader2 size={16} className="animate-spin mr-2" /> Cargando KPIs...
      </div>
    );
  }
  if (kpisQ.error) {
    return (
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-10 text-rose-600">
        Error cargando KPIs: {(kpisQ.error as Error).message}
      </div>
    );
  }

  const k = kpisQ.data!;
  const pendiente = k.por_estado.pendiente ?? { count: 0, total: 0 };
  const en_curso = k.por_estado.en_curso ?? { count: 0, total: 0 };
  const pagado = k.por_estado.pagado ?? { count: 0, total: 0 };
  const p = proyQ.data?.resumen;

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
      {/* KPIs principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          gradient="from-amber-500 to-yellow-500"
          icon={<Clock size={20} />}
          label="Pendientes"
          value={fmtArs(pendiente.total)}
          sub={`${pendiente.count} pagos`}
        />
        <KpiTile
          gradient="from-blue-500 to-indigo-500"
          icon={<CalendarClock size={20} />}
          label="En curso"
          value={fmtArs(en_curso.total)}
          sub={`${en_curso.count} pagos`}
        />
        <KpiTile
          gradient="from-rose-500 to-pink-600"
          icon={<AlertTriangle size={20} />}
          label="Atrasadas"
          value={fmtArs(k.atrasadas.total)}
          sub={`${k.atrasadas.count} pagos vencidos`}
        />
        <KpiTile
          gradient="from-emerald-500 to-teal-500"
          icon={<CheckCircle2 size={20} />}
          label="Pagadas"
          value={fmtArs(pagado.total)}
          sub={`${pagado.count} pagos`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Proyeccion mini */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3">Proyeccion 30 dias</h2>
          {proyQ.isLoading ? (
            <div className="text-text-muted text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Calculando...
            </div>
          ) : p ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Saldo inicial" value={fmtArs(p.saldo_inicial)} />
              <MiniStat label="Saldo final" value={fmtArs(p.saldo_final)} highlight />
              <MiniStat
                label="Ingresos proy."
                value={fmtArs(p.total_ingresos_proyectados)}
                icon={<TrendingUp size={12} className="text-emerald-600" />}
              />
              <MiniStat
                label="Egresos"
                value={fmtArs(p.total_egresos)}
                icon={<TrendingDown size={12} className="text-rose-600" />}
              />
              <div className="col-span-2 sm:col-span-4 mt-2 text-xs text-text-muted">
                Periodo {p.fecha_inicio} → {p.fecha_fin} · neto: {fmtArs(p.neto_periodo)}
              </div>
            </div>
          ) : (
            <div className="text-text-muted text-sm">Sin datos de proyeccion</div>
          )}
        </div>

        {/* Top proveedores pendientes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3">Top proveedores pendientes</h2>
          {k.top_proveedores.length === 0 ? (
            <div className="text-text-muted text-sm">Sin saldo pendiente</div>
          ) : (
            <ul className="space-y-2">
              {k.top_proveedores.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-text">{p.nombre}</span>
                  <span className="font-semibold text-text-muted ml-2 flex-shrink-0">{fmtArs(p.pendiente)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Proximas 7 dias */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text mb-1">Proximos 7 dias</h2>
        <div className="text-text-muted text-xs mb-3">
          Pagos pendientes o en curso con fecha entre hoy y +7 dias
        </div>
        <div className="text-2xl font-bold text-primary">
          {fmtArs(k.proximas_7d.total)} <span className="text-sm text-text-muted font-normal">· {k.proximas_7d.count} pagos</span>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ gradient, icon, label, value, sub }: { gradient: string; icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className={`rounded-xl bg-gradient-to-br ${gradient} text-white p-5 shadow-sm`}>
      <div className="flex items-center justify-between mb-2 opacity-90">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="text-xl font-extrabold leading-tight">{value}</div>
      <div className="text-[11px] opacity-80 mt-1">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, sub, icon, highlight }: { label: string; value: string; sub?: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-soft border border-primary/30" : "bg-soft"}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
        {icon}
        {label}
      </div>
      <div className={`text-base font-bold mt-1 ${highlight ? "text-primary" : "text-text"}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
