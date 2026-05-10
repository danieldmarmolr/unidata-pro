"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Sparkles, AlertTriangle, ShoppingBag,
  Zap, Snowflake, Activity, Layers, Network, RotateCcw,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Tab = "abc" | "matrix" | "rotation" | "stockout" | "cross-sell" | "trends" | "returns";

export default function ProductAnalyticsPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [tab, setTab] = useState<Tab>("abc");

  return (
    <>
      <Topbar
        title="Producto · Análisis avanzado"
        subtitle="ABC · ABC×XYZ · Rotación · Stockout · Cross-sell · Tendencias · Devoluciones"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <DashboardHeader
          generatedAt={undefined}
          isFetching={false}
          filters={
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "abc", label: "ABC" },
                { value: "matrix", label: "ABC×XYZ" },
                { value: "rotation", label: "Rotación" },
                { value: "stockout", label: "Stockout" },
                { value: "cross-sell", label: "Cross-sell" },
                { value: "trends", label: "Tendencias" },
                { value: "returns", label: "Devoluciones" },
              ]}
            />
          }
        />

        {tab === "abc" && <AbcSection qs={_qs} />}
        {tab === "matrix" && <AbcXyzSection qs={_qs} />}
        {tab === "rotation" && <RotationSection />}
        {tab === "stockout" && <StockoutSection />}
        {tab === "cross-sell" && <CrossSellSection qs={_qs} />}
        {tab === "trends" && <TrendsSection />}
        {tab === "returns" && <ReturnsSection />}
      </div>
    </>
  );
}

// ============================================================
// ABC
// ============================================================
type AbcResp = {
  total_skus: number;
  total_revenue: number;
  classes: Record<"A" | "B" | "C", { count: number; pct_skus: number; revenue: number; pct_revenue: number; label: string; desc: string; color: string }>;
  skus: any[];
};

function AbcSection({ qs }: { qs: string }) {
  const [filter, setFilter] = useState<"all" | "A" | "B" | "C">("all");
  const { data, isLoading } = useQuery<AbcResp>({
    queryKey: ["product-abc", qs],
    queryFn: () => api(`/api/dashboards/products/abc?${qs}`),
    staleTime: 60_000,
  });

  if (isLoading || !data) return <SectionLoader />;

  const visible = filter === "all" ? data.skus : data.skus.filter((s) => s.clase === filter);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {(["A", "B", "C"] as const).map((c) => {
          const cls = data.classes[c];
          return (
            <button
              key={c}
              onClick={() => setFilter(filter === c ? "all" : c)}
              className={
                "bg-surface border-2 rounded-xl p-4 text-left transition hover:shadow-lg " +
                (filter === c ? "ring-2 ring-primary" : "")
              }
              style={{ borderColor: cls.color }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-xs uppercase tracking-wider font-bold" style={{ color: cls.color }}>
                  {cls.label}
                </div>
                <div className="w-10 h-10 rounded-xl text-white flex items-center justify-center text-lg font-extrabold shadow-md" style={{ backgroundColor: cls.color }}>
                  {c}
                </div>
              </div>
              <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(cls.count)} SKUs</div>
              <div className="text-xs text-text-muted">
                {cls.pct_skus}% del catálogo · genera <strong className="text-text">{cls.pct_revenue}%</strong> del revenue
              </div>
              <div className="text-[11px] mt-2 pt-2 border-t border-border">
                <span className="text-text-muted">Revenue:</span>{" "}
                <span className="font-bold">{formatCurrency(cls.revenue)}</span>
              </div>
              <div className="text-[10px] text-text-muted mt-1.5">{cls.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Tabla ranking */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-text">
              Ranking ABC {filter !== "all" && `· Clase ${filter}`}
            </h3>
            <p className="text-[11px] text-text-muted">
              {formatNumber(visible.length)} SKUs · ordenado por revenue descendente · click para abrir
            </p>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Clase</th>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">% Rev</th>
                <th className="text-right px-3 py-2">% Acum</th>
                <th className="text-right px-3 py-2">Unidades</th>
                <th className="text-right px-3 py-2">Órdenes</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 500).map((s) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5 text-right text-text-muted tabular-nums">{s.rank}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                      style={{ backgroundColor: data.classes[s.clase as "A" | "B" | "C"].color }}
                    >
                      {s.clase}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/dashboard/productos/${encodeURIComponent(s.sku)}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {s.nombre}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}{s.ean ? ` · EAN ${s.ean}` : ""}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold">{formatCurrency(s.revenue)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.pct_revenue}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.pct_acum}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.unidades)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.ordenes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// ABC × XYZ Matriz
// ============================================================
type MatrixResp = {
  matrix: Array<{
    cell: string; abc: string; xyz: string; count: number; revenue: number;
    label: string; color: string; desc: string; top_skus: any[];
  }>;
  total_skus: number;
  total_revenue: number;
};

function AbcXyzSection({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<MatrixResp>({
    queryKey: ["product-abc-xyz", qs],
    queryFn: () => api(`/api/dashboards/products/abc-xyz?${qs}`),
    staleTime: 60_000,
  });
  const [openCell, setOpenCell] = useState<string | null>(null);
  if (isLoading || !data) return <SectionLoader />;

  const cellByKey = Object.fromEntries(data.matrix.map((c) => [c.cell, c]));
  const matrix3x3 = [
    ["AX", "AY", "AZ"],
    ["BX", "BY", "BZ"],
    ["CX", "CY", "CZ"],
  ];

  return (
    <>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4 text-xs text-violet-900">
        <strong>ABC × XYZ:</strong> cruza importancia (revenue) con predictibilidad (volatilidad de demanda).
        Cada cuadrante tiene una acción operativa sugerida. Click para ver los SKUs.
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="w-16"></th>
              <th className="text-center px-2 py-2 text-xs font-bold text-text-muted">
                X · Demanda estable<br /><span className="font-normal">(CV &lt; 25%)</span>
              </th>
              <th className="text-center px-2 py-2 text-xs font-bold text-text-muted">
                Y · Fluctuante<br /><span className="font-normal">(CV 25-50%)</span>
              </th>
              <th className="text-center px-2 py-2 text-xs font-bold text-text-muted">
                Z · Errática<br /><span className="font-normal">(CV &gt; 50%)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix3x3.map((row, ri) => (
              <tr key={ri}>
                <td className="text-right pr-2 text-xs font-bold text-text-muted align-middle">
                  {ri === 0 && <>A · Vitales<br /><span className="font-normal">80% rev</span></>}
                  {ri === 1 && <>B · Importantes<br /><span className="font-normal">15% rev</span></>}
                  {ri === 2 && <>C · Cola larga<br /><span className="font-normal">5% rev</span></>}
                </td>
                {row.map((key) => {
                  const cell = cellByKey[key];
                  if (!cell) return <td key={key} />;
                  return (
                    <td key={key} className="p-1.5 align-top">
                      <button
                        onClick={() => setOpenCell(openCell === key ? null : key)}
                        className="w-full h-32 rounded-lg p-3 text-left text-white shadow-sm hover:shadow-md transition flex flex-col justify-between"
                        style={{ backgroundColor: cell.color }}
                      >
                        <div>
                          <div className="text-lg font-extrabold">{cell.cell}</div>
                          <div className="text-[10px] uppercase tracking-wider opacity-90 mt-0.5">{cell.label}</div>
                        </div>
                        <div>
                          <div className="text-xl font-extrabold tabular-nums">{formatNumber(cell.count)}</div>
                          <div className="text-[10px] opacity-90">{formatCurrency(cell.revenue)}</div>
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle del cuadrante abierto */}
      {openCell && cellByKey[openCell] && (
        <div className="mt-4 bg-surface border-2 rounded-xl p-4" style={{ borderColor: cellByKey[openCell].color }}>
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-14 h-14 rounded-xl text-white flex items-center justify-center text-2xl font-extrabold flex-shrink-0"
              style={{ backgroundColor: cellByKey[openCell].color }}
            >
              {openCell}
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-text">{cellByKey[openCell].label}</h3>
              <p className="text-sm text-text-muted mt-0.5">{cellByKey[openCell].desc}</p>
              <div className="text-xs mt-1">
                <strong>{cellByKey[openCell].count} SKUs</strong> · revenue {formatCurrency(cellByKey[openCell].revenue)}
              </div>
            </div>
            <button onClick={() => setOpenCell(null)} className="text-text-muted hover:text-text text-xs px-2 py-1 border border-border rounded">Cerrar</button>
          </div>
          {cellByKey[openCell].top_skus.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">Top SKUs del cuadrante</div>
              <table className="w-full text-xs">
                <tbody>
                  {cellByKey[openCell].top_skus.map((s: any) => (
                    <tr key={s.sku} className="border-t border-border">
                      <td className="py-1.5">
                        <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">
                          {s.nombre}
                        </Link>
                        <span className="text-[10px] text-text-muted/70 ml-2 font-mono">{s.sku}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-bold">{formatCurrency(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ============================================================
// Rotation (Days of Inventory)
// ============================================================
function RotationSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-rotation"],
    queryFn: () => api(`/api/dashboards/products/rotation`),
    staleTime: 60_000,
  });
  const [filter, setFilter] = useState<"all" | "rapido" | "normal" | "lento" | "muerto">("all");
  if (isLoading || !data) return <SectionLoader />;

  const visible = filter === "all" ? data.skus : data.skus.filter((s: any) => s.bucket === filter);

  return (
    <>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-xs text-emerald-900">
        <strong>Days of Inventory:</strong> días promedio para vender una unidad al ritmo actual.
        SKUs con DoI &gt; 180 son <strong>capital inmovilizado</strong> → candidatos a liquidación.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {(["rapido", "normal", "lento", "muerto"] as const).map((b) => (
          <button
            key={b}
            onClick={() => setFilter(filter === b ? "all" : b)}
            className={
              "bg-surface border-2 rounded-xl p-4 text-left transition hover:shadow-lg " +
              (filter === b ? "ring-2 ring-primary" : "")
            }
            style={{ borderColor: data.buckets[b].color }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-xl text-white flex items-center justify-center" style={{ backgroundColor: data.buckets[b].color }}>
                {b === "rapido" ? <Zap size={16} /> : b === "muerto" ? <Snowflake size={16} /> : <Activity size={16} />}
              </div>
              <div className="text-xs uppercase tracking-wider font-bold" style={{ color: data.buckets[b].color }}>
                {data.buckets[b].label}
              </div>
            </div>
            <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(data.buckets[b].count)}</div>
            <div className="text-[11px] text-text-muted mt-0.5">SKUs en esta velocidad</div>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">SKUs por velocidad de rotación</h3>
          <p className="text-[11px] text-text-muted">{formatNumber(visible.length)} SKUs con stock disponible</p>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Stock actual</th>
                <th className="text-right px-3 py-2">Ventas/día</th>
                <th className="text-right px-3 py-2">DoI</th>
                <th className="text-left px-3 py-2">Velocidad</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 500).map((s: any) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">
                      {s.nombre}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.stock_actual)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.ventas_dia_avg}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold">
                    {s.days_of_inventory !== null ? `${s.days_of_inventory}d` : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: data.buckets[s.bucket].color }}>
                      {data.buckets[s.bucket].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Stockout risk
// ============================================================
function StockoutSection() {
  const [threshold, setThreshold] = useState(14);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-stockout", threshold],
    queryFn: () => api(`/api/dashboards/products/stockout-risk?threshold_days=${threshold}`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;

  return (
    <>
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-4 flex items-center gap-3">
        <AlertTriangle size={20} className="text-rose-600" />
        <div className="flex-1 text-xs text-rose-900">
          <strong>{data.count} SKUs</strong> se agotan en menos de {threshold} días al ritmo actual · reposición urgente
        </div>
        <select
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="text-xs border border-rose-300 bg-white rounded px-2 py-1"
        >
          <option value={7}>7 días</option>
          <option value={14}>14 días</option>
          <option value={30}>30 días</option>
        </select>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Stock</th>
                <th className="text-right px-3 py-2">Ventas/día</th>
                <th className="text-right px-3 py-2">Días restantes</th>
              </tr>
            </thead>
            <tbody>
              {data.skus.map((s: any) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">
                      {s.nombre}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.stock_actual)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.ventas_dia_avg}</td>
                  <td className={
                    "px-3 py-1.5 text-right tabular-nums font-bold " +
                    (s.days_of_inventory <= 7 ? "text-rose-700" : "text-amber-700")
                  }>
                    {s.days_of_inventory}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Cross-sell pairs
// ============================================================
function CrossSellSection({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-cross-sell", qs],
    queryFn: () => api(`/api/dashboards/products/cross-sell?${qs}&top_n=50`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;

  return (
    <>
      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 mb-4 text-xs text-cyan-900">
        <strong>Market basket:</strong> productos comprados juntos en la misma orden.
        Usalo para recomendaciones en checkout, packs y promos cruzadas.
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">Top {data.pairs.length} pares de SKUs comprados juntos</h3>
          <p className="text-[11px] text-text-muted">Ordenado por co-ocurrencias · mínimo 3 órdenes compartidas</p>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Producto A</th>
                <th className="text-left px-3 py-2">Producto B</th>
                <th className="text-right px-3 py-2">Co-ocurrencias</th>
              </tr>
            </thead>
            <tbody>
              {data.pairs.map((p: any, i: number) => (
                <tr key={`${p.sku_a}-${p.sku_b}`} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5 text-right text-text-muted tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_a)}`} className="text-primary hover:underline">
                      {p.name_a}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_a}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_b)}`} className="text-primary hover:underline">
                      {p.name_b}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_b}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold">{p.co_ocurrencias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Trends
// ============================================================
function TrendsSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-trends"],
    queryFn: () => api(`/api/dashboards/products/trends?period_days=30`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-900">
        <strong>Tendencias:</strong> SKUs que crecieron o cayeron &gt;30% comparando últimos 30 días vs los 30 días previos.
        Nuevos productos = primera venta en este período.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrendList title="📈 En crecimiento" icon={TrendingUp} color="emerald" skus={data.growing.skus} count={data.growing.count} showGrowth />
        <TrendList title="📉 En declive" icon={TrendingDown} color="rose" skus={data.declining.skus} count={data.declining.count} showGrowth />
        <TrendList title="✨ Nuevos productos" icon={Sparkles} color="violet" skus={data.new_products.skus} count={data.new_products.count} showGrowth={false} />
      </div>
    </>
  );
}

function TrendList({ title, icon: Icon, color, skus, count, showGrowth }: any) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className={`px-4 py-3 border-b border-border bg-${color}-50`}>
        <h3 className="text-sm font-bold text-text flex items-center gap-2">
          <Icon size={14} className={`text-${color}-600`} />
          {title} · {count}
        </h3>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {skus.length === 0 && <div className="p-6 text-center text-text-muted text-xs">Sin datos</div>}
        {skus.map((s: any) => (
          <div key={s.sku} className="px-4 py-2 border-b border-border last:border-0 hover:bg-soft/40">
            <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-sm text-primary hover:underline font-medium block truncate">
              {s.nombre}
            </Link>
            <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
            <div className="flex items-center gap-2 mt-1 text-[11px]">
              <span className="font-bold">{formatCurrency(s.revenue_actual)}</span>
              {showGrowth && s.growth_pct !== null && (
                <span className={`font-bold ${s.growth_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {s.growth_pct >= 0 ? "+" : ""}{s.growth_pct}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Returns rate
// ============================================================
function ReturnsSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-returns"],
    queryFn: () => api(`/api/dashboards/products/returns-rate?period_days=90`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-900 flex items-center gap-2">
        <RotateCcw size={16} />
        <span><strong>Returns rate:</strong> % de devoluciones sobre ventas (últimos 90d). Tasa alta → revisar calidad/expectativa.</span>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Vendidas</th>
                <th className="text-right px-3 py-2">Devueltas</th>
                <th className="text-right px-3 py-2">Returns Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.skus.map((s: any) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">
                      {s.nombre}
                    </Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.vendidas)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.devueltas)}</td>
                  <td className={
                    "px-3 py-1.5 text-right tabular-nums font-bold " +
                    (s.returns_rate_pct >= 15 ? "text-rose-700" : s.returns_rate_pct >= 5 ? "text-amber-700" : "text-emerald-700")
                  }>
                    {s.returns_rate_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function SectionLoader() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 bg-surface border border-border rounded-xl animate-pulse" />
      ))}
    </div>
  );
}
