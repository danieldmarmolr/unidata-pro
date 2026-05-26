"use client";

import {
  Boxes, TrendingUp, Calendar, Lock, ShieldAlert, Truck,
  PackagePlus, Repeat, AlertTriangle, ShoppingBag, AlertCircle, CheckCircle2, Activity,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

// Stock vs Demanda omnicanal. Junta el breakdown de digip.Stock con la
// velocidad de venta agregada de los 4 canales (forecast_per_channel) para
// responder LA pregunta clave del catalogo: "tengo stock suficiente para
// aguantar mi demanda?". Si no, en cuantos dias se acaba?

type StockBreakdown = {
  available: boolean;
  disponibles: number;
  reservadas: number;
  bloqueadas: number;
  a_despachar: number;
  en_recepcion: number;
  transito_interno: number;
  vencidas: number;
  pedidas: number;
  total_fisico: number;
  total_pipeline: number;
  updated_at: string | null;
} | null | undefined;

type ChannelForecast = {
  daily_velocity: number;
  trend_pct: number;
  forecast_30d: number;
  forecast_60d: number;
  revenue_forecast_30d?: number;
};

type ForecastPayload = {
  unistore_tn: ChannelForecast;
  unistore_meli: ChannelForecast;
  unidrop_tn: ChannelForecast;
  unidrop_meli: ChannelForecast;
  total: { forecast_30d: number; forecast_60d: number; revenue_forecast_30d: number };
} | null | undefined;

type Props = {
  breakdown: StockBreakdown;
  forecast: ForecastPayload;
};

// Tiles "stock disperso" — todo lo que no esta en disponibles pero esta dentro
// del sistema. Daniel los queria mas notorios para no perderlos de vista.
const DISPERSED_TILES: Array<{
  key: keyof Omit<NonNullable<StockBreakdown>, "available" | "disponibles" | "total_fisico" | "total_pipeline" | "updated_at">;
  label: string;
  tone: string;
  icon: any;
  group: "fisico" | "pipeline" | "alerta";
  tooltip: string;
}> = [
  { key: "reservadas", label: "Reservadas", tone: "border-amber-200 bg-amber-50 text-amber-900", icon: Lock, group: "fisico", tooltip: "Comprometidas a ordenes existentes" },
  { key: "a_despachar", label: "A despachar", tone: "border-cyan-200 bg-cyan-50 text-cyan-900", icon: Truck, group: "fisico", tooltip: "Picking / preparando salida" },
  { key: "bloqueadas", label: "Bloqueadas", tone: "border-rose-200 bg-rose-50 text-rose-900", icon: ShieldAlert, group: "alerta", tooltip: "Retenidas (control de calidad / problema)" },
  { key: "en_recepcion", label: "En recepcion", tone: "border-blue-200 bg-blue-50 text-blue-900", icon: PackagePlus, group: "pipeline", tooltip: "Llegando del proveedor, sin ingresar a deposito" },
  { key: "transito_interno", label: "Transito interno", tone: "border-violet-200 bg-violet-50 text-violet-900", icon: Repeat, group: "pipeline", tooltip: "Moviendose entre depositos" },
  { key: "pedidas", label: "Pedidas (PO)", tone: "border-indigo-200 bg-indigo-50 text-indigo-900", icon: ShoppingBag, group: "pipeline", tooltip: "En orden de compra al proveedor" },
  { key: "vencidas", label: "Vencidas", tone: "border-zinc-300 bg-zinc-100 text-zinc-700", icon: AlertTriangle, group: "alerta", tooltip: "Caducadas - no vendibles" },
];

function statusFromCoverage(days: number | null): { label: string; tone: string; icon: any; desc: string } {
  if (days === null) return {
    label: "Sin movimiento",
    tone: "bg-zinc-100 text-zinc-700 border-zinc-200",
    icon: Activity,
    desc: "Sin ventas en los ultimos 90 dias",
  };
  if (days < 7) return {
    label: `Critico (${days}d)`,
    tone: "bg-rose-50 text-rose-800 border-rose-200",
    icon: AlertCircle,
    desc: "Quiebre inminente — acelerar reposicion",
  };
  if (days < 30) return {
    label: `Bajo (${days}d)`,
    tone: "bg-amber-50 text-amber-800 border-amber-200",
    icon: AlertTriangle,
    desc: "Revisar pipeline de reposicion",
  };
  if (days < 90) return {
    label: `OK (${days}d)`,
    tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
    desc: "Cobertura saludable",
  };
  return {
    label: `Sobrestock (${days}d)`,
    tone: "bg-blue-50 text-blue-800 border-blue-200",
    icon: Boxes,
    desc: "Stock mayor a 90 dias de demanda",
  };
}

function projectStockoutDate(daysCoverage: number | null): string | null {
  if (daysCoverage === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + Math.round(daysCoverage));
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export function SkuStockVsDemand({ breakdown, forecast }: Props) {
  if (!breakdown || !breakdown.available) {
    return null;
  }

  const disponibles = breakdown.disponibles;
  const physicalNoDisp = breakdown.total_fisico - disponibles;
  const pipeline = breakdown.total_pipeline;

  // Velocidad omnicanal: suma de los 4 daily_velocity. Si forecast no esta
  // listo todavia, dejamos en 0 y mostramos "calculando..."
  const dailyVel = forecast
    ? forecast.unistore_tn.daily_velocity +
      forecast.unistore_meli.daily_velocity +
      forecast.unidrop_tn.daily_velocity +
      forecast.unidrop_meli.daily_velocity
    : 0;

  const daysCoverage = dailyVel > 0
    ? Math.floor(disponibles / dailyVel)
    : (disponibles > 0 ? null : 0);

  const status = statusFromCoverage(daysCoverage);
  const stockoutDate = projectStockoutDate(daysCoverage);

  // Con el pipeline + lo ya reservado/a despachar
  const totalFuturo = disponibles + breakdown.a_despachar + pipeline; // lo que TENGO + lo que VIENE
  const daysFuturo = dailyVel > 0 ? Math.floor(totalFuturo / dailyVel) : null;

  const StatusIcon = status.icon;

  // Channel mix (% de la demanda diaria que aporta cada canal)
  const channelBreakdown = forecast ? [
    { label: "Unistore TN", v: forecast.unistore_tn.daily_velocity, color: "bg-violet-500" },
    { label: "Unistore MELI", v: forecast.unistore_meli.daily_velocity, color: "bg-amber-500" },
    { label: "Unidrop TN", v: forecast.unidrop_tn.daily_velocity, color: "bg-cyan-500" },
    { label: "Unidrop MELI", v: forecast.unidrop_meli.daily_velocity, color: "bg-emerald-500" },
  ] : [];

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Boxes size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Stock vs Demanda omnicanal</h3>
            <p className="text-[11px] text-text-muted">
              digip.Stock cruzado con velocidad de venta de los 4 canales · proyeccion de consumo
              {breakdown.updated_at && ` · sync ${breakdown.updated_at}`}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${status.tone}`}>
          <StatusIcon size={14} />
          {status.label}
        </span>
      </div>

      {/* 3 big numbers: disponible / velocidad / cobertura */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/40 border border-emerald-200 rounded-xl px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-800">Stock disponible</div>
          <div className="text-3xl font-extrabold text-emerald-900 tabular-nums">{formatNumber(disponibles)}</div>
          <div className="text-[11px] text-emerald-800 mt-0.5">unidades vendibles · libre de reservas/bloqueos</div>
        </div>
        <div className="bg-gradient-to-br from-primary/10 to-accent/5 border border-primary/30 rounded-xl px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-primary/80 flex items-center gap-1">
            <TrendingUp size={11} /> Velocidad omnicanal
          </div>
          <div className="text-3xl font-extrabold text-text tabular-nums">{dailyVel.toFixed(2)}</div>
          <div className="text-[11px] text-text-muted mt-0.5">unidades/dia · suma 4 canales · ventana 90d</div>
        </div>
        <div className={`border rounded-xl px-4 py-3 ${status.tone}`}>
          <div className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1">
            <Calendar size={11} /> Dias de cobertura
          </div>
          <div className="text-3xl font-extrabold tabular-nums">
            {daysCoverage === null ? "—" : daysCoverage}
            {daysCoverage !== null && <span className="text-base font-bold opacity-70 ml-1">d</span>}
          </div>
          <div className="text-[11px] opacity-80 mt-0.5">
            {stockoutDate ? `agota ~ ${stockoutDate}` : status.desc}
          </div>
        </div>
      </div>

      {/* Proyeccion con pipeline */}
      {dailyVel > 0 && (
        <div className="bg-soft/40 border border-border rounded-lg px-3 py-2.5 mb-4 text-xs flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <span className="text-text-muted">Si sumo lo en camino </span>
            <span className="font-semibold text-text">(+{formatNumber(breakdown.a_despachar + pipeline)} u)</span>
            <span className="text-text-muted">: cobertura sube a </span>
            <span className="font-extrabold text-text">{daysFuturo}d</span>
          </div>
          <div className="text-text-muted">
            Forecast 30d <span className="font-semibold text-text tabular-nums">{forecast?.total.forecast_30d ?? "?"} u</span>
            <span className="mx-1">·</span>
            60d <span className="font-semibold text-text tabular-nums">{forecast?.total.forecast_60d ?? "?"} u</span>
          </div>
        </div>
      )}

      {/* Tiles de unidades dispersas — agrupadas por fisico / pipeline / alerta */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
          Unidades dispersas · {formatNumber(physicalNoDisp + pipeline + breakdown.vencidas)} u fuera del libre
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {DISPERSED_TILES.map((t) => {
            const v = breakdown[t.key] as number;
            const Icon = t.icon;
            const opacity = v === 0 ? "opacity-40" : "";
            return (
              <div key={t.key} title={t.tooltip} className={`border rounded-lg px-2.5 py-2 ${t.tone} ${opacity}`}>
                <div className="flex items-center gap-1.5">
                  <Icon size={12} />
                  <span className="text-[9px] uppercase tracking-wider font-bold truncate">{t.label}</span>
                </div>
                <div className="text-xl font-extrabold tabular-nums mt-0.5">{formatNumber(v)}</div>
                {v > 0 && dailyVel > 0 && (
                  <div className="text-[9px] opacity-75 mt-0.5">~ {Math.floor(v / dailyVel)}d demanda</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mix de canales (donde se concentra la demanda) */}
      {dailyVel > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Mix de demanda por canal
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden border border-border bg-soft">
            {channelBreakdown.map((c) => {
              const pct = (c.v / dailyVel) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={c.label}
                  className={c.color}
                  style={{ width: `${pct}%` }}
                  title={`${c.label}: ${c.v.toFixed(2)} u/dia (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {channelBreakdown.map((c) => {
              const pct = (c.v / dailyVel) * 100;
              return (
                <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${c.color}`} />
                  <span className="text-text-muted">{c.label}</span>
                  <span className="font-semibold tabular-nums">{c.v.toFixed(2)}/d</span>
                  <span className="text-text-muted">({pct.toFixed(0)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
