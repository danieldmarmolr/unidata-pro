"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Info, ArrowUp, ArrowDown, ImageOff, Table, LineChart, Activity, Network } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DashboardHeader } from "@/components/dashboard-header";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ElasticityView } from "./_components/ElasticityView";
import { PriceStepsView } from "./_components/PriceStepsView";
import { SkuEquivalenceView } from "./_components/SkuEquivalenceView";

type Tab = "tabla" | "elasticidad" | "cambios-precio" | "mapeo-sku";

type CanalUTN = { units: number; revenue: number; price_avg: number };
type CanalDRP = {
  units: number;
  revenue_retail: number;
  price_retail_avg: number;
  revenue_mayorista: number;
  cost_avg: number;
};

type SkuRow = {
  sku: string;
  name: string;
  ean: string;
  imagen: string;
  units_total: number;
  units_unistore: number;
  units_unidrop: number;
  share_unistore_pct: number;
  share_unidrop_pct: number;
  unistore_tn: CanalUTN;
  unistore_ml: CanalUTN;
  unidrop_tn: CanalDRP;
  unidrop_ml: CanalDRP;
  costo_importacion: number | null;
  costo_importacion_sin_iva: number | null;
  precio_retail_unistore_avg: number;
  precio_retail_unidrop_avg: number;
  precio_mayorista_avg: number;
  markup_retail_unistore_pct: number | null;
  markup_mayorista_pct: number | null;
  markup_drp_pct: number | null;
  margen_retail_unistore_pct: number | null;
  margen_drp_pct: number | null;
  spread_retail_pct: number | null;
  ganancia_retail_unistore: number | null;
  ganancia_mayorista_unistore: number | null;
  ganancia_total_unistore: number | null;
  revenue_unistore_retail: number;
  revenue_unidrop_retail: number;
  revenue_total_grupo: number;
};

type GlossaryEntry = { key: string; label: string; desc: string };

type OmnicanalResp = {
  period: string;
  days: number;
  skus: SkuRow[];
  summary: {
    total_skus: number;
    skus_con_cost_idx: number;
    skus_con_dato_mayorista: number;
    total_units: number;
    total_units_unistore: number;
    total_units_unidrop: number;
    revenue_unistore_retail_total: number;
    revenue_unidrop_retail_total: number;
    ganancia_retail_unistore_total: number;
    ganancia_mayorista_unistore_total: number;
    ganancia_total_unistore: number;
    margen_drp_avg_pct: number;
    markup_mayorista_avg_pct: number;
    spread_retail_avg_pct: number;
  };
  generated_at: string;
  column_glossary: GlossaryEntry[];
  todo: string[];
};

type SortKey =
  | "units_total" | "revenue_total_grupo"
  | "share_unistore_pct" | "share_unidrop_pct"
  | "costo_importacion" | "precio_retail_unistore_avg" | "precio_retail_unidrop_avg" | "precio_mayorista_avg"
  | "markup_retail_unistore_pct" | "markup_mayorista_pct" | "markup_drp_pct"
  | "margen_retail_unistore_pct" | "margen_drp_pct" | "spread_retail_pct"
  | "ganancia_retail_unistore" | "ganancia_mayorista_unistore" | "ganancia_total_unistore";

type Filter =
  | "all" | "con-cost" | "sin-cost" | "con-mayorista" | "sin-mayorista"
  | "solo-unistore" | "solo-unidrop" | "ambos"
  | "uni-dominante" | "drp-dominante"
  | "margen-drp-alto" | "margen-drp-bajo"
  | "spread-positivo" | "spread-negativo";

export default function OmnicanalPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const [tab, setTab] = useState<Tab>("tabla");

  const { data, isFetching, error } = useQuery<OmnicanalResp>({
    queryKey: ["products-omnicanal", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/products/omnicanal-table?${_qs}`),
    staleTime: 60_000,
    enabled: tab === "tabla",
  });

  const glossaryMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of data?.column_glossary ?? []) m[g.key] = g.desc;
    return m;
  }, [data]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("units_total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(150);

  const filtered = useMemo(() => {
    let rows = data?.skus ?? [];
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter(
        (r) => r.sku?.toLowerCase().includes(s) || r.name?.toLowerCase().includes(s) || r.ean?.toLowerCase().includes(s),
      );
    }
    switch (filter) {
      case "con-cost": rows = rows.filter((r) => r.costo_importacion !== null); break;
      case "sin-cost": rows = rows.filter((r) => r.costo_importacion === null); break;
      case "con-mayorista": rows = rows.filter((r) => r.precio_mayorista_avg > 0); break;
      case "sin-mayorista": rows = rows.filter((r) => r.precio_mayorista_avg === 0); break;
      case "solo-unistore": rows = rows.filter((r) => r.units_unidrop === 0); break;
      case "solo-unidrop": rows = rows.filter((r) => r.units_unistore === 0); break;
      case "ambos": rows = rows.filter((r) => r.units_unistore > 0 && r.units_unidrop > 0); break;
      case "uni-dominante": rows = rows.filter((r) => r.share_unistore_pct >= 70); break;
      case "drp-dominante": rows = rows.filter((r) => r.share_unidrop_pct >= 70); break;
      case "margen-drp-alto": rows = rows.filter((r) => (r.margen_drp_pct ?? 0) >= 30); break;
      case "margen-drp-bajo": rows = rows.filter((r) => r.margen_drp_pct !== null && r.margen_drp_pct < 10); break;
      case "spread-positivo": rows = rows.filter((r) => (r.spread_retail_pct ?? 0) > 0); break;
      case "spread-negativo": rows = rows.filter((r) => r.spread_retail_pct !== null && r.spread_retail_pct < 0); break;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = (a[sortKey] ?? 0) as number;
      const vb = (b[sortKey] ?? 0) as number;
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [data?.skus, search, filter, sortKey, sortDir]);

  const visible = filtered.slice(0, limit);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const FILTER_CHIPS: Array<{ value: Filter; label: string; count?: number }> = useMemo(() => {
    const sk = data?.skus ?? [];
    return [
      { value: "all", label: "Todos", count: sk.length },
      { value: "ambos", label: "Vendidos en ambos", count: sk.filter((r) => r.units_unistore > 0 && r.units_unidrop > 0).length },
      { value: "solo-unistore", label: "Solo Unistore", count: sk.filter((r) => r.units_unidrop === 0).length },
      { value: "solo-unidrop", label: "Solo Unidrop", count: sk.filter((r) => r.units_unistore === 0).length },
      { value: "uni-dominante", label: "Dominante Unistore (≥70%)", count: sk.filter((r) => r.share_unistore_pct >= 70).length },
      { value: "drp-dominante", label: "Dominante Unidrop (≥70%)", count: sk.filter((r) => r.share_unidrop_pct >= 70).length },
      { value: "con-cost", label: "Con costo importacion", count: sk.filter((r) => r.costo_importacion !== null).length },
      { value: "con-mayorista", label: "Con dato mayorista", count: sk.filter((r) => r.precio_mayorista_avg > 0).length },
      { value: "margen-drp-alto", label: "Margen DRP ≥30%", count: sk.filter((r) => (r.margen_drp_pct ?? 0) >= 30).length },
      { value: "margen-drp-bajo", label: "Margen DRP <10%", count: sk.filter((r) => r.margen_drp_pct !== null && r.margen_drp_pct < 10).length },
      { value: "spread-positivo", label: "Spread > 0 (DRP mas caro)", count: sk.filter((r) => (r.spread_retail_pct ?? 0) > 0).length },
    ];
  }, [data?.skus]);

  const Hdr = ({ k, label, align = "right", tooltipKey }: { k: SortKey; label: string; align?: "left" | "right" | "center"; tooltipKey?: string }) => {
    const desc = tooltipKey ? glossaryMap[tooltipKey] : undefined;
    return (
      <th
        onClick={() => onSort(k)}
        className={`px-2 py-2 cursor-pointer select-none hover:bg-soft/80 whitespace-nowrap ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
        title={desc}
      >
        <div className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : ""}`}>
          {label}
          {desc && <Info size={9} className="text-text-muted/50" />}
          {sortKey === k && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
        </div>
      </th>
    );
  };

  return (
    <>
      <Topbar
        title="Producto · Omnicanal mayorista"
        subtitle="Precio + costo + markup + margen + ganancia por SKU en los 4 canales · respeta selector global de periodo"
      />

      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader filters={<></>} generatedAt={data?.generated_at} isFetching={isFetching} />

        {/* Tab nav */}
        <div className="flex flex-wrap gap-1 mb-4 bg-surface border border-border rounded-xl p-1.5">
          <TabButton active={tab === "tabla"} onClick={() => setTab("tabla")} icon={Table} label="Tabla SKU cross-canal" />
          <TabButton active={tab === "elasticidad"} onClick={() => setTab("elasticidad")} icon={LineChart} label="Elasticidad retail vs mayorista" />
          <TabButton active={tab === "cambios-precio"} onClick={() => setTab("cambios-precio")} icon={Activity} label="Cambios de precio mayorista" />
          <TabButton active={tab === "mapeo-sku"} onClick={() => setTab("mapeo-sku")} icon={Network} label="Mapeo SKU cross-canal" />
        </div>

        {tab !== "tabla" && (
          tab === "elasticidad" ? <ElasticityView />
          : tab === "cambios-precio" ? <PriceStepsView />
          : <SkuEquivalenceView />
        )}

        {tab === "tabla" && <>

        {/* Banner explicativo */}
        <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Info size={16} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-violet-900">
            <strong>Que es:</strong> Una fila por SKU activo en el periodo seleccionado.
            Cruza los 4 canales del grupo (Unistore TN/ML, Unidrop TN/ML) con el costo de importacion
            de Unistore para calcular markup y margen en cada punto. Unidrop expone <code>unitCost</code>
            (ML) y <code>cost</code> (TN) que es el precio mayorista que el dropshipper paga a Unistore.
            <br />
            <strong>Como usarlo:</strong> Sort por <em>margen DRP</em> para identificar SKUs donde el
            dropshipper saca mucho (Unistore podria subir PVP mayorista) o poco (riesgo de churn).
            Sort por <em>ganancia total Unistore</em> para ver los SKUs estrella del grupo.
            Sort por <em>spread retail</em> para detectar arbitraje cross-canal.
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm mb-4">
            Error: {(error as Error).message}
          </div>
        )}

        {/* KPIs superiores cross-canal */}
        {data?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            <KpiBox label="SKUs activos" value={formatNumber(data.summary.total_skus)} hint={`${data.summary.skus_con_dato_mayorista} con dato mayorista`} />
            <KpiBox label="Unidades total" value={formatNumber(data.summary.total_units)} hint={`${data.summary.total_units_unistore} Uni / ${data.summary.total_units_unidrop} Drp`} />
            <KpiBox label="Revenue Unistore retail" value={formatCurrency(data.summary.revenue_unistore_retail_total)} hint="TN + ML propios" color="violet" />
            <KpiBox label="Ganancia mayorista" value={formatCurrency(data.summary.ganancia_mayorista_unistore_total)} hint="Lo que Unistore cobro a Unidrop" color="emerald" />
            <KpiBox label="Ganancia total Unistore" value={formatCurrency(data.summary.ganancia_total_unistore)} hint="Retail + Mayorista en el periodo" color="amber" />
            <KpiBox label="Margen DRP promedio" value={`${data.summary.margen_drp_avg_pct}%`} hint={`spread retail prom ${data.summary.spread_retail_avg_pct}%`} />
          </div>
        )}

        {/* Tabla */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-text">Tabla omnicanal por SKU</h3>
                <p className="text-[11px] text-text-muted">
                  {formatNumber(filtered.length)} SKUs · respeta el selector global de periodo (HOY / AYER / 7d / 30d / 90d / 12m / Personalizado) · click columna para sort · hover columna para definicion
                </p>
              </div>
              {data && (
                <ExportButtons
                  filename={`omnicanal_${period}`}
                  columns={[
                    "SKU", "Nombre", "EAN", "Unidades total", "Unidades Unistore", "Unidades Unidrop",
                    "% Unistore", "% Unidrop",
                    "Precio Uni TN", "Unid Uni TN", "Precio Uni ML", "Unid Uni ML",
                    "Precio Drp TN", "Unid Drp TN", "Cost Drp TN",
                    "Precio Drp ML", "Unid Drp ML", "Cost Drp ML",
                    "Costo importacion",
                    "Precio retail Unistore avg", "Precio retail Unidrop avg", "Precio mayorista avg",
                    "Markup retail Uni %", "Markup mayorista %", "Markup DRP %",
                    "Margen retail Uni %", "Margen DRP %", "Spread retail %",
                    "Ganancia retail Uni", "Ganancia mayorista Uni", "Ganancia total Uni",
                    "Revenue retail Uni", "Revenue retail Drp", "Revenue total grupo",
                  ]}
                  rows={filtered.map((r) => [
                    r.sku, r.name, r.ean, r.units_total, r.units_unistore, r.units_unidrop,
                    r.share_unistore_pct, r.share_unidrop_pct,
                    r.unistore_tn.price_avg, r.unistore_tn.units, r.unistore_ml.price_avg, r.unistore_ml.units,
                    r.unidrop_tn.price_retail_avg, r.unidrop_tn.units, r.unidrop_tn.cost_avg,
                    r.unidrop_ml.price_retail_avg, r.unidrop_ml.units, r.unidrop_ml.cost_avg,
                    r.costo_importacion ?? "",
                    r.precio_retail_unistore_avg, r.precio_retail_unidrop_avg, r.precio_mayorista_avg,
                    r.markup_retail_unistore_pct ?? "", r.markup_mayorista_pct ?? "", r.markup_drp_pct ?? "",
                    r.margen_retail_unistore_pct ?? "", r.margen_drp_pct ?? "", r.spread_retail_pct ?? "",
                    r.ganancia_retail_unistore ?? "", r.ganancia_mayorista_unistore ?? "", r.ganancia_total_unistore ?? "",
                    r.revenue_unistore_retail, r.revenue_unidrop_retail, r.revenue_total_grupo,
                  ])}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar SKU, nombre o EAN…"
                className="px-3 py-1.5 text-xs border border-border rounded-lg w-[260px] focus:outline-none focus:border-primary"
              />
              {FILTER_CHIPS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={
                    "px-2.5 py-1 text-[11px] rounded-md transition border " +
                    (filter === f.value
                      ? "bg-primary text-white border-primary"
                      : "bg-soft text-text-muted border-transparent hover:border-primary/40")
                  }
                >
                  {f.label}
                  {typeof f.count === "number" && <span className="ml-1 opacity-70">({f.count})</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[720px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="text-left px-2 py-2">SKU / Producto</th>
                  <Hdr k="units_total" label="Unid total" tooltipKey="units_total" />
                  <Hdr k="share_unistore_pct" label="% Unistore" tooltipKey="share_uni_drp" />
                  <Hdr k="share_unidrop_pct" label="% Unidrop" tooltipKey="share_uni_drp" />
                  <Hdr k="costo_importacion" label="Costo imp." tooltipKey="costo_importacion" />
                  <Hdr k="precio_retail_unistore_avg" label="Prec retail Uni" tooltipKey="precio_retail_unistore_avg" />
                  <Hdr k="precio_retail_unidrop_avg" label="Prec retail Drp" tooltipKey="precio_retail_unidrop_avg" />
                  <Hdr k="precio_mayorista_avg" label="Prec mayorista" tooltipKey="precio_mayorista_avg" />
                  <Hdr k="markup_retail_unistore_pct" label="MK retail Uni" tooltipKey="markup_retail_unistore_pct" />
                  <Hdr k="markup_mayorista_pct" label="MK mayorista" tooltipKey="markup_mayorista_pct" />
                  <Hdr k="markup_drp_pct" label="MK DRP" tooltipKey="markup_drp_pct" />
                  <Hdr k="margen_retail_unistore_pct" label="Mrgn retail Uni" tooltipKey="margen_retail_unistore_pct" />
                  <Hdr k="margen_drp_pct" label="Mrgn DRP" tooltipKey="margen_drp_pct" />
                  <Hdr k="spread_retail_pct" label="Spread retail" tooltipKey="spread_retail_pct" />
                  <Hdr k="ganancia_retail_unistore" label="Gan retail Uni" tooltipKey="ganancia_retail_unistore" />
                  <Hdr k="ganancia_mayorista_unistore" label="Gan mayor Uni" tooltipKey="ganancia_mayorista_unistore" />
                  <Hdr k="ganancia_total_unistore" label="Gan total Uni" tooltipKey="ganancia_total_unistore" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.sku} className="border-t border-border hover:bg-soft/40">
                    <td className="px-2 py-1.5 min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                          {r.imagen ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imagen} alt={r.name} className="w-full h-full object-cover" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <ImageOff size={12} className="text-text-muted/40" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                            className="text-primary hover:underline font-medium block truncate max-w-[240px]">
                            {r.name}
                          </Link>
                          <div className="text-[9px] text-text-muted/70 font-mono truncate max-w-[240px]">
                            {r.sku}{r.ean ? ` · EAN ${r.ean}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold">{formatNumber(r.units_total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap bg-violet-50/40">
                      <span className="text-violet-700 font-semibold">{r.share_unistore_pct}%</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap bg-amber-50/40">
                      <span className="text-amber-700 font-semibold">{r.share_unidrop_pct}%</span>
                    </td>
                    <Cell value={r.costo_importacion} kind="currency" />
                    <Cell value={r.precio_retail_unistore_avg} kind="currency" bgClass="bg-violet-50/40" />
                    <Cell value={r.precio_retail_unidrop_avg} kind="currency" bgClass="bg-amber-50/40" />
                    <Cell value={r.precio_mayorista_avg} kind="currency" bgClass="bg-emerald-50/40" bold />
                    <Cell value={r.markup_retail_unistore_pct} kind="pct" />
                    <Cell value={r.markup_mayorista_pct} kind="pct" bold />
                    <Cell value={r.markup_drp_pct} kind="pct" />
                    <Cell value={r.margen_retail_unistore_pct} kind="pct" tone="auto" />
                    <Cell value={r.margen_drp_pct} kind="pct" tone="margenDrp" />
                    <Cell value={r.spread_retail_pct} kind="pct" tone="signed" />
                    <Cell value={r.ganancia_retail_unistore} kind="currency" tone="positiveOnly" />
                    <Cell value={r.ganancia_mayorista_unistore} kind="currency" tone="positiveOnly" />
                    <Cell value={r.ganancia_total_unistore} kind="currency" bold tone="positiveOnly" />
                  </tr>
                ))}
                {filtered.length === 0 && !isFetching && (
                  <tr><td colSpan={17} className="text-center py-12 text-text-muted">Sin SKUs que coincidan con los filtros</td></tr>
                )}
                {!data && isFetching && (
                  <tr><td colSpan={17} className="text-center py-12 text-text-muted">Cargando dataset omnicanal…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > limit && (
            <div className="px-4 py-2 border-t border-border bg-soft/40 text-center">
              <button onClick={() => setLimit(limit + 200)} className="text-xs text-primary hover:underline font-semibold">
                Ver más ({filtered.length - limit} restantes) →
              </button>
            </div>
          )}
        </div>

        {/* Glosario de columnas */}
        {data?.column_glossary && (
          <details className="mt-4 bg-surface border border-border rounded-xl">
            <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-text hover:bg-soft/40">
              📖 Diccionario de columnas — qué significa cada métrica
            </summary>
            <div className="px-4 py-3 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {data.column_glossary.map((g) => (
                <div key={g.key} className="bg-soft/40 rounded-lg p-3">
                  <div className="font-bold text-text mb-1">{g.label}</div>
                  <div className="text-text-muted leading-relaxed">{g.desc}</div>
                </div>
              ))}
            </div>
          </details>
        )}
        </>}
      </div>
    </>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition " +
        (active
          ? "bg-primary text-white shadow"
          : "text-text-muted hover:bg-soft/60 hover:text-text")
      }
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function KpiBox({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: "violet" | "emerald" | "amber" }) {
  const accent = color === "violet" ? "border-violet-300 bg-violet-50/40"
    : color === "emerald" ? "border-emerald-300 bg-emerald-50/40"
    : color === "amber" ? "border-amber-300 bg-amber-50/40"
    : "border-border";
  return (
    <div className={`bg-surface border ${accent} rounded-xl p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

type CellTone = "auto" | "signed" | "margenDrp" | "positiveOnly" | undefined;

function Cell({
  value,
  kind,
  bgClass,
  bold,
  tone,
}: {
  value: number | null | undefined;
  kind: "currency" | "pct";
  bgClass?: string;
  bold?: boolean;
  tone?: CellTone;
}) {
  if (value === null || value === undefined || (kind === "currency" && value === 0) ) {
    return <td className={`px-2 py-1.5 text-right tabular-nums text-text-muted/40 ${bgClass ?? ""}`}>—</td>;
  }
  const display = kind === "currency"
    ? formatCurrency(value)
    : `${value >= 0 && tone === "signed" ? "+" : ""}${value}%`;
  let toneClass = "";
  if (tone === "signed") toneClass = value >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold";
  else if (tone === "margenDrp") toneClass = value >= 30 ? "text-emerald-700 font-bold" : value >= 10 ? "text-amber-700 font-bold" : "text-rose-700 font-bold";
  else if (tone === "auto") toneClass = value >= 20 ? "text-emerald-700 font-bold" : value >= 0 ? "text-amber-700" : "text-rose-700 font-bold";
  else if (tone === "positiveOnly") toneClass = "text-emerald-700 font-bold";
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${bgClass ?? ""} ${bold ? "font-bold" : ""} ${toneClass}`}>
      {display}
    </td>
  );
}
