"use client";

import {
  Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  Package, TrendingUp, TrendingDown, Minus, DollarSign, Calendar,
  Wallet, ChevronRight, AlertTriangle, CheckCircle2,
} from "lucide-react";

// Cruce lote x ventas omnicanal. Cada lote define un periodo (desde su
// fecha_ingreso hasta el siguiente lote). Para cada periodo: unidades
// vendidas, revenue, ganancia neta (revenue - units*costo_lote), velocidad.
// Tambien grafica la evolucion del costo unit USD/ARS a traves del tiempo.

export type LoteConsumption = {
  lote: string | null;
  proveedor: string | null;
  fecha_ingreso: string;
  fecha_fin: string;
  vigente: boolean;
  dias: number;
  cantidad_lote: number;
  costo_unit_usd: number | null;
  costo_unit_ars: number | null;
  precio_ars_sugerido: number | null;
  units_sold: number;
  orders: number;
  revenue: number;
  costo_total: number;
  ganancia: number;
  margen_pct: number | null;
  consumido_pct: number | null;
  velocidad_diaria: number;
  categoria: string | null;
};

export type CostEvolutionRow = {
  fecha: string;
  lote: string | null;
  costo_usd: number | null;
  costo_ars: number | null;
  precio_ars: number | null;
};

export type LotesConsumptionPayload = {
  sku: string;
  available: boolean;
  lotes: LoteConsumption[];
  cost_evolution: CostEvolutionRow[];
  totals: {
    ganancia: number;
    revenue: number;
    costo: number;
    units_sold: number;
    margen_pct: number | null;
  };
};

type Props = { data: LotesConsumptionPayload | null | undefined; loading?: boolean };

function fmtShortAr(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function trendIcon(delta: number) {
  if (delta > 2) return { Icon: TrendingUp, tone: "text-rose-700" };
  if (delta < -2) return { Icon: TrendingDown, tone: "text-emerald-700" };
  return { Icon: Minus, tone: "text-text-muted" };
}

export function SkuLotesConsumption({ data, loading }: Props) {
  if (loading) {
    return <div className="bg-surface border border-border rounded-xl p-5 h-[420px] animate-pulse mb-6" />;
  }
  if (!data || !data.available || data.lotes.length === 0) {
    return null;
  }

  const { lotes, cost_evolution, totals } = data;

  // Delta de costo USD entre primer y ultimo lote (para el badge del header)
  const firstUsd = cost_evolution.find((r) => r.costo_usd)?.costo_usd ?? 0;
  const lastUsd = [...cost_evolution].reverse().find((r) => r.costo_usd)?.costo_usd ?? 0;
  const usdDeltaPct = firstUsd > 0 ? ((lastUsd - firstUsd) / firstUsd) * 100 : 0;
  const { Icon: TrendI, tone: trendTone } = trendIcon(usdDeltaPct);

  // Datos para el chart de evolucion: combinamos cost_evolution con units_sold
  // del lote correspondiente para mostrar ambas dimensiones a la vez.
  const chartData = cost_evolution.map((c) => {
    const matched = lotes.find((l) => l.lote === c.lote);
    return {
      lote: c.lote ?? "?",
      fecha: c.fecha,
      label: c.lote ? `${c.lote.slice(-8)}\n${c.fecha.slice(0, 7)}` : c.fecha.slice(0, 7),
      costo_usd: c.costo_usd ?? 0,
      costo_ars: c.costo_ars ?? 0,
      units_sold: matched?.units_sold ?? 0,
      ganancia: matched?.ganancia ?? 0,
      cantidad_lote: matched?.cantidad_lote ?? 0,
    };
  });

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Package size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Consumo lote a lote · ganancia y evolución de costo</h3>
            <p className="text-[11px] text-text-muted">
              Cada lote define un periodo (de su entrada a la del siguiente). Ventas omnicanal en ese rango · ganancia = revenue − unidades × costo lote (ARS con IVA)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {firstUsd > 0 && lastUsd > 0 && (
            <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${
              usdDeltaPct > 2 ? "bg-rose-50 text-rose-800 border-rose-200" :
              usdDeltaPct < -2 ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
              "bg-soft text-text-muted border-border"
            }`}>
              <TrendI size={12} className={trendTone} />
              Costo USD: {usdDeltaPct >= 0 ? "+" : ""}{usdDeltaPct.toFixed(1)}%
              <span className="text-[10px] opacity-70">({firstUsd} → {lastUsd})</span>
            </div>
          )}
        </div>
      </div>

      {/* Totales del periodo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-soft/40 border border-border rounded-lg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Vendidas (todos los lotes)</div>
          <div className="text-xl font-extrabold tabular-nums">{formatNumber(totals.units_sold)}</div>
        </div>
        <div className="bg-soft/40 border border-border rounded-lg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Revenue acumulado</div>
          <div className="text-xl font-extrabold tabular-nums text-primary">{fmtShortAr(totals.revenue)}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-emerald-800 font-bold flex items-center gap-1">
            <Wallet size={9} /> Ganancia neta
          </div>
          <div className="text-xl font-extrabold tabular-nums text-emerald-900">{fmtShortAr(totals.ganancia)}</div>
        </div>
        <div className="bg-primary/5 border border-primary/30 rounded-lg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-primary/80 font-bold">Margen neto promedio</div>
          <div className="text-xl font-extrabold tabular-nums text-primary">
            {totals.margen_pct !== null ? `${totals.margen_pct}%` : "—"}
          </div>
        </div>
      </div>

      {/* Chart: barras (unidades vendidas por lote) + linea (costo USD evolucion) */}
      <div className="bg-soft/20 border border-border rounded-lg p-3 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
          Unidades vendidas por lote + evolución del costo USD
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 15, right: 50, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
            <YAxis yAxisId="units" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(v)} />
            <YAxis
              yAxisId="usd"
              orientation="right"
              tick={{ fontSize: 10, fill: "#7c3aed" }}
              tickFormatter={(v) => `US$${v}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0]?.payload as Record<string, unknown>;
                return (
                  <div className="bg-surface border border-border rounded-lg shadow-lg p-3 text-xs">
                    <div className="font-bold mb-1">{String(row.lote ?? "?")}</div>
                    <div className="text-text-muted text-[10px] mb-2">Ingreso: {String(row.fecha)}</div>
                    <div className="flex justify-between gap-3"><span>Unidades vendidas</span><span className="font-bold tabular-nums">{formatNumber(Number(row.units_sold) || 0)}</span></div>
                    <div className="flex justify-between gap-3"><span>Cantidad lote</span><span className="font-bold tabular-nums">{formatNumber(Number(row.cantidad_lote) || 0)}</span></div>
                    <div className="flex justify-between gap-3"><span>Ganancia</span><span className="font-bold tabular-nums text-emerald-700">{fmtShortAr(Number(row.ganancia) || 0)}</span></div>
                    <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-border"><span>Costo USD</span><span className="font-bold tabular-nums text-violet-700">US${Number(row.costo_usd).toFixed(2)}</span></div>
                    <div className="flex justify-between gap-3"><span>Costo ARS</span><span className="font-bold tabular-nums">{fmtShortAr(Number(row.costo_ars) || 0)}</span></div>
                  </div>
                );
              }}
            />
            <Bar yAxisId="units" dataKey="units_sold" fill="#10b981" isAnimationActive={false}>
              <LabelList
                dataKey="units_sold"
                position="top"
                fontSize={10}
                fill="#065f46"
                fontWeight={700}
                formatter={(v: unknown) => {
                  const n = Number(v);
                  return Number.isFinite(n) && n > 0 ? formatNumber(n) : "";
                }}
              />
            </Bar>
            <Line
              yAxisId="usd"
              type="monotone"
              dataKey="costo_usd"
              stroke="#7c3aed"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#7c3aed" }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
              name="Costo USD"
            >
              <LabelList
                dataKey="costo_usd"
                position="top"
                fontSize={10}
                fill="#5b21b6"
                fontWeight={700}
                formatter={(v: unknown) => {
                  const n = Number(v);
                  return Number.isFinite(n) && n > 0 ? `US$${n.toFixed(2)}` : "";
                }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 text-[10px] text-text-muted mt-1">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" /> Unidades vendidas (izq)</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-primary rounded-sm" /> Costo USD (der)</span>
        </div>
      </div>

      {/* Tabla detalle por lote */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="bg-soft/60 px-3 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-text-muted font-bold">
          <div className="col-span-3">Lote · Período</div>
          <div className="col-span-1 text-right">Costo USD</div>
          <div className="col-span-1 text-right">Costo ARS</div>
          <div className="col-span-2 text-right">Vendidas · vel/d</div>
          <div className="col-span-1 text-right">Revenue</div>
          <div className="col-span-1 text-right">Ganancia</div>
          <div className="col-span-1 text-right">Margen</div>
          <div className="col-span-2">Consumido del lote</div>
        </div>
        <div className="divide-y divide-border">
          {lotes.map((l) => {
            const consumed = l.consumido_pct ?? 0;
            const cap = Math.min(100, consumed);
            const over = consumed > 100;
            return (
              <div key={`${l.lote}-${l.fecha_ingreso}`} className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 text-sm hover:bg-soft/30 transition">
                <div className="col-span-3 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Package size={11} className="text-primary shrink-0" />
                    <span className="font-mono text-xs font-bold truncate" title={l.lote ?? ""}>{l.lote ?? "?"}</span>
                    {l.vigente && (
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                        <CheckCircle2 size={8} /> vigente
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1">
                    <Calendar size={9} />
                    {l.fecha_ingreso} → {l.fecha_fin} <span className="opacity-70">({l.dias}d)</span>
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-bold tabular-nums text-violet-700">
                    {l.costo_unit_usd !== null ? `$${l.costo_unit_usd.toFixed(2)}` : "—"}
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-bold tabular-nums text-text">
                    {l.costo_unit_ars !== null ? fmtShortAr(l.costo_unit_ars) : "—"}
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  <div className="font-extrabold tabular-nums text-text">{formatNumber(l.units_sold)}</div>
                  <div className="text-[10px] text-text-muted">{l.velocidad_diaria.toFixed(2)} u/d · {l.orders} ord</div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-bold tabular-nums text-primary">{fmtShortAr(l.revenue)}</div>
                </div>
                <div className="col-span-1 text-right">
                  <div className={`font-bold tabular-nums ${l.ganancia >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {fmtShortAr(l.ganancia)}
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className={`text-xs font-bold tabular-nums ${
                    l.margen_pct === null ? "text-text-muted" :
                    l.margen_pct > 30 ? "text-emerald-700" :
                    l.margen_pct > 10 ? "text-amber-700" : "text-rose-700"
                  }`}>
                    {l.margen_pct !== null ? `${l.margen_pct}%` : "—"}
                  </div>
                </div>
                <div className="col-span-2">
                  {l.cantidad_lote > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-soft rounded-full overflow-hidden relative">
                        <div
                          className={over ? "bg-rose-500" : cap > 80 ? "bg-amber-500" : "bg-emerald-500"}
                          style={{ width: `${cap}%`, height: "100%" }}
                        />
                      </div>
                      <span className={`text-[10px] tabular-nums font-bold w-12 text-right ${
                        over ? "text-rose-700" : "text-text"
                      }`}>
                        {l.consumido_pct?.toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-muted italic">Sin cantidad de lote</span>
                  )}
                  {over && (
                    <div className="text-[9px] text-rose-700 mt-0.5 inline-flex items-center gap-1">
                      <AlertTriangle size={9} /> Excede el lote (ventas cubiertas por otros lotes)
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-[10px] text-text-muted">
        <ChevronRight size={9} className="inline" />
        Aproximación temporal: las ventas se asignan al lote vigente en su fecha, no es FIFO real. Cuando "consumido del lote" supera 100% indica
        que las ventas del periodo cubrieron ese lote + saldo de lotes previos.
      </div>
    </div>
  );
}
