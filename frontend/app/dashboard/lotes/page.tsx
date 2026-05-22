"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  Truck,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Clock,
  DollarSign,
  Percent,
  ShoppingBag,
  X,
  Search,
  ChevronRight,
  Filter,
  Boxes,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { DashboardHeader } from "@/components/dashboard-header";
import { SkuRow } from "@/components/sku-row";
import { api } from "@/lib/api";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";
import { formatCurrency, formatNumber } from "@/lib/utils";

// ============================================================
// Types
// ============================================================

type Estado = "agotado" | "saludable" | "lento" | "stuck" | "nuevo" | "sin_fecha";

type LoteSummary = {
  lote_id: number;
  lote: string;
  proveedor: string | null;
  fecha_ingreso: string | null;
  origen: string | null;
  envio: string | null;
  moneda: string | null;
  imported_at: string;
  skus_count: number;
  u_compradas: number;
  u_vendidas: number;
  consumo_lote_pct: number;
  total_costo_ars: number;
  total_facturacion_ars: number;
  markup_total_ars: number;
  markup_pct: number;
  cobertura_pago_pct: number;
  estado: Estado;
};

type LotesResponse = {
  totals: {
    u_compradas: number;
    u_vendidas: number;
    total_costo_ars: number;
    total_facturacion_ars: number;
    markup_total_ars: number;
    markup_pct: number;
    consumo_lote_pct: number;
    cobertura_pago_pct: number;
    lotes_count: number;
    skus_count: number;
  };
  lotes: LoteSummary[];
  filters_available: {
    proveedores: string[];
    origenes: string[];
    lotes: { lote: string; fecha_ingreso: string | null }[];
  };
  generated_at: string;
};

type LoteItemDetail = {
  sku: string;
  producto: string | null;
  categoria: string | null;
  u_comprada: number;
  precio_unit_ars: number;
  costo_unit_ars: number;
  markup_unit_ars: number;
  markup_pct: number;
  stock_inicial: number;
  stock_actual: number;
  u_vendida: number;
  consumo_pct: number;
  total_costo_item: number;
  total_facturacion_item: number;
  markup_real_item: number;
  first_sale: string | null;
  last_sale: string | null;
};

type LoteDetail = LoteSummary & {
  items: LoteItemDetail[];
};

// ============================================================
// Constantes visuales
// ============================================================

const ESTADO_COLOR: Record<Estado, { bg: string; text: string; border: string; label: string; icon: any }> = {
  saludable: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Saludable", icon: CheckCircle2 },
  lento: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Lento", icon: TrendingDown },
  stuck: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "Atascado", icon: AlertCircle },
  agotado: { bg: "bg-zinc-100", text: "text-zinc-700", border: "border-zinc-200", label: "Agotado", icon: Package },
  nuevo: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", label: "Nuevo", icon: Sparkles },
  sin_fecha: { bg: "bg-zinc-50", text: "text-zinc-500", border: "border-zinc-200", label: "Sin fecha", icon: Clock },
};

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function fmtDateAR(iso: string | null) {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
// Componentes auxiliares
// ============================================================

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = "primary",
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "emerald" | "amber" | "blue" | "rose";
}) {
  const accentClasses = {
    primary: "from-primary to-accent shadow-primary/30",
    emerald: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
    amber: "from-amber-500 to-orange-500 shadow-amber-500/30",
    blue: "from-blue-500 to-cyan-500 shadow-blue-500/30",
    rose: "from-rose-500 to-pink-500 shadow-rose-500/30",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:shadow-lg hover:border-primary/30 transition group">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accentClasses[accent]} text-white flex items-center justify-center shadow-md group-hover:scale-110 transition`}>
          <Icon size={14} />
        </div>
      </div>
      <div className="text-xl font-extrabold text-text tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const cfg = ESTADO_COLOR[estado];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${cfg.bg} ${cfg.text} border ${cfg.border} rounded`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

function ConsumoBar({ pct, estado }: { pct: number; estado: Estado }) {
  const fillColor =
    estado === "agotado" ? "bg-zinc-400" :
    estado === "saludable" ? "bg-gradient-to-r from-emerald-400 to-emerald-500" :
    estado === "lento" ? "bg-gradient-to-r from-amber-400 to-amber-500" :
    estado === "stuck" ? "bg-gradient-to-r from-rose-400 to-rose-500" :
    "bg-gradient-to-r from-primary to-accent";

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-soft rounded-full overflow-hidden">
        <div
          className={`h-full ${fillColor} transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs font-bold text-text tabular-nums whitespace-nowrap">{fmtPct(pct)}</span>
    </div>
  );
}

// ============================================================
// Modal de detalle de lote
// ============================================================

function LoteDetailModal({ loteId, onClose }: { loteId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<LoteDetail>({
    queryKey: ["lote-detail", loteId],
    queryFn: () => api(`/api/dashboards/lotes/${loteId}/detail`),
  });

  const skus = useMemo(() => (data?.items ?? []).map((i) => i.sku).filter(Boolean), [data]);
  const enriched = useSkuEnrichment("unistore", skus);

  // Items ordenados por velocidad (consumo_pct desc) — top performers arriba
  const itemsSorted = useMemo(() => {
    if (!data?.items) return [];
    return [...data.items].sort((a, b) => b.consumo_pct - a.consumo_pct);
  }, [data]);

  const topPerformers = itemsSorted.slice(0, 5);
  const underperformers = useMemo(() => {
    if (!data?.items) return [];
    return [...data.items]
      .filter((i) => i.u_vendida === 0 || i.consumo_pct < 5)
      .slice(0, 5);
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-6xl my-2 sm:my-8 overflow-hidden"
      >
        {/* Header con gradiente */}
        <div className="bg-gradient-to-br from-primary via-accent to-fuchsia-600 p-4 sm:p-6 text-white relative">
          <button onClick={onClose} className="absolute top-3 right-3 sm:top-4 sm:right-4 text-white/70 hover:text-white p-1">
            <X size={20} />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
              <Boxes size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">Detalle del lote</div>
              <h2 className="text-lg sm:text-2xl font-extrabold truncate">{data?.lote ?? "..."}</h2>
            </div>
          </div>
          {data && (
            <div className="flex flex-wrap gap-2 text-xs">
              {data.proveedor && (
                <span className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  📦 {data.proveedor}
                </span>
              )}
              {data.origen && (
                <span className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  🌐 {data.origen}
                </span>
              )}
              {data.envio && (
                <span className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  🚢 {data.envio}
                </span>
              )}
              {data.fecha_ingreso && (
                <span className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  📅 {fmtDateAR(data.fecha_ingreso)} · hace {daysSince(data.fecha_ingreso)} días
                </span>
              )}
            </div>
          )}
        </div>

        <div className="p-3 sm:p-6">
          {isLoading || !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-20 bg-soft rounded-xl animate-pulse" />
                ))}
              </div>
              <div className="h-64 bg-soft rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {/* KPIs del lote */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  icon={Package}
                  label="Unidades compradas"
                  value={formatNumber(data.u_compradas)}
                  hint={`${data.skus_count} SKUs`}
                  accent="blue"
                />
                <KpiCard
                  icon={ShoppingBag}
                  label="Unidades vendidas"
                  value={formatNumber(data.u_vendidas)}
                  hint={`${fmtPct(data.consumo_lote_pct)} consumido`}
                  accent="emerald"
                />
                <KpiCard
                  icon={DollarSign}
                  label="Total costo"
                  value={formatCurrency(data.total_costo_ars)}
                  accent="amber"
                />
                <KpiCard
                  icon={TrendingUp}
                  label="Facturación generada"
                  value={formatCurrency(data.total_facturacion_ars)}
                  hint={`${fmtPct(data.cobertura_pago_pct)} cobertura`}
                  accent="primary"
                />
                <KpiCard
                  icon={Percent}
                  label="Markup %"
                  value={fmtPct(data.markup_pct)}
                  accent="rose"
                />
                <KpiCard
                  icon={Sparkles}
                  label="Markup total"
                  value={formatCurrency(data.markup_total_ars)}
                  hint="Realizado por ventas"
                  accent="primary"
                />
                <KpiCard
                  icon={Boxes}
                  label="Stock actual estimado"
                  value={formatNumber(data.u_compradas - data.u_vendidas)}
                  hint="U.C. - U.V."
                  accent="blue"
                />
                <KpiCard
                  icon={Clock}
                  label="Estado"
                  value={ESTADO_COLOR[data.estado].label}
                  accent={data.estado === "saludable" ? "emerald" : data.estado === "stuck" ? "rose" : "amber"}
                />
              </div>

              {/* Top performers + underperformers */}
              {(topPerformers.length > 0 || underperformers.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {topPerformers.length > 0 && (
                    <div className="bg-emerald-50/50 border border-emerald-200/60 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp size={14} className="text-emerald-600" />
                        <h3 className="text-sm font-bold text-emerald-900">Top performers del lote</h3>
                      </div>
                      <div className="divide-y divide-emerald-200/40">
                        {topPerformers.map((it, i) => (
                          <SkuRow
                            key={it.sku}
                            index={i + 1}
                            sku={it.sku}
                            name={it.producto || it.sku}
                            rightValue={
                              <div className="text-right">
                                <div className="text-xs font-bold text-emerald-700">{fmtPct(it.consumo_pct)}</div>
                                <div className="text-[10px] text-text-muted">{it.u_vendida} ud</div>
                              </div>
                            }
                            enrichment={enriched.data?.[it.sku]}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {underperformers.length > 0 && (
                    <div className="bg-rose-50/50 border border-rose-200/60 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertCircle size={14} className="text-rose-600" />
                        <h3 className="text-sm font-bold text-rose-900">Sin movimiento o lentos</h3>
                      </div>
                      <div className="divide-y divide-rose-200/40">
                        {underperformers.map((it, i) => (
                          <SkuRow
                            key={it.sku}
                            index={i + 1}
                            sku={it.sku}
                            name={it.producto || it.sku}
                            rightValue={
                              <div className="text-right">
                                <div className="text-xs font-bold text-rose-700">{fmtPct(it.consumo_pct)}</div>
                                <div className="text-[10px] text-text-muted">{it.u_vendida} ud</div>
                              </div>
                            }
                            enrichment={enriched.data?.[it.sku]}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tabla completa de items */}
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-bold text-text">Análisis SKU por SKU</h3>
                  <div className="text-xs text-text-muted">{data.items.length} items</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-soft text-text-muted uppercase tracking-wider text-[9px]">
                      <tr>
                        <th className="text-left px-3 py-2">SKU / Producto</th>
                        <th className="text-right px-2 py-2">U.C.</th>
                        <th className="text-right px-2 py-2">U.V.</th>
                        <th className="text-left px-2 py-2 min-w-[120px]">Consumo</th>
                        <th className="text-right px-2 py-2">Stock actual</th>
                        <th className="text-right px-2 py-2">Costo unit.</th>
                        <th className="text-right px-2 py-2">Precio unit.</th>
                        <th className="text-right px-2 py-2">Markup %</th>
                        <th className="text-right px-3 py-2">Facturación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsSorted.map((it) => {
                        const enrichment = enriched.data?.[it.sku];
                        const isStuck = it.u_vendida === 0;
                        return (
                          <tr key={it.sku} className="border-t border-border hover:bg-soft/50 transition">
                            <td className="px-3 py-2 max-w-[260px]">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                                  {enrichment?.image_url ? (
                                    <img src={enrichment.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                  ) : (
                                    <Package size={14} className="text-text-muted/40" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-text font-medium truncate" title={it.producto || it.sku}>
                                    {enrichment?.name || it.producto || it.sku}
                                  </div>
                                  <div className="text-[9px] text-text-muted/70 font-mono truncate">
                                    {it.sku}
                                    {enrichment?.ean && <span> · EAN {enrichment.ean}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="text-right px-2 py-2 tabular-nums">{formatNumber(it.u_comprada)}</td>
                            <td className={`text-right px-2 py-2 tabular-nums font-bold ${isStuck ? "text-rose-600" : ""}`}>
                              {formatNumber(it.u_vendida)}
                            </td>
                            <td className="px-2 py-2">
                              <ConsumoBar
                                pct={it.consumo_pct}
                                estado={it.consumo_pct >= 100 ? "agotado" : it.consumo_pct < 5 ? "stuck" : it.consumo_pct < 50 ? "lento" : "saludable"}
                              />
                            </td>
                            <td className="text-right px-2 py-2 tabular-nums">{formatNumber(it.stock_actual)}</td>
                            <td className="text-right px-2 py-2 tabular-nums text-text-muted">{formatCurrency(it.costo_unit_ars)}</td>
                            <td className="text-right px-2 py-2 tabular-nums">{formatCurrency(it.precio_unit_ars)}</td>
                            <td className={`text-right px-2 py-2 tabular-nums font-bold ${it.markup_pct > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {fmtPct(it.markup_pct)}
                            </td>
                            <td className="text-right px-3 py-2 tabular-nums font-semibold text-text">
                              {formatCurrency(it.total_facturacion_item)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Pagina principal
// ============================================================

export default function LotesPage() {
  const [filters, setFilters] = useState({ proveedor: "", origen: "", lote: "", fecha_desde: "", fecha_hasta: "" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [estadoFilter, setEstadoFilter] = useState<Estado | "all">("all");
  const [search, setSearch] = useState("");
  const [drillLote, setDrillLote] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"fecha" | "consumo" | "facturacion" | "cobertura">("fecha");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.proveedor) p.set("proveedor", filters.proveedor);
    if (filters.origen) p.set("origen", filters.origen);
    if (filters.lote) p.set("lote", filters.lote);
    if (filters.fecha_desde) p.set("fecha_desde", filters.fecha_desde);
    if (filters.fecha_hasta) p.set("fecha_hasta", filters.fecha_hasta);
    return p.toString();
  }, [filters]);

  const { data, isLoading, isFetching } = useQuery<LotesResponse>({
    queryKey: ["lotes", qs],
    queryFn: () => api(`/api/dashboards/lotes${qs ? "?" + qs : ""}`),
    staleTime: 60_000,
  });

  const lotes = useMemo(() => {
    if (!data) return [];
    let l = [...data.lotes];
    if (estadoFilter !== "all") l = l.filter((x) => x.estado === estadoFilter);
    if (search) {
      const s = search.toLowerCase();
      l = l.filter(
        (x) =>
          x.lote.toLowerCase().includes(s) ||
          (x.proveedor || "").toLowerCase().includes(s) ||
          (x.origen || "").toLowerCase().includes(s),
      );
    }
    l.sort((a, b) => {
      if (sortBy === "fecha") return (b.fecha_ingreso || "").localeCompare(a.fecha_ingreso || "");
      if (sortBy === "consumo") return b.consumo_lote_pct - a.consumo_lote_pct;
      if (sortBy === "facturacion") return b.total_facturacion_ars - a.total_facturacion_ars;
      if (sortBy === "cobertura") return b.cobertura_pago_pct - a.cobertura_pago_pct;
      return 0;
    });
    return l;
  }, [data, estadoFilter, search, sortBy]);

  return (
    <>
      <Topbar
        title="Gestión de Lotes"
        subtitle="Análisis de consumo, markup y cobertura por lote — alimentado desde el Excel VALOR PRODUCTO"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Lotes" />
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterOpen((v) => !v)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  filterOpen ? "bg-primary text-white border-primary" : "bg-surface border-border hover:border-primary/40"
                }`}
              >
                <Filter size={12} />
                Filtros
              </button>
            </div>
          }
        />

        {/* KPIs cabecera (replica del PowerBI) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {isLoading || !data ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 bg-surface border border-border rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <KpiCard icon={DollarSign} label="Total costo" value={formatCurrency(data.totals.total_costo_ars)} hint={`${data.totals.lotes_count} lotes`} accent="amber" />
              <KpiCard icon={TrendingUp} label="Facturación" value={formatCurrency(data.totals.total_facturacion_ars)} hint="Generada por estos lotes" accent="primary" />
              <KpiCard icon={Sparkles} label="Total markup" value={formatCurrency(data.totals.markup_total_ars)} hint={`${fmtPct(data.totals.markup_pct)} sobre costo`} accent="rose" />
              <KpiCard icon={Percent} label="Markup %" value={fmtPct(data.totals.markup_pct)} accent="rose" />
              <KpiCard icon={Package} label="U. compradas" value={formatNumber(data.totals.u_compradas)} hint={`${data.totals.skus_count} SKUs`} accent="blue" />
              <KpiCard icon={ShoppingBag} label="U. vendidas" value={formatNumber(data.totals.u_vendidas)} accent="emerald" />
              <KpiCard icon={TrendingDown} label="Consumo" value={fmtPct(data.totals.consumo_lote_pct)} hint="U.V. / U.C." accent="emerald" />
              <KpiCard icon={CheckCircle2} label="Cobertura pago" value={fmtPct(data.totals.cobertura_pago_pct)} hint="Facturación / Costo" accent="primary" />
            </>
          )}
        </div>

        {/* Filtros expandidos */}
        {filterOpen && data && (
          <div className="bg-surface border border-border rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Proveedor</label>
              <select
                value={filters.proveedor}
                onChange={(e) => setFilters({ ...filters, proveedor: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
              >
                <option value="">Todos</option>
                {data.filters_available.proveedores.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Origen</label>
              <select
                value={filters.origen}
                onChange={(e) => setFilters({ ...filters, origen: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
              >
                <option value="">Todos</option>
                {data.filters_available.origenes.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha desde</label>
              <input
                type="date"
                value={filters.fecha_desde}
                onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha hasta</label>
              <input
                type="date"
                value={filters.fecha_hasta}
                onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setFilters({ proveedor: "", origen: "", lote: "", fecha_desde: "", fecha_hasta: "" })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border hover:border-primary/40 transition"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
        )}

        {/* Sub-filtros: estado + search + sort */}
        <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "saludable", "lento", "stuck", "agotado", "nuevo"] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEstadoFilter(e)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  estadoFilter === e
                    ? "bg-primary text-white shadow-md"
                    : "bg-soft text-text-muted hover:bg-soft/80"
                }`}
              >
                {e === "all" ? "Todos" : ESTADO_COLOR[e].label}
                {e !== "all" && data && (
                  <span className="ml-1 opacity-60">({data.lotes.filter((l) => l.estado === e).length})</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[200px] relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lote, proveedor u origen..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
          >
            <option value="fecha">Más recientes</option>
            <option value="consumo">Mayor consumo</option>
            <option value="facturacion">Mayor facturación</option>
            <option value="cobertura">Mayor cobertura</option>
          </select>
        </div>

        {/* Tabla de lotes (desktop) */}
        <div className="hidden lg:block bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2.5">Lote</th>
                  <th className="text-left px-2 py-2.5">Proveedor</th>
                  <th className="text-left px-2 py-2.5">Ingresó</th>
                  <th className="text-center px-2 py-2.5">Estado</th>
                  <th className="text-right px-2 py-2.5">SKUs</th>
                  <th className="text-right px-2 py-2.5">U.C.</th>
                  <th className="text-right px-2 py-2.5">U.V.</th>
                  <th className="text-left px-2 py-2.5 min-w-[140px]">Consumo</th>
                  <th className="text-right px-2 py-2.5">Costo</th>
                  <th className="text-right px-2 py-2.5">Facturación</th>
                  <th className="text-right px-2 py-2.5">Markup %</th>
                  <th className="text-right px-2 py-2.5">Cobertura</th>
                  <th className="text-right px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td colSpan={13} className="py-4">
                        <div className="h-6 bg-soft rounded animate-pulse mx-3" />
                      </td>
                    </tr>
                  ))
                ) : lotes.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-text-muted">
                      No hay lotes que coincidan con los filtros.
                    </td>
                  </tr>
                ) : (
                  lotes.map((l) => {
                    const days = daysSince(l.fecha_ingreso);
                    return (
                      <tr
                        key={l.lote_id}
                        onClick={() => setDrillLote(l.lote_id)}
                        className="border-t border-border hover:bg-soft/40 transition cursor-pointer group"
                      >
                        <td className="px-3 py-2.5 font-bold text-text group-hover:text-primary transition">
                          {l.lote}
                        </td>
                        <td className="px-2 py-2.5 text-text-muted text-xs">{l.proveedor || "—"}</td>
                        <td className="px-2 py-2.5 text-xs">
                          <div className="text-text">{fmtDateAR(l.fecha_ingreso)}</div>
                          {days !== null && <div className="text-[10px] text-text-muted">hace {days} días</div>}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <EstadoBadge estado={l.estado} />
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-text-muted">{l.skus_count}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(l.u_compradas)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums font-bold">{formatNumber(l.u_vendidas)}</td>
                        <td className="px-2 py-2.5">
                          <ConsumoBar pct={l.consumo_lote_pct} estado={l.estado} />
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-text-muted">{formatCurrency(l.total_costo_ars)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums font-bold text-text">{formatCurrency(l.total_facturacion_ars)}</td>
                        <td className={`px-2 py-2.5 text-right tabular-nums font-bold ${l.markup_pct > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {fmtPct(l.markup_pct)}
                        </td>
                        <td className={`px-2 py-2.5 text-right tabular-nums font-bold ${l.cobertura_pago_pct >= 100 ? "text-emerald-600" : l.cobertura_pago_pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                          {fmtPct(l.cobertura_pago_pct)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <ChevronRight size={14} className="text-text-muted group-hover:text-primary transition inline" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cards de lotes (mobile + tablet) */}
        <div className="lg:hidden space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-4 animate-pulse">
                <div className="h-5 bg-soft rounded w-2/3 mb-2" />
                <div className="h-4 bg-soft rounded w-full mb-2" />
                <div className="h-4 bg-soft rounded w-1/2" />
              </div>
            ))
          ) : lotes.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-12 text-center text-text-muted text-sm">
              No hay lotes que coincidan con los filtros.
            </div>
          ) : (
            lotes.map((l) => {
              const days = daysSince(l.fecha_ingreso);
              return (
                <button
                  key={l.lote_id}
                  onClick={() => setDrillLote(l.lote_id)}
                  className="w-full bg-surface border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition text-left"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-text truncate">{l.lote}</div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {l.proveedor || "—"}
                        {l.fecha_ingreso && (
                          <span className="ml-2">
                            · {fmtDateAR(l.fecha_ingreso)}
                            {days !== null && ` · hace ${days}d`}
                          </span>
                        )}
                      </div>
                    </div>
                    <EstadoBadge estado={l.estado} />
                  </div>

                  {/* Consumo bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-[10px] uppercase font-bold text-text-muted mb-1">
                      <span>Consumo del lote</span>
                      <span>{formatNumber(l.u_vendidas)}/{formatNumber(l.u_compradas)} un</span>
                    </div>
                    <ConsumoBar pct={l.consumo_lote_pct} estado={l.estado} />
                  </div>

                  {/* KPIs grid 2x2 */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-soft/50 rounded-lg p-2">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Costo</div>
                      <div className="font-bold text-text tabular-nums truncate">{formatCurrency(l.total_costo_ars)}</div>
                    </div>
                    <div className="bg-soft/50 rounded-lg p-2">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Facturación</div>
                      <div className="font-bold text-text tabular-nums truncate">{formatCurrency(l.total_facturacion_ars)}</div>
                    </div>
                    <div className="bg-soft/50 rounded-lg p-2">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Markup</div>
                      <div className={`font-bold tabular-nums ${l.markup_pct > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {fmtPct(l.markup_pct)}
                      </div>
                    </div>
                    <div className="bg-soft/50 rounded-lg p-2">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Cobertura pago</div>
                      <div className={`font-bold tabular-nums ${l.cobertura_pago_pct >= 100 ? "text-emerald-600" : l.cobertura_pago_pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                        {fmtPct(l.cobertura_pago_pct)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-primary font-semibold">
                    Ver detalle SKU por SKU <ChevronRight size={11} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {data && (
          <div className="mt-3 text-xs text-text-muted text-center">
            Mostrando {lotes.length} de {data.lotes.length} lotes · Click en un lote para ver el análisis SKU por SKU
          </div>
        )}
      </div>

      {drillLote && <LoteDetailModal loteId={drillLote} onClose={() => setDrillLote(null)} />}
    </>
  );
}
