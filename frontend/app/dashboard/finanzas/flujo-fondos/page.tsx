"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TodayPanel } from "@/components/today-panel";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, TrendingDown, TrendingUp, Handshake, Building2, Boxes, Landmark, Users } from "lucide-react";
import { fmtArs, fmtArsCompact, fmtDate } from "./_components/helpers";

type KpisResp = {
  fecha_hoy: string;
  por_estado: Record<string, { count: number; total: number }>;
  atrasadas: { count: number; total: number };
  proximas_7d: { count: number; total: number };
  top_proveedores: { id: number; nombre: string; pendiente: number }[];
};

type ProyResp = { resumen: { saldo_inicial: number; saldo_final: number; total_ingresos_proyectados: number; total_egresos: number; neto_periodo: number; fecha_inicio: string; fecha_fin: string; dias: number } };

type HomeDash = {
  tendencia_facturacion: { fecha: string; monto: number; es_real: boolean }[];
  distribucion_gastos_mes: { categoria: string; count: number; total: number }[];
  acuerdos_urgentes: { id: number; compromiso: string; fecha: string; monto: number | null; proveedor_nombre: string | null; urgencia: "vencido" | "proximo" }[];
  setup: Record<string, { count: number; meta: number }>;
};

const PIE_COLORS = ["#7a3eae", "#dc2626", "#f59e0b", "#16a34a", "#2563eb", "#db2777", "#0891b2", "#65a30d", "#9333ea", "#ea580c"];

export default function FlujoFondosHomePage() {
  const kpisQ = useQuery<KpisResp>({ queryKey: ["ff", "kpis"], queryFn: () => api<KpisResp>("/api/flujo-fondos/kpis"), staleTime: 60_000 });
  const proyQ = useQuery<ProyResp>({ queryKey: ["ff", "proyeccion", 30, ""], queryFn: () => api<ProyResp>("/api/flujo-fondos/proyeccion?dias=30"), staleTime: 60_000 });
  const dashQ = useQuery<HomeDash>({ queryKey: ["ff", "home-dashboard"], queryFn: () => api<HomeDash>("/api/flujo-fondos/home-dashboard"), staleTime: 60_000 });

  if (kpisQ.isLoading) {
    return <div className="flex-1 px-4 sm:px-6 lg:px-8 py-10 flex items-center justify-center text-text-muted"><Loader2 size={16} className="animate-spin mr-2" /> Cargando KPIs...</div>;
  }
  if (kpisQ.error) {
    return <div className="flex-1 px-4 sm:px-6 lg:px-8 py-10 text-rose-600">Error: {(kpisQ.error as Error).message}</div>;
  }

  const k = kpisQ.data!;
  const pendiente = k.por_estado.pendiente ?? { count: 0, total: 0 };
  const en_curso = k.por_estado.en_curso ?? { count: 0, total: 0 };
  const pagado = k.por_estado.pagado ?? { count: 0, total: 0 };
  const p = proyQ.data?.resumen;
  const dash = dashQ.data;
  const setup = dash?.setup;
  const setupCompleto = setup && Object.values(setup).every((s) => s.count >= s.meta);

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
      <TodayPanel context="finanzas" title="HOY · Flujo de Fondos" />
      {/* Banner "procesar hoy" */}
      {(k.atrasadas.count > 0 || k.proximas_7d.count > 0) && (
        <div className="rounded-xl border-2 border-primary bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Clock size={20} className="text-primary mt-0.5" />
            <div>
              <div className="text-sm font-bold text-text">Procesar hoy</div>
              <div className="text-xs text-text-muted">
                <strong className="text-rose-700">{k.atrasadas.count}</strong> atrasadas y <strong>{k.proximas_7d.count}</strong> en los proximos 7 dias
              </div>
            </div>
          </div>
          <Link href="/dashboard/finanzas/flujo-fondos/pagos-atrasados" className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-md hover:opacity-90">Ir a pagos atrasados →</Link>
        </div>
      )}

      {/* KPIs principales (clickables) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTileLink href="/dashboard/finanzas/flujo-fondos/erogaciones" gradient="from-amber-500 to-yellow-500" icon={<Clock size={20} />} label="Pendientes" value={fmtArs(pendiente.total)} sub={`${pendiente.count} pagos`} />
        <KpiTileLink href="/dashboard/finanzas/flujo-fondos/erogaciones" gradient="from-blue-500 to-indigo-500" icon={<CalendarClock size={20} />} label="En curso" value={fmtArs(en_curso.total)} sub={`${en_curso.count} pagos`} />
        <KpiTileLink href="/dashboard/finanzas/flujo-fondos/pagos-atrasados" gradient="from-rose-500 to-pink-600" icon={<AlertTriangle size={20} />} label="Atrasadas" value={fmtArs(k.atrasadas.total)} sub={`${k.atrasadas.count} vencidos`} />
        <KpiTileLink href="/dashboard/finanzas/flujo-fondos/erogaciones" gradient="from-emerald-500 to-teal-500" icon={<CheckCircle2 size={20} />} label="Pagadas" value={fmtArs(pagado.total)} sub={`${pagado.count} pagos`} />
      </div>

      {/* Tendencia facturacion 60d */}
      {dash && dash.tendencia_facturacion.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3">Tendencia facturacion · ultimos 60 dias</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dash.tendencia_facturacion}>
                <defs>
                  <linearGradient id="factGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="fecha" tick={{ fontSize: 9 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => fmtArsCompact(v)} />
                <Tooltip formatter={(v) => [fmtArs(Number(v)), "Facturacion"] as [string, string]} labelFormatter={(v) => fmtDate(String(v))} />
                <Area type="monotone" dataKey="monto" stroke="#16a34a" strokeWidth={2} fill="url(#factGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Proyeccion mini */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3">Proyeccion 30 dias</h2>
          {proyQ.isLoading ? (
            <div className="text-text-muted text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Calculando...</div>
          ) : p ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Saldo inicial" value={fmtArs(p.saldo_inicial)} />
              <MiniStat label="Saldo final" value={fmtArs(p.saldo_final)} highlight />
              <MiniStat label="Ingresos proy." value={fmtArs(p.total_ingresos_proyectados)} icon={<TrendingUp size={12} className="text-emerald-600" />} />
              <MiniStat label="Egresos" value={fmtArs(p.total_egresos)} icon={<TrendingDown size={12} className="text-rose-600" />} />
              <div className="col-span-2 sm:col-span-4 mt-2 text-xs text-text-muted">
                Periodo {p.fecha_inicio} → {p.fecha_fin} · neto: {fmtArs(p.neto_periodo)} ·{" "}
                <Link href="/dashboard/finanzas/flujo-fondos/proyeccion" className="text-primary hover:underline font-semibold">Ver proyeccion completa →</Link>
              </div>
            </div>
          ) : <div className="text-text-muted text-sm">Sin datos de proyeccion</div>}
        </div>

        {/* Top proveedores pendientes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3">Top proveedores pendientes</h2>
          {k.top_proveedores.length === 0 ? <div className="text-text-muted text-sm">Sin saldo pendiente</div> : (
            <ul className="space-y-2">
              {k.top_proveedores.map((p) => (
                <li key={p.id}>
                  <Link href={`/dashboard/finanzas/flujo-fondos/proveedores/${p.id}`} className="flex items-center justify-between text-sm hover:bg-soft p-1 -m-1 rounded">
                    <span className="truncate text-text">{p.nombre}</span>
                    <span className="font-semibold text-text-muted ml-2 flex-shrink-0">{fmtArs(p.pendiente)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Distribucion gastos del mes */}
        {dash && dash.distribucion_gastos_mes.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold text-text mb-3">Distribucion gastos del mes</h2>
            <div className="flex items-center gap-4">
              <div className="h-44 w-44 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dash.distribucion_gastos_mes} dataKey="total" nameKey="categoria" innerRadius={40} outerRadius={75} paddingAngle={2}>
                      {dash.distribucion_gastos_mes.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmtArs(Number(v)), "Total"] as [string, string]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                {dash.distribucion_gastos_mes.slice(0, 6).map((d, i) => (
                  <div key={d.categoria} className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="flex-1 truncate text-text">{d.categoria}</span>
                    <span className="font-semibold text-text-muted whitespace-nowrap">{fmtArs(d.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Acuerdos urgentes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text mb-3 flex items-center gap-1.5"><Handshake size={14} /> Acuerdos urgentes</h2>
          {!dash || dash.acuerdos_urgentes.length === 0 ? (
            <div className="text-text-muted text-sm">Sin acuerdos por vencer en 7 dias ✓</div>
          ) : (
            <ul className="space-y-2">
              {dash.acuerdos_urgentes.map((a) => (
                <li key={a.id} className={`rounded p-2 text-xs ${a.urgencia === "vencido" ? "bg-rose-50 border border-rose-200" : "bg-amber-50 border border-amber-200"}`}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-text truncate">{a.compromiso}</div>
                      <div className="text-text-muted">{a.proveedor_nombre ?? "—"} · {fmtDate(a.fecha)} · <strong className={a.urgencia === "vencido" ? "text-rose-700" : "text-amber-700"}>{a.urgencia === "vencido" ? "VENCIDO" : "Proximo"}</strong></div>
                    </div>
                    {a.monto != null && <div className="font-bold text-text whitespace-nowrap">{fmtArs(a.monto)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Setup KPIs (solo si está incompleto) */}
      {setup && !setupCompleto && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-bold text-text mb-3">Setup inicial</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SetupKpi label="Empresas" data={setup.empresas} icon={<Building2 size={14} />} href="/dashboard/finanzas/flujo-fondos/empresas" />
            <SetupKpi label="Unidades" data={setup.unidades} icon={<Boxes size={14} />} href="/dashboard/finanzas/flujo-fondos/unidades-negocio" />
            <SetupKpi label="Bancos" data={setup.bancos} icon={<Landmark size={14} />} href="/dashboard/finanzas/flujo-fondos/bancos" />
            <SetupKpi label="Proveedores" data={setup.proveedores} icon={<Users size={14} />} href="/dashboard/finanzas/flujo-fondos/proveedores" />
          </div>
        </div>
      )}
    </div>
  );
}

function KpiTileLink({ href, gradient, icon, label, value, sub }: { href: string; gradient: string; icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Link href={href} className={`rounded-xl bg-gradient-to-br ${gradient} text-white p-5 shadow-sm transition hover:shadow-md hover:scale-[1.01]`}>
      <div className="flex items-center justify-between mb-2 opacity-90">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="text-xl font-extrabold leading-tight">{value}</div>
      <div className="text-[11px] opacity-80 mt-1">{sub}</div>
    </Link>
  );
}

function MiniStat({ label, value, icon, highlight }: { label: string; value: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-soft border border-primary/30" : "bg-soft"}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted font-semibold">{icon}{label}</div>
      <div className={`text-base font-bold mt-1 ${highlight ? "text-primary" : "text-text"}`}>{value}</div>
    </div>
  );
}

function SetupKpi({ label, data, icon, href }: { label: string; data: { count: number; meta: number }; icon: React.ReactNode; href: string }) {
  const ok = data.meta === 0 ? data.count > 0 : data.count >= data.meta;
  return (
    <Link href={href} className={`rounded-lg p-3 border ${ok ? "bg-emerald-50 border-emerald-200" : "bg-white border-amber-300"}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted font-semibold">{icon}{label}</div>
      <div className="text-base font-bold mt-1 text-text">
        {data.count}
        {data.meta > 0 && <span className="text-text-muted text-xs font-normal"> / {data.meta}</span>}
      </div>
      <div className={`text-[10px] font-bold mt-0.5 ${ok ? "text-emerald-700" : "text-amber-700"}`}>{ok ? "✓ Completo" : "Configurar"}</div>
    </Link>
  );
}
