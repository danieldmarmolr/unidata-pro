"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Warehouse, Package, AlertTriangle, Clock, TrendingUp, Image as ImageIcon } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { DashboardHeader } from "@/components/dashboard-header";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { useGlobalFilters, periodToQuery } from "@/lib/store";

type Cell = { area: string; units: number };
type SkuAreaRow = {
  sku: string;
  nombre: string;
  brand: string;
  total: number;
  cells: Cell[];
};
type AreaResp = {
  areas: { name: string; total: number }[];
  skus: SkuAreaRow[];
  max_units: number;
  total_stock: number;
  top_skus_param: number;
  generated_at: string;
};

type BySkuRow = {
  sku: string;
  nombre: string;
  brand: string;
  imagen: string;
  uv: number;
  uv_diaria_avg: number;
  uv_diaria_std: number;
  stock: number;
  precio_avg: number;
  costo_avg: number | null;
  markup: number | null;
  markup_pct: number | null;
  total_markup: number | null;
  tiempo_riesgo_dias: number | null;
  facturacion: number;
  has_cost: boolean;
};
type BySkuResp = {
  period: string;
  days: number;
  rows: BySkuRow[];
  summary: {
    total_facturacion: number;
    total_markup: number;
    total_stock_units: number;
    total_uv: number;
    skus_con_ventas: number;
    skus_sin_stock: number;
    skus_riesgo_alto: number;
    skus_riesgo_medio: number;
    skus_stock_muerto: number;
    skus_con_costo: number;
  };
  generated_at: string;
};

type ViewMode = "by-sku" | "by-area";
type SortKey = keyof BySkuRow | "tiempo_riesgo_dias";

function colorFor(units: number, max: number): string {
  if (!units || units <= 0) return "rgba(148, 163, 184, 0.05)";
  const t = Math.min(1, units / max);
  const alpha = 0.15 + t * 0.7;
  return `rgba(122, 62, 174, ${alpha.toFixed(3)})`;
}

function textColorFor(units: number, max: number): string {
  if (!units || units <= 0) return "var(--text-muted, #94a3b8)";
  const t = units / max;
  return t > 0.45 ? "white" : "var(--text, #1e293b)";
}

function riesgoBadge(dias: number | null): { label: string; cls: string } {
  if (dias === null || dias === undefined) return { label: "—", cls: "text-text-muted" };
  if (dias === 0) return { label: "STOCKOUT", cls: "bg-rose-100 text-rose-800 border-rose-300" };
  if (dias < 7) return { label: `${dias.toFixed(1)}d`, cls: "bg-rose-50 text-rose-700 border-rose-200" };
  if (dias < 14) return { label: `${dias.toFixed(1)}d`, cls: "bg-amber-50 text-amber-700 border-amber-200" };
  if (dias < 30) return { label: `${dias.toFixed(1)}d`, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  return { label: `${dias.toFixed(0)}d`, cls: "bg-soft text-text-muted border-border" };
}

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return formatNumber(v);
}

export default function StockHeatmapPage() {
  const [view, setView] = useState<ViewMode>("by-sku");
  const [topSkus, setTopSkus] = useState(30);
  const [sortKey, setSortKey] = useState<SortKey>("facturacion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "alto" | "medio" | "muerto">("all");

  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);

  const areaQuery = useQuery<AreaResp>({
    queryKey: ["stock-heatmap", topSkus],
    queryFn: () => api(`/api/dashboards/stock-heatmap?top_skus=${topSkus}`),
    staleTime: 60_000,
    enabled: view === "by-area",
  });

  const bySkuQuery = useQuery<BySkuResp>({
    queryKey: ["stock-heatmap-by-sku", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/stock-heatmap/by-sku?${qs}`),
    staleTime: 60_000,
    enabled: view === "by-sku",
  });

  const data = view === "by-sku" ? bySkuQuery.data : areaQuery.data;
  const isFetching = view === "by-sku" ? bySkuQuery.isFetching : areaQuery.isFetching;
  const isLoading = view === "by-sku" ? bySkuQuery.isLoading : areaQuery.isLoading;

  const filteredSorted = useMemo(() => {
    if (view !== "by-sku" || !bySkuQuery.data) return [];
    const term = search.trim().toLowerCase();
    let arr = bySkuQuery.data.rows.filter((r) => {
      if (term && !`${r.sku} ${r.nombre} ${r.brand}`.toLowerCase().includes(term)) return false;
      if (riskFilter === "alto") return r.tiempo_riesgo_dias !== null && r.tiempo_riesgo_dias < 7;
      if (riskFilter === "medio") return r.tiempo_riesgo_dias !== null && r.tiempo_riesgo_dias >= 7 && r.tiempo_riesgo_dias < 14;
      if (riskFilter === "muerto") return r.uv === 0 && r.stock > 0;
      return true;
    });
    arr = [...arr].sort((a, b) => {
      const av = (a[sortKey as keyof BySkuRow] ?? -Infinity) as number;
      const bv = (b[sortKey as keyof BySkuRow] ?? -Infinity) as number;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [view, bySkuQuery.data, search, riskFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  return (
    <>
      <Topbar
        title="Heatmap de Stock"
        subtitle="Por SKU (operativo) y por area de deposito (logistico)"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Stock" />
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "by-sku", label: "Por SKU" },
                  { value: "by-area", label: "Por ubicacion" },
                ]}
              />
              {view === "by-area" && (
                <select
                  value={topSkus}
                  onChange={(e) => setTopSkus(Number(e.target.value))}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
                >
                  <option value={20}>Top 20 SKUs</option>
                  <option value={30}>Top 30 SKUs</option>
                  <option value={50}>Top 50 SKUs</option>
                  <option value={100}>Top 100 SKUs</option>
                </select>
              )}
            </div>
          }
        />

        {view === "by-sku" ? (
          <BySkuView
            data={bySkuQuery.data}
            isLoading={isLoading}
            rows={filteredSorted}
            search={search}
            setSearch={setSearch}
            riskFilter={riskFilter}
            setRiskFilter={setRiskFilter}
            sortKey={sortKey}
            sortDir={sortDir}
            toggleSort={toggleSort}
          />
        ) : (
          <ByAreaView data={areaQuery.data} isLoading={isLoading} />
        )}
      </div>
    </>
  );
}

function BySkuView({
  data, isLoading, rows, search, setSearch, riskFilter, setRiskFilter, sortKey, sortDir, toggleSort,
}: {
  data: BySkuResp | undefined;
  isLoading: boolean;
  rows: BySkuRow[];
  search: string;
  setSearch: (s: string) => void;
  riskFilter: "all" | "alto" | "medio" | "muerto";
  setRiskFilter: (r: "all" | "alto" | "medio" | "muerto") => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  toggleSort: (k: SortKey) => void;
}) {
  const sortIcon = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <KpiBox icon={TrendingUp} label="Facturacion periodo" value={formatCurrency(data?.summary.total_facturacion || 0)} accent="primary" />
        <KpiBox icon={TrendingUp} label="Total markup" value={formatCurrency(data?.summary.total_markup || 0)} accent="emerald" />
        <KpiBox icon={Boxes} label="Stock total" value={formatNumber(data?.summary.total_stock_units || 0)} accent="primary" />
        <KpiBox icon={AlertTriangle} label="Riesgo alto (<7d)" value={formatNumber(data?.summary.skus_riesgo_alto || 0)} accent="rose" />
        <KpiBox icon={Clock} label="Riesgo medio (7-14d)" value={formatNumber(data?.summary.skus_riesgo_medio || 0)} accent="amber" />
        <KpiBox icon={Package} label="Stock muerto" value={formatNumber(data?.summary.skus_stock_muerto || 0)} accent="slate" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar SKU, nombre o marca..."
          className="flex-1 min-w-[200px] px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
        />
        <Segmented<"all" | "alto" | "medio" | "muerto">
          value={riskFilter}
          onChange={setRiskFilter}
          options={[
            { value: "all", label: `Todos (${data?.rows.length ?? 0})` },
            { value: "alto", label: `Riesgo alto (${data?.summary.skus_riesgo_alto ?? 0})` },
            { value: "medio", label: `Riesgo medio (${data?.summary.skus_riesgo_medio ?? 0})` },
            { value: "muerto", label: `Stock muerto (${data?.summary.skus_stock_muerto ?? 0})` },
          ]}
        />
      </div>

      {/* Tabla */}
      {isLoading || !data ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
          Cargando vista por SKU...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
          Sin SKUs que coincidan con los filtros.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-text">Heatmap por SKU al cierre del periodo</h3>
              <p className="text-[11px] text-text-muted">
                {rows.length} SKUs · stock canonico = digip.Stock.unidadesDisponibles · markup neto post-fees post-IVA
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-soft z-10 min-w-[220px]">SKU</th>
                  <Th onClick={() => toggleSort("uv")} active={sortKey === "uv"} dir={sortDir}>U.V.</Th>
                  <Th onClick={() => toggleSort("uv_diaria_avg")} active={sortKey === "uv_diaria_avg"} dir={sortDir}>Prom UV diaria</Th>
                  <Th onClick={() => toggleSort("uv_diaria_std")} active={sortKey === "uv_diaria_std"} dir={sortDir}>Desv Std diaria</Th>
                  <Th onClick={() => toggleSort("stock")} active={sortKey === "stock"} dir={sortDir}>Stock</Th>
                  <Th onClick={() => toggleSort("precio_avg")} active={sortKey === "precio_avg"} dir={sortDir}>Precio</Th>
                  <Th onClick={() => toggleSort("costo_avg")} active={sortKey === "costo_avg"} dir={sortDir}>Costo</Th>
                  <Th onClick={() => toggleSort("markup")} active={sortKey === "markup"} dir={sortDir}>Markup</Th>
                  <Th onClick={() => toggleSort("markup_pct")} active={sortKey === "markup_pct"} dir={sortDir}>Markup %</Th>
                  <Th onClick={() => toggleSort("total_markup")} active={sortKey === "total_markup"} dir={sortDir}>Total Markup</Th>
                  <Th onClick={() => toggleSort("tiempo_riesgo_dias")} active={sortKey === "tiempo_riesgo_dias"} dir={sortDir}>Tiempo Riesgo</Th>
                  <Th onClick={() => toggleSort("facturacion")} active={sortKey === "facturacion"} dir={sortDir}>Facturacion</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ries = riesgoBadge(r.tiempo_riesgo_dias);
                  return (
                    <tr key={r.sku} className="border-t border-border hover:bg-soft/30">
                      <td className="px-3 py-2 sticky left-0 bg-surface z-10">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.imagen ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imagen} alt="" className="w-8 h-8 rounded object-cover border border-border shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-soft flex items-center justify-center shrink-0">
                              <ImageIcon size={12} className="text-text-muted" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                              className="text-primary hover:underline font-medium block truncate max-w-[200px]"
                              title={r.nombre}
                            >
                              {r.nombre}
                            </Link>
                            <div className="text-[10px] text-text-muted truncate max-w-[200px]">
                              {r.sku}{r.brand ? ` · ${r.brand}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.uv)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.uv_diaria_avg.toFixed(1)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-text-muted">{r.uv_diaria_std.toFixed(1)}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-bold", r.stock === 0 ? "text-rose-700" : r.stock <= 5 ? "text-amber-700" : "text-text")}>
                        {formatNumber(r.stock)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.precio_avg > 0 ? formatCurrency(r.precio_avg) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-text-muted">{r.costo_avg !== null ? formatCurrency(r.costo_avg) : "—"}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-medium", r.markup !== null && r.markup < 0 ? "text-rose-700" : "")}>
                        {r.markup !== null ? formatCurrency(r.markup) : "—"}
                      </td>
                      <td className={cn("px-2 py-2 text-right tabular-nums", r.markup_pct !== null && r.markup_pct < 15 ? "text-rose-700" : r.markup_pct !== null && r.markup_pct < 30 ? "text-amber-700" : r.markup_pct !== null ? "text-emerald-700" : "")}>
                        {r.markup_pct !== null ? `${r.markup_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold">
                        {r.total_markup !== null ? fmtShort(r.total_markup) : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={cn("inline-flex items-center justify-center text-[10px] font-bold border rounded-full px-2 py-0.5", ries.cls)}>
                          {ries.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">
                        {r.facturacion > 0 ? formatCurrency(r.facturacion) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "text-right px-2 py-2 cursor-pointer select-none transition",
        active ? "text-primary" : "hover:text-primary",
      )}
    >
      {children}
      {active && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function ByAreaView({ data, isLoading }: { data: AreaResp | undefined; isLoading: boolean }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <KpiBox icon={Boxes} label="Stock total" value={formatNumber(data?.total_stock || 0)} accent="primary" />
        <KpiBox icon={Warehouse} label="Areas activas" value={formatNumber(data?.areas?.length || 0)} accent="emerald" />
        <KpiBox icon={Package} label="SKUs en grilla" value={formatNumber(data?.skus?.length || 0)} accent="amber" />
      </div>

      {isLoading || !data ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
          Cargando heatmap...
        </div>
      ) : data.skus.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
          Sin datos de stock disponibles.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-text">SKU × Area</h3>
              <p className="text-[11px] text-text-muted">
                Distribucion fisica desde digip.StockDetalle (incluye reservado/bloqueado). Color violeta proporcional a unidades en area.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-soft z-10 min-w-[200px] uppercase tracking-wider text-[10px]">SKU</th>
                  <th className="text-right px-2 py-2 uppercase tracking-wider text-[10px]">Total</th>
                  {data.areas.map((a) => (
                    <th
                      key={a.name}
                      className="text-center px-2 py-2 uppercase tracking-wider text-[10px] min-w-[80px]"
                      title={`${a.name} - total ${formatNumber(a.total)}`}
                    >
                      <div className="truncate max-w-[100px] mx-auto" title={a.name}>{a.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.skus.map((s) => (
                  <tr key={s.sku} className="border-t border-border hover:bg-soft/30">
                    <td className="px-3 py-2 sticky left-0 bg-surface z-10">
                      <Link
                        href={`/dashboard/productos/${encodeURIComponent(s.sku)}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {s.nombre}
                      </Link>
                      <div className="text-[10px] text-text-muted truncate max-w-[200px]">
                        {s.sku}{s.brand ? ` · ${s.brand}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">
                      {formatNumber(s.total)}
                    </td>
                    {s.cells.map((c, i) => (
                      <td
                        key={i}
                        className="text-center px-1 py-1 tabular-nums"
                        style={{
                          background: colorFor(c.units, data.max_units),
                          color: textColorFor(c.units, data.max_units),
                        }}
                        title={`${s.sku} · ${c.area}: ${formatNumber(c.units)} u`}
                      >
                        {c.units > 0 ? formatNumber(c.units) : "·"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function KpiBox({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: "primary" | "emerald" | "amber" | "rose" | "slate" }) {
  const accentClasses: Record<string, string> = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-pink-500",
    slate: "from-slate-400 to-slate-600",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="flex items-start justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${accentClasses[accent]} text-white flex items-center justify-center shadow-md shrink-0`}>
          <Icon size={12} />
        </div>
      </div>
      <div className="text-lg font-extrabold text-text tabular-nums">{value}</div>
    </div>
  );
}
