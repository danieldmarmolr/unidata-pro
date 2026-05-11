"use client";

import { useState, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Sparkles, AlertTriangle, ShoppingBag,
  Zap, Snowflake, Activity, Layers, Network, RotateCcw,
  ImageOff, Info,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";

type Tab =
  | "abc" | "matrix" | "abc-margen"
  | "rotation" | "stockout" | "simulator"
  | "cross-sell" | "affinity" | "cannibalization"
  | "trends" | "lifecycle" | "elasticity" | "returns"
  | "forecast";

type Unit = "unistore" | "unidrop";
type ProductType = "all" | "products" | "services";

// Helper: SKUs que empiezan con PVA son servicios (planes Meli, etc.).
// Tambien hay otros patrones de servicio definidos en backend (sku_rules.py)
// pero PVA es el dominante y el que el usuario nos pidio separar.
export function isServiceSku(sku: string): boolean {
  if (!sku) return false;
  return /^PVA/i.test(sku.trim());
}

// Context para que las secciones hijas accedan a unit/type sin prop drilling
type AnalyticsCtx = { unit: Unit; productType: ProductType };
const AnalyticsContext = createContext<AnalyticsCtx>({ unit: "unistore", productType: "all" });

/** Aplica el filtro Producto/Servicio a una lista de SKUs. */
function applyTypeFilter<T extends { sku?: string }>(items: T[], type: ProductType): T[] {
  if (type === "all") return items;
  if (type === "products") return items.filter((s) => !isServiceSku(s.sku ?? ""));
  return items.filter((s) => isServiceSku(s.sku ?? ""));
}

/** Componente reusable: descripción explicativa de un análisis. */
function AnalysisIntro({ title, what, how }: { title: string; what: string; how: string }) {
  return (
    <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-4 mb-4 flex items-start gap-3">
      <Info size={16} className="text-violet-600 shrink-0 mt-0.5" />
      <div className="flex-1 text-xs">
        <div className="font-bold text-violet-900 mb-0.5">{title}</div>
        <div className="text-violet-800/90 leading-relaxed">
          <strong>Qué es:</strong> {what}
        </div>
        <div className="text-violet-800/90 mt-1 leading-relaxed">
          <strong>Cómo aprovecharlo:</strong> {how}
        </div>
      </div>
    </div>
  );
}

export default function ProductAnalyticsPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [tab, setTab] = useState<Tab>("abc");
  const [unit, setUnit] = useState<Unit>("unistore");
  const [productType, setProductType] = useState<ProductType>("all");
  const qsWithUnit = `${_qs}&unit=${unit}`;

  return (
    <>
      <Topbar
        title="Producto · Análisis avanzado"
        subtitle="14 análisis · Performance · Stock · Behavior · Forecast · Quality"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        {/* Filtros maestros: unidad de negocio + tipo de SKU */}
        <div className="mb-4 flex items-center gap-3 flex-wrap bg-surface border border-border rounded-xl px-4 py-3">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Unidad</span>
          <Segmented<Unit>
            value={unit}
            onChange={setUnit}
            options={[
              { value: "unistore", label: "Unistore" },
              { value: "unidrop", label: "Unidrop" },
            ]}
          />
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold ml-4">Tipo</span>
          <Segmented<ProductType>
            value={productType}
            onChange={setProductType}
            options={[
              { value: "all", label: "Todos" },
              { value: "products", label: "Productos físicos" },
              { value: "services", label: "Servicios (PVA*)" },
            ]}
          />
          <span className="text-[10px] text-text-muted ml-auto">
            {unit === "unidrop" && (
              <span className="text-amber-700">⚠ Soporte Unidrop en analytics avanzados pendiente — algunas vistas pueden seguir mostrando Unistore</span>
            )}
          </span>
        </div>

        {/* Navigation: agrupada en 5 categorias */}
        <div className="mb-4 space-y-2">
          <TabGroup
            label="🎯 Performance"
            color="from-emerald-50 to-teal-50"
            tabs={[
              { value: "abc", label: "ABC (Pareto)" },
              { value: "abc-margen", label: "ABC por margen" },
              { value: "matrix", label: "ABC × XYZ" },
            ]}
            current={tab}
            onChange={setTab}
          />
          <TabGroup
            label="📦 Stock & Rotación"
            color="from-blue-50 to-cyan-50"
            tabs={[
              { value: "rotation", label: "Rotación (DoI)" },
              { value: "stockout", label: "Stockout risk" },
              { value: "simulator", label: "Simulador stockout" },
            ]}
            current={tab}
            onChange={setTab}
          />
          <TabGroup
            label="🤝 Behavior / Cross-sell"
            color="from-cyan-50 to-sky-50"
            tabs={[
              { value: "cross-sell", label: "Cross-sell pairs" },
              { value: "affinity", label: "Affinity (lift)" },
              { value: "cannibalization", label: "Canibalización" },
            ]}
            current={tab}
            onChange={setTab}
          />
          <TabGroup
            label="📈 Tendencias & Forecast"
            color="from-violet-50 to-purple-50"
            tabs={[
              { value: "trends", label: "Tendencias 30d" },
              { value: "lifecycle", label: "Lifecycle" },
              { value: "elasticity", label: "Elasticidad-precio" },
              { value: "forecast", label: "Forecast por SKU" },
            ]}
            current={tab}
            onChange={setTab}
          />
          <TabGroup
            label="🛡️ Quality"
            color="from-rose-50 to-pink-50"
            tabs={[
              { value: "returns", label: "Returns rate" },
            ]}
            current={tab}
            onChange={setTab}
          />
        </div>

        <AnalyticsContext.Provider value={{ unit, productType }}>
          {tab === "abc" && <AbcSection qs={qsWithUnit} />}
          {tab === "abc-margen" && <AbcMargenSection qs={qsWithUnit} />}
          {tab === "matrix" && <AbcXyzSection qs={qsWithUnit} />}
          {tab === "rotation" && <RotationSection />}
          {tab === "stockout" && <StockoutSection />}
          {tab === "simulator" && <SimulatorSection />}
          {tab === "cross-sell" && <CrossSellSection qs={qsWithUnit} />}
          {tab === "affinity" && <AffinitySection />}
          {tab === "cannibalization" && <CannibalizationSection />}
          {tab === "trends" && <TrendsSection />}
          {tab === "lifecycle" && <LifecycleSection />}
          {tab === "elasticity" && <ElasticitySection />}
          {tab === "forecast" && <ForecastSection />}
          {tab === "returns" && <ReturnsSection />}
        </AnalyticsContext.Provider>
      </div>
    </>
  );
}

// ============================================================
// TabGroup component - grupo de tabs por categoria
// ============================================================
function TabGroup({
  label,
  color,
  tabs,
  current,
  onChange,
}: {
  label: string;
  color: string;
  tabs: { value: Tab; label: string }[];
  current: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className={`bg-gradient-to-r ${color} border border-border rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted whitespace-nowrap">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={
              "px-3 py-1 text-xs rounded-md transition whitespace-nowrap " +
              (current === t.value
                ? "bg-primary text-white shadow"
                : "bg-white/80 text-text hover:bg-white border border-border/60")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
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
  const ctx = useContext(AnalyticsContext);
  const [filter, setFilter] = useState<"all" | "A" | "B" | "C">("all");
  const { data, isLoading } = useQuery<AbcResp>({
    queryKey: ["product-abc", qs],
    queryFn: () => api(`/api/dashboards/products/abc?${qs}`),
    staleTime: 60_000,
  });

  if (isLoading || !data) return <SectionLoader />;

  // Aplico SIEMPRE el filtro Producto/Servicio antes de filtrar por clase A/B/C
  const skusByType = applyTypeFilter(data.skus, ctx.productType);
  const visible = filter === "all" ? skusByType : skusByType.filter((s) => s.clase === filter);

  // Enriquecimiento con thumbnails (primeros 80 SKUs visibles para no spamear)
  const skuList = visible.slice(0, 80).map((s) => s.sku).filter(Boolean);
  const enriched = useSkuEnrichment("unistore", skuList);
  const enrichMap = enriched.data ?? {};

  return (
    <>
      <AnalysisIntro
        title="ABC (análisis de Pareto)"
        what="Clasifica tus SKUs según cuánto contribuyen al revenue. Clase A son el 20% que genera el 80% del negocio. Clase B son importantes pero secundarios. Clase C es cola larga: muchos SKUs que aportan poco."
        how="Foco operativo: garantizar stock 24/7 de los Clase A, monitorear Clase B con regla normal de reposición, y revisar Clase C buscando candidatos a discontinuar o convertir en combo con un Clase A. Click en una tarjeta para filtrar el ranking."
      />
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
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                        {enrichMap[s.sku]?.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={enrichMap[s.sku].image_url!}
                            alt={s.nombre}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <ImageOff size={14} className="text-text-muted/40" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/dashboard/productos/${encodeURIComponent(s.sku)}`}
                          className="text-primary hover:underline font-medium block truncate max-w-[360px]"
                          title={s.nombre}
                        >
                          {s.nombre}
                          {isServiceSku(s.sku) && (
                            <span className="ml-1.5 inline-block text-[9px] font-bold px-1 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 align-middle">
                              SERVICIO
                            </span>
                          )}
                        </Link>
                        <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}{s.ean ? ` · EAN ${s.ean}` : ""}</div>
                      </div>
                    </div>
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

// ============================================================
// ABC por Margen
// ============================================================
function AbcMargenSection({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-abc-margen", qs],
    queryFn: () => api(`/api/dashboards/products/abc-margen?${qs}`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;
  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-900">
        <strong>⚠️ {data.warning}</strong>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {(["A", "B", "C"] as const).map((c) => (
          <div key={c} className="bg-surface border-2 rounded-xl p-4" style={{ borderColor: c === "A" ? "#10b981" : c === "B" ? "#f59e0b" : "#94a3b8" }}>
            <div className="text-xs uppercase tracking-wider font-bold text-text-muted">Clase {c} · Margen</div>
            <div className="text-3xl font-extrabold text-text tabular-nums mt-1">{formatNumber(data.classes[c].count)}</div>
            <div className="text-[11px] text-text-muted">SKUs · margen total {formatCurrency(data.classes[c].margen)} ({data.classes[c].pct_margen}%)</div>
          </div>
        ))}
      </div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">SKU / Producto</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">Costo est.</th>
                <th className="text-right px-3 py-2">Margen est.</th>
                <th className="text-right px-3 py-2">Margen %</th>
                <th className="text-left px-3 py-2">Clase</th>
              </tr>
            </thead>
            <tbody>
              {data.skus.slice(0, 500).map((s: any) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{s.rank_margen}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">{s.nombre}</Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(s.revenue)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{formatCurrency(s.costo_estimado)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold text-emerald-700">{formatCurrency(s.margen_estimado)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.margen_pct}%</td>
                  <td className="px-3 py-1.5"><span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: s.clase_margen === "A" ? "#10b981" : s.clase_margen === "B" ? "#f59e0b" : "#94a3b8" }}>{s.clase_margen}</span></td>
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
// Simulator Stockout
// ============================================================
function SimulatorSection() {
  const [change, setChange] = useState(50);
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-simulator", change, days],
    queryFn: () => api(`/api/dashboards/products/stockout-simulator?demand_change_pct=${change}&days_to_simulate=${days}`),
    staleTime: 60_000,
  });
  return (
    <>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4">
        <div className="text-sm font-bold text-violet-900 mb-2">🎲 ¿Qué pasaría si...?</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <label className="block">
            <span className="text-text-muted font-semibold">Cambio de demanda</span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range" min="-50" max="200" step="10" value={change}
                onChange={(e) => setChange(Number(e.target.value))}
                className="flex-1"
              />
              <span className={"font-extrabold tabular-nums w-12 text-right " + (change > 0 ? "text-emerald-700" : change < 0 ? "text-rose-700" : "text-text-muted")}>
                {change >= 0 ? "+" : ""}{change}%
              </span>
            </div>
            <div className="text-[10px] text-text-muted/70 mt-0.5">
              {change > 0 ? "📈 Simulando promo/black-friday" : change < 0 ? "📉 Simulando caida estacional" : "Sin cambio (baseline)"}
            </div>
          </label>
          <label className="block">
            <span className="text-text-muted font-semibold">Horizonte (días)</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 border border-border rounded text-sm">
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
          </label>
        </div>
      </div>
      {isLoading || !data ? <SectionLoader /> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="bg-surface border-2 border-rose-300 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider font-bold text-rose-700">SKUs en stockout</div>
              <div className="text-3xl font-extrabold text-text mt-1">{formatNumber(data.skus_stockout)}</div>
              <div className="text-[11px] text-text-muted mt-1">de {formatNumber(data.total_skus)} con stock</div>
            </div>
            <div className="bg-surface border-2 border-amber-300 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider font-bold text-amber-700">Déficit total</div>
              <div className="text-3xl font-extrabold text-text mt-1">{formatNumber(data.deficit_total_unidades)}</div>
              <div className="text-[11px] text-text-muted mt-1">unidades a reponer</div>
            </div>
            <div className="bg-surface border-2 border-violet-300 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider font-bold text-violet-700">Escenario</div>
              <div className="text-3xl font-extrabold text-text mt-1">{data.demand_change_pct >= 0 ? "+" : ""}{data.demand_change_pct}%</div>
              <div className="text-[11px] text-text-muted mt-1">demanda en {data.days_to_simulate}d</div>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">SKU</th>
                    <th className="text-right px-3 py-2">Stock</th>
                    <th className="text-right px-3 py-2">Ventas/día actual</th>
                    <th className="text-right px-3 py-2">Ventas/día simulado</th>
                    <th className="text-right px-3 py-2">Días que dura</th>
                    <th className="text-right px-3 py-2">Déficit (u)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.skus_at_risk.map((s: any) => (
                    <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                      <td className="px-3 py-1.5">
                        <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline">{s.nombre}</Link>
                        <div className="text-[10px] text-text-muted/70 font-mono">{s.sku}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.stock_actual)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{s.ventas_dia_avg_actual}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{s.ventas_dia_simulado}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-rose-700">{s.days_left_simulado}d</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-amber-700">{formatNumber(s.deficit_unidades)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ============================================================
// Affinity (lift + confidence)
// ============================================================
function AffinitySection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-affinity"],
    queryFn: () => api(`/api/dashboards/products/affinity?period_days=90&top_n=50`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;
  return (
    <>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-xs text-emerald-900">
        <strong>Lift &gt; 1</strong> = asociación real (no es azar). <strong>Confidence A→B</strong> = % de clientes que compran A y también compran B. Ordenado por lift descendente — los mejores pares al tope.
      </div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Producto A</th>
                <th className="text-left px-3 py-2">Producto B</th>
                <th className="text-right px-3 py-2">Co-oc</th>
                <th className="text-right px-3 py-2">Lift</th>
                <th className="text-right px-3 py-2">Conf A→B</th>
                <th className="text-right px-3 py-2">Conf B→A</th>
              </tr>
            </thead>
            <tbody>
              {data.pairs.map((p: any, i: number) => (
                <tr key={`${p.sku_a}-${p.sku_b}`} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_a)}`} className="text-primary hover:underline">{p.name_a}</Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_a}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_b)}`} className="text-primary hover:underline">{p.name_b}</Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_b}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.co_oc}</td>
                  <td className={"px-3 py-1.5 text-right tabular-nums font-bold " + (p.lift > 3 ? "text-emerald-700" : p.lift > 1.5 ? "text-emerald-600" : "text-text")}>{p.lift}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.confidence_ab_pct}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.confidence_ba_pct}%</td>
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
// Cannibalization
// ============================================================
function CannibalizationSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-cannibalization"],
    queryFn: () => api(`/api/dashboards/products/cannibalization`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;
  return (
    <>
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-4 text-xs text-rose-900">
        <strong>Canibalización:</strong> mismo cliente <em>aumenta</em> compras del SKU A y <em>reduce</em> compras del SKU B. Indica sustitución entre productos del mismo cliente. Útil para detectar nuevos productos que matan a los viejos.
      </div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">SKU que gana ↑</th>
                <th className="text-left px-3 py-2">SKU que pierde ↓</th>
                <th className="text-right px-3 py-2">Clientes</th>
                <th className="text-right px-3 py-2">Unidades sustituidas</th>
              </tr>
            </thead>
            <tbody>
              {data.pairs.map((p: any, i: number) => (
                <tr key={`${p.sku_gain}-${p.sku_loss}`} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_gain)}`} className="text-emerald-700 hover:underline font-medium">{p.name_gain}</Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_gain}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_loss)}`} className="text-rose-700 hover:underline font-medium">{p.name_loss}</Link>
                    <div className="text-[10px] text-text-muted/70 font-mono">{p.sku_loss}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold">{p.clientes}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.unidades_sustituidas}</td>
                </tr>
              ))}
              {data.pairs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-text-muted">Sin canibalizaciones detectadas en el período</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Lifecycle
// ============================================================
function LifecycleSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-lifecycle"],
    queryFn: () => api(`/api/dashboards/products/lifecycle`),
    staleTime: 60_000,
  });
  if (isLoading || !data) return <SectionLoader />;
  const stages = ["nuevo", "growth", "maduro", "declive", "dormido"];
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {stages.map((k) => (
          <div key={k} className="bg-surface border-2 rounded-xl p-4" style={{ borderColor: data.stages[k].color }}>
            <div className="text-xs uppercase tracking-wider font-bold" style={{ color: data.stages[k].color }}>{data.stages[k].label}</div>
            <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{formatNumber(data.stages[k].count)}</div>
            <div className="text-[10px] text-text-muted mt-1 line-clamp-2">{data.stages[k].desc}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {stages.map((k) => (
          <div key={k} className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border" style={{ background: `linear-gradient(to right, ${data.stages[k].color}15, transparent)` }}>
              <h3 className="text-sm font-bold" style={{ color: data.stages[k].color }}>{data.stages[k].label}</h3>
              <p className="text-[10px] text-text-muted">{data.stages[k].count} SKUs · top 50 por revenue 30d</p>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {data.stages[k].skus.length === 0 && <div className="p-4 text-xs text-text-muted text-center">Sin SKUs</div>}
              {data.stages[k].skus.map((s: any) => (
                <div key={s.sku} className="px-4 py-2 border-b border-border last:border-0 hover:bg-soft/40">
                  <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-xs text-primary hover:underline font-medium block truncate">{s.nombre}</Link>
                  <div className="flex items-center gap-2 mt-1 text-[10px]">
                    <span className="font-bold">{formatCurrency(s.rev_30d)}</span>
                    {s.growth_pct !== null && <span className={s.growth_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>{s.growth_pct >= 0 ? "+" : ""}{s.growth_pct}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================
// Price Elasticity
// ============================================================
function ElasticitySection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-elasticity"],
    queryFn: () => api(`/api/dashboards/products/price-elasticity`),
    staleTime: 60_000,
  });
  const [filter, setFilter] = useState<"all" | "elastica" | "inelastica" | "anomala">("all");
  if (isLoading || !data) return <SectionLoader />;

  const visible = filter === "all" ? data.skus : data.skus.filter((s: any) => s.kind === filter);

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-900">
        <strong>Elasticidad-precio:</strong> -1 significa que si subís el precio 10% bajan las ventas 10%. Valores &lt;-1 son <strong>elásticos</strong> (sensibles al precio). Entre 0 y -1 son <strong>inelásticos</strong> (podés subir precio sin perder mucho volumen).
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {(["elastica", "inelastica", "anomala"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(filter === k ? "all" : k)}
            className={"bg-surface border-2 rounded-xl p-4 text-left transition hover:shadow-lg " + (filter === k ? "ring-2 ring-primary" : "")}
            style={{ borderColor: data.kinds[k].color }}
          >
            <div className="text-xs uppercase tracking-wider font-bold" style={{ color: data.kinds[k].color }}>{data.kinds[k].label}</div>
            <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{formatNumber(data.skus.filter((s: any) => s.kind === k).length)}</div>
            <div className="text-[10px] text-text-muted mt-1">{data.kinds[k].desc}</div>
          </button>
        ))}
      </div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-right px-3 py-2">Elasticidad</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-right px-3 py-2">Precio avg</th>
                <th className="text-right px-3 py-2">Unidades/mes avg</th>
                <th className="text-right px-3 py-2">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s: any) => (
                <tr key={s.sku} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(s.sku)}`} className="text-primary hover:underline font-mono">{s.sku}</Link>
                  </td>
                  <td className={"px-3 py-1.5 text-right tabular-nums font-bold " + (s.kind === "elastica" ? "text-rose-700" : s.kind === "inelastica" ? "text-emerald-700" : "text-text-muted")}>{s.elasticity}</td>
                  <td className="px-3 py-1.5"><span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: data.kinds[s.kind].color }}>{s.kind}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(s.precio_avg)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.unidades_avg}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{s.data_points}</td>
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
// Forecast por SKU
// ============================================================
function ForecastSection() {
  const [sku, setSku] = useState<string>("");
  const [submittedSku, setSubmittedSku] = useState<string>("");
  const [daysHistory, setDaysHistory] = useState(90);
  const [daysAhead, setDaysAhead] = useState(30);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["product-forecast", submittedSku, daysHistory, daysAhead],
    queryFn: () => api(`/api/dashboards/products/forecast/${encodeURIComponent(submittedSku)}?days_history=${daysHistory}&days_ahead=${daysAhead}`),
    staleTime: 60_000,
    enabled: !!submittedSku,
  });
  return (
    <>
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4">
        <div className="text-sm font-bold text-violet-900 mb-2">🔮 Forecast por SKU</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="md:col-span-2">
            <label className="text-text-muted font-semibold">SKU a forecastear</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              placeholder="Ej: SW7EN1"
              onKeyDown={(e) => e.key === "Enter" && setSubmittedSku(sku.trim())}
              className="mt-1 w-full px-3 py-1.5 border border-border rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-text-muted font-semibold">Historia (días)</label>
            <select value={daysHistory} onChange={(e) => setDaysHistory(Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 border border-border rounded text-sm">
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={90}>90</option>
              <option value={180}>180</option>
            </select>
          </div>
          <div>
            <label className="text-text-muted font-semibold">Forecast (días)</label>
            <select value={daysAhead} onChange={(e) => setDaysAhead(Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 border border-border rounded text-sm">
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={90}>90</option>
            </select>
          </div>
        </div>
        <button
          onClick={() => setSubmittedSku(sku.trim())}
          disabled={!sku}
          className="mt-3 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow disabled:opacity-50"
        >
          Generar forecast
        </button>
      </div>

      {!submittedSku && <div className="text-text-muted text-sm text-center py-12">Ingresá un SKU y dale "Generar forecast"</div>}
      {submittedSku && (isLoading ? <SectionLoader /> : data?.error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 text-sm">{data.error}</div>
      ) : data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Tendencia</div>
              <div className="text-xl font-extrabold text-text mt-1 capitalize">{data.trend}</div>
              <div className="text-[10px] text-text-muted">Slope: {data.slope}</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Promedio histórico</div>
              <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{data.avg_units_history} u/día</div>
            </div>
            <div className="bg-surface border-2 border-emerald-300 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">Predicción {daysAhead}d</div>
              <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{formatNumber(data.predicted_total_period)} unidades</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Modelo</div>
              <div className="text-sm font-extrabold text-text mt-1">Linear + Exp Smoothing</div>
              <div className="text-[10px] text-text-muted">Ensemble promedio</div>
            </div>
          </div>

          {/* Series visualization: barras simples */}
          <div className="bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            <h3 className="text-sm font-bold text-text mb-3">Historia + Forecast — {data.sku}</h3>
            <div className="flex gap-0.5 items-end" style={{ minHeight: 160 }}>
              {[...data.history.map((h: any) => ({ ...h, isForecast: false })), ...data.forecast.map((f: any) => ({ ...f, units: f.units_pred, isForecast: true }))].map((p: any, i: number) => {
                const maxV = Math.max(...data.history.map((h: any) => h.units), ...data.forecast.map((f: any) => f.units_pred), 1);
                const h = (p.units / maxV) * 140;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${p.dia}: ${p.units}u${p.isForecast ? " (forecast)" : ""}`}>
                    <div
                      style={{
                        height: Math.max(2, h),
                        width: "100%",
                        background: p.isForecast ? "rgba(122, 62, 174, 0.6)" : "rgba(122, 62, 174, 1)",
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-text-muted">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "rgba(122,62,174,1)" }} /> Histórico</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "rgba(122,62,174,0.6)" }} /> Forecast</span>
              <span>Total puntos: {data.history.length + data.forecast.length}</span>
            </div>
          </div>
        </>
      ))}
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
