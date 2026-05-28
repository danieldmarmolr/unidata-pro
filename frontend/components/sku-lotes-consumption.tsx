"use client";

import { useMemo, useState } from "react";
import {
  Bar, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import { formatNumber, formatCurrency } from "@/lib/utils";
import {
  Package, TrendingUp, TrendingDown, Minus, Calendar,
  Wallet, ChevronRight, AlertTriangle, CheckCircle2, ArrowUpDown, ArrowDown, ArrowUp,
  ExternalLink, Filter,
} from "lucide-react";

// Cruce lote x ventas omnicanal. Cada lote define un periodo (desde su
// fecha_ingreso hasta el siguiente lote). Para cada periodo: unidades
// vendidas, revenue, ganancia neta (revenue - units*costo_lote), velocidad.
// Tambien grafica la evolucion del costo unit USD/ARS a traves del tiempo.

export type LoteConsumption = {
  lote: string | null;
  lote_id: number | null;
  proveedor: string | null;
  fecha_ingreso: string;
  fecha_fin: string;
  vigente: boolean;
  dias: number;
  cantidad_lote: number;
  costo_unit_usd: number | null;
  costo_unit_ars: number | null;             // ARS c/IVA
  costo_unit_ars_sin_iva?: number | null;    // ARS s/IVA
  delta_usd_pct?: number | null;             // delta vs lote anterior cronologico
  precio_ars_sugerido: number | null;
  margen_sugerido_pct?: number | null;       // (precio - costo c/IVA) / precio * 100
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

type SortKey =
  | "fecha" | "costo_usd" | "costo_ars" | "units_sold" | "revenue"
  | "ganancia" | "margen_pct" | "consumido_pct";
type SortDir = "asc" | "desc";
type EstadoFilter = "all" | "vigente" | "agotado" | "sin_ventas";

const fmtAr = (v: number) => formatCurrency(v, "ARS", 2);

function trendIcon(delta: number) {
  if (delta > 2) return { Icon: TrendingUp, tone: "text-rose-700" };
  if (delta < -2) return { Icon: TrendingDown, tone: "text-emerald-700" };
  return { Icon: Minus, tone: "text-text-muted" };
}

function loteYear(fecha: string): string {
  return fecha?.slice(0, 4) ?? "?";
}

export function SkuLotesConsumption({ data, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [estado, setEstado] = useState<EstadoFilter>("all");
  const [proveedor, setProveedor] = useState<string>("all");
  const [year, setYear] = useState<string>("all");

  function clickSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "fecha" ? "desc" : "desc");
    }
  }

  const proveedores = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    for (const l of data.lotes) {
      if (l.proveedor) set.add(l.proveedor);
    }
    return Array.from(set).sort();
  }, [data]);

  const years = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    for (const l of data.lotes) {
      set.add(loteYear(l.fecha_ingreso));
    }
    return Array.from(set).sort().reverse();
  }, [data]);

  const filteredLotes = useMemo(() => {
    if (!data) return [];
    let rows = [...data.lotes];

    if (estado === "vigente") rows = rows.filter((l) => l.vigente);
    if (estado === "agotado") rows = rows.filter((l) => !l.vigente && l.units_sold > 0);
    if (estado === "sin_ventas") rows = rows.filter((l) => l.units_sold === 0);

    if (proveedor !== "all") rows = rows.filter((l) => l.proveedor === proveedor);
    if (year !== "all") rows = rows.filter((l) => loteYear(l.fecha_ingreso) === year);

    rows.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortKey) {
        case "fecha": va = a.fecha_ingreso ?? ""; vb = b.fecha_ingreso ?? ""; break;
        case "costo_usd": va = a.costo_unit_usd ?? 0; vb = b.costo_unit_usd ?? 0; break;
        case "costo_ars": va = a.costo_unit_ars ?? 0; vb = b.costo_unit_ars ?? 0; break;
        case "units_sold": va = a.units_sold; vb = b.units_sold; break;
        case "revenue": va = a.revenue; vb = b.revenue; break;
        case "ganancia": va = a.ganancia; vb = b.ganancia; break;
        case "margen_pct": va = a.margen_pct ?? -999; vb = b.margen_pct ?? -999; break;
        case "consumido_pct": va = a.consumido_pct ?? -1; vb = b.consumido_pct ?? -1; break;
      }
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : Number(va) - Number(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [data, sortKey, sortDir, estado, proveedor, year]);

  if (loading) {
    return <div className="bg-surface border border-border rounded-xl p-5 h-[420px] animate-pulse mb-6" />;
  }
  if (!data || !data.available || data.lotes.length === 0) {
    return null;
  }

  const { lotes, cost_evolution, totals } = data;

  // Con un solo lote el chart de comparacion no tiene sentido (una barra =
  // ninguna historia) ni el badge de delta de costo. Compactamos la vista.
  const singleLote = lotes.length === 1;

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
            <h3 className="text-sm font-bold text-text">
              Consumo lote a lote · ganancia y evolución de costo
              <span className="ml-2 text-[11px] font-normal text-text-muted">
                ({lotes.length} {lotes.length === 1 ? "lote" : "lotes"})
              </span>
            </h3>
            <p className="text-[11px] text-text-muted">
              {singleLote
                ? "Único lote vigente · ganancia = revenue − unidades × costo lote (ARS con IVA)"
                : "Cada lote define un periodo (de su entrada a la del siguiente). Ventas omnicanal en ese rango · ganancia = revenue − unidades × costo lote (ARS con IVA)"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!singleLote && firstUsd > 0 && lastUsd > 0 && (
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

      {/* Totales del periodo · solo cuando hay 2+ lotes (con 1 lote la fila de
          la tabla ya muestra los mismos numeros y duplicar es ruido) */}
      {!singleLote && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div className="bg-soft/40 border border-border rounded-lg px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Vendidas (todos los lotes)</div>
            <div className="text-xl font-extrabold tabular-nums">{formatNumber(totals.units_sold)}</div>
          </div>
          <div className="bg-soft/40 border border-border rounded-lg px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Revenue acumulado</div>
            <div className="text-xl font-extrabold tabular-nums text-primary">{fmtAr(totals.revenue)}</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-emerald-800 font-bold flex items-center gap-1">
              <Wallet size={9} /> Ganancia neta
            </div>
            <div className="text-xl font-extrabold tabular-nums text-emerald-900">{fmtAr(totals.ganancia)}</div>
          </div>
          <div className="bg-primary/5 border border-primary/30 rounded-lg px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-primary/80 font-bold">Margen neto promedio</div>
            <div className="text-xl font-extrabold tabular-nums text-primary">
              {totals.margen_pct !== null ? `${totals.margen_pct}%` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Chart de evolucion · solo cuando hay 2+ lotes (una barra sola no cuenta historia) */}
      {!singleLote && (
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
                    <div className="flex justify-between gap-3"><span>Ganancia</span><span className="font-bold tabular-nums text-emerald-700">{fmtAr(Number(row.ganancia) || 0)}</span></div>
                    <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-border"><span>Costo USD</span><span className="font-bold tabular-nums text-violet-700">US${Number(row.costo_usd).toFixed(2)}</span></div>
                    <div className="flex justify-between gap-3"><span>Costo ARS</span><span className="font-bold tabular-nums">{fmtAr(Number(row.costo_ars) || 0)}</span></div>
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
      )}

      {/* Barra de filtros · solo cuando hay 2+ lotes (con 1 lote no hay nada que filtrar) */}
      {!singleLote && (
      <div className="flex items-center gap-3 flex-wrap mb-3 text-xs">
        <div className="inline-flex items-center gap-1 text-text-muted">
          <Filter size={11} />
          <span className="font-semibold">Filtros:</span>
        </div>
        {/* Estado chips */}
        <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
          {([
            ["all", `Todos (${lotes.length})`],
            ["vigente", `Vigente (${lotes.filter((l) => l.vigente).length})`],
            ["agotado", `Agotado (${lotes.filter((l) => !l.vigente && l.units_sold > 0).length})`],
            ["sin_ventas", `Sin ventas (${lotes.filter((l) => l.units_sold === 0).length})`],
          ] as Array<[EstadoFilter, string]>).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setEstado(k)}
              className={`px-2 py-0.5 rounded-md ${estado === k ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        {/* Proveedor */}
        {proveedores.length > 1 && (
          <div className="inline-flex items-center gap-1.5">
            <span className="text-text-muted">Proveedor:</span>
            <select
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              className="bg-soft border border-border rounded-md px-1.5 py-0.5 text-xs"
            >
              <option value="all">Todos</option>
              {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        {/* Año chips */}
        {years.length > 1 && (
          <div className="inline-flex items-center gap-1">
            <span className="text-text-muted">Año:</span>
            <div className="inline-flex rounded-lg border border-border bg-soft p-0.5">
              <button
                onClick={() => setYear("all")}
                className={`px-1.5 py-0.5 rounded-md ${year === "all" ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"}`}
              >
                Todos
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`px-1.5 py-0.5 rounded-md ${year === y ? "bg-surface text-primary font-bold shadow-sm" : "text-text-muted"}`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        )}
        {(estado !== "all" || proveedor !== "all" || year !== "all") && (
          <button
            onClick={() => { setEstado("all"); setProveedor("all"); setYear("all"); }}
            className="text-[11px] text-primary hover:underline"
          >
            limpiar filtros
          </button>
        )}
        <div className="text-text-muted ml-auto">
          {filteredLotes.length} {filteredLotes.length === 1 ? "lote" : "lotes"} mostrando
        </div>
      </div>
      )}

      {/* Tabla UNIFICADA: combina toda la info del lote (catalogo) con el
          cruce de ventas reales. Reemplaza la antigua "Historial de lotes"
          + "Consumo lote a lote" en una sola fila por lote. */}
      <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-soft/60 text-[10px] uppercase tracking-wider text-text-muted font-bold">
              <TH onClick={() => clickSort("fecha")} active={sortKey === "fecha"} dir={sortDir} align="left">Lote · Periodo · Proveedor</TH>
              <TH align="right">Cantidad</TH>
              <TH onClick={() => clickSort("costo_usd")} active={sortKey === "costo_usd"} dir={sortDir} align="right">Costo USD</TH>
              <TH onClick={() => clickSort("costo_ars")} active={sortKey === "costo_ars"} dir={sortDir} align="right">Costo ARS s/c IVA</TH>
              <TH align="right">Precio sug.</TH>
              <TH align="right">Margen sug.</TH>
              <TH onClick={() => clickSort("units_sold")} active={sortKey === "units_sold"} dir={sortDir} align="right">Vendidas · vel/d</TH>
              <TH onClick={() => clickSort("revenue")} active={sortKey === "revenue"} dir={sortDir} align="right">Revenue</TH>
              <TH onClick={() => clickSort("ganancia")} active={sortKey === "ganancia"} dir={sortDir} align="right">Ganancia</TH>
              <TH onClick={() => clickSort("margen_pct")} active={sortKey === "margen_pct"} dir={sortDir} align="right">Margen real</TH>
              <TH onClick={() => clickSort("consumido_pct")} active={sortKey === "consumido_pct"} dir={sortDir} align="left">Consumido</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredLotes.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-text-muted text-xs italic">
                  Ningún lote coincide con los filtros aplicados.
                </td>
              </tr>
            )}
            {filteredLotes.map((l) => {
              const consumed = l.consumido_pct ?? 0;
              const cap = Math.min(100, consumed);
              const over = consumed > 100;
              const deltaUsd = l.delta_usd_pct;
              return (
                <tr key={`${l.lote}-${l.fecha_ingreso}`} className="hover:bg-soft/30 transition">
                  {/* Lote · Periodo · Proveedor */}
                  <td className="px-3 py-2.5 min-w-[200px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Package size={11} className="text-primary shrink-0" />
                      {l.lote_id ? (
                        <a
                          href={`/dashboard/costos?lote_id=${l.lote_id}`}
                          className="font-mono text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 group"
                          title={`Ver detalle del lote ${l.lote ?? l.lote_id}`}
                        >
                          {l.lote ?? `#${l.lote_id}`}
                          <ExternalLink size={9} className="opacity-50 group-hover:opacity-100" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs font-bold" title={l.lote ?? ""}>{l.lote ?? "?"}</span>
                      )}
                      {l.vigente && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                          <CheckCircle2 size={8} /> vigente
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1 flex-wrap">
                      <Calendar size={9} />
                      {l.fecha_ingreso} → {l.fecha_fin} <span className="opacity-70">({l.dias}d)</span>
                      {l.proveedor && <span className="opacity-70">· {l.proveedor}</span>}
                    </div>
                  </td>

                  {/* Cantidad importada */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-bold tabular-nums text-text">
                      {l.cantidad_lote > 0 ? formatNumber(l.cantidad_lote) : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">importadas</div>
                  </td>

                  {/* Costo USD + Δ vs prev */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-bold tabular-nums text-violet-700">
                      {l.costo_unit_usd !== null ? `US$${l.costo_unit_usd.toFixed(2)}` : "—"}
                    </div>
                    {typeof deltaUsd === "number" && (
                      <div className={`text-[9px] tabular-nums inline-flex items-center gap-0.5 ${
                        deltaUsd > 2 ? "text-rose-700" :
                        deltaUsd < -2 ? "text-emerald-700" : "text-text-muted"
                      }`}>
                        {deltaUsd > 2 ? <TrendingUp size={8} /> : deltaUsd < -2 ? <TrendingDown size={8} /> : <Minus size={8} />}
                        {deltaUsd >= 0 ? "+" : ""}{deltaUsd.toFixed(1)}% prev
                      </div>
                    )}
                  </td>

                  {/* Costo ARS: s/IVA y c/IVA stacked */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-bold tabular-nums text-text">
                      {l.costo_unit_ars !== null ? fmtAr(l.costo_unit_ars) : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">
                      {l.costo_unit_ars_sin_iva ? `s/IVA ${fmtAr(l.costo_unit_ars_sin_iva)}` : "c/IVA"}
                    </div>
                  </td>

                  {/* Precio sugerido */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-bold tabular-nums text-text">
                      {l.precio_ars_sugerido ? fmtAr(l.precio_ars_sugerido) : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">precio sug.</div>
                  </td>

                  {/* Margen sugerido (teorico, sobre precio sugerido) */}
                  <td className="px-2 py-2.5 text-right">
                    <div className={`text-xs font-bold tabular-nums ${
                      l.margen_sugerido_pct === null || l.margen_sugerido_pct === undefined ? "text-text-muted" :
                      l.margen_sugerido_pct > 50 ? "text-emerald-700" :
                      l.margen_sugerido_pct > 25 ? "text-amber-700" : "text-rose-700"
                    }`}>
                      {l.margen_sugerido_pct !== null && l.margen_sugerido_pct !== undefined ? `${l.margen_sugerido_pct}%` : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">teórico</div>
                  </td>

                  {/* Vendidas + velocidad */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-extrabold tabular-nums text-text">{formatNumber(l.units_sold)}</div>
                    <div className="text-[9px] text-text-muted">{l.velocidad_diaria.toFixed(2)} u/d · {l.orders} ord</div>
                  </td>

                  {/* Revenue real */}
                  <td className="px-2 py-2.5 text-right">
                    <div className="font-bold tabular-nums text-primary">{fmtAr(l.revenue)}</div>
                  </td>

                  {/* Ganancia real */}
                  <td className="px-2 py-2.5 text-right">
                    <div className={`font-bold tabular-nums ${l.ganancia >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtAr(l.ganancia)}
                    </div>
                  </td>

                  {/* Margen real (sobre revenue) */}
                  <td className="px-2 py-2.5 text-right">
                    <div className={`text-xs font-bold tabular-nums ${
                      l.margen_pct === null ? "text-text-muted" :
                      l.margen_pct > 30 ? "text-emerald-700" :
                      l.margen_pct > 10 ? "text-amber-700" : "text-rose-700"
                    }`}>
                      {l.margen_pct !== null ? `${l.margen_pct}%` : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">real</div>
                  </td>

                  {/* Consumido del lote */}
                  <td className="px-2 py-2.5 min-w-[130px]">
                    {l.cantidad_lote > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-soft rounded-full overflow-hidden relative">
                          <div
                            className={over ? "bg-rose-500" : cap > 80 ? "bg-amber-500" : "bg-emerald-500"}
                            style={{ width: `${cap}%`, height: "100%" }}
                          />
                        </div>
                        <span className={`text-[10px] tabular-nums font-bold w-10 text-right ${
                          over ? "text-rose-700" : "text-text"
                        }`}>
                          {l.consumido_pct?.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-text-muted italic">—</span>
                    )}
                    {over && (
                      <div className="text-[9px] text-rose-700 mt-0.5 inline-flex items-center gap-1">
                        <AlertTriangle size={9} /> excede lote
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!singleLote && (
        <div className="mt-3 text-[10px] text-text-muted">
          <ChevronRight size={9} className="inline" />
          Aproximación temporal: las ventas se asignan al lote vigente en su fecha, no es FIFO real. Cuando "consumido del lote" supera 100% indica
          que las ventas del periodo cubrieron ese lote + saldo de lotes previos.
        </div>
      )}
    </div>
  );
}

// Header de tabla con sort opcional. Si onClick es undefined la columna no
// es ordenable (ej. Cantidad, Precio sug., Margen sug.).
function TH({
  children, align = "left", onClick, active, dir,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const alignCls = align === "right" ? "text-right" : "text-left";
  if (!onClick) {
    return <th className={`px-2 py-2 ${alignCls} font-bold`}>{children}</th>;
  }
  return (
    <th className={`px-2 py-2 ${alignCls} font-bold cursor-pointer select-none hover:text-text transition ${active ? "text-primary" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
      >
        {children}
        <Icon size={9} className={active ? "" : "opacity-40"} />
      </button>
    </th>
  );
}
