"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageOff, ChevronRight, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";
import { DrillDownModal } from "@/components/drilldown-modal";

type Row = {
  category: string;
  value: number;
  extra?: Record<string, number | string | boolean | null> | null;
};

// Lista de provincias argentinas para auto-detection
const AR_PROVINCES = new Set([
  "Buenos Aires", "Capital Federal", "Ciudad de Buenos Aires", "CABA",
  "Catamarca", "Chaco", "Chubut", "Córdoba", "Cordoba", "Corrientes",
  "Entre Ríos", "Entre Rios", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Neuquen", "Río Negro", "Rio Negro",
  "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
  "Santiago del Estero", "Tierra del Fuego", "Tucumán", "Tucuman",
]);

// Áreas Digip conocidas (case insensitive)
const DIGIP_AREAS = new Set([
  "almacen", "almacén", "despacho", "preparacion", "preparación",
  "picking", "dock", "recepcion", "recepción",
]);

// Lifecycle stages de clientes -> drill modal a customers-by-status
const LIFECYCLE_STAGES = new Set([
  "Nuevo", "2da compra", "Segunda compra", "Conv. a Recurrente",
  "Convertido a Recurrente", "Recurrente", "Recuperado",
  "Sin compras", "Sin compras pagas", "Posible churn", "Perdidos",
]);

// Segmentos RFM -> drill modal a customers-by-rfm
const RFM_SEGMENTS = new Set([
  "Champions", "Fieles", "Loyal", "En riesgo", "At Risk",
  "Nuevos potenciales", "Perdidos VIP", "Lost", "Standard",
  "Promising", "About to Sleep", "Need Attention", "Cant Lose",
  "Hibernating", "Potential Loyalist",
]);

type AutoDrill =
  | { kind: "navigate"; href: string }
  | { kind: "modal"; endpoint: string; title: string; filename: string };

/** Auto-detecta el destino de drill segun el contenido de la fila.
 *  Devuelve {kind:"navigate", href} para rutas, o {kind:"modal", endpoint}
 *  para abrir DrillDownModal interno, o null si no hay match. */
function getAutoDrill(r: Row): AutoDrill | null {
  const cat = (r.category || "").trim();
  const extra = r.extra || {};

  // 1. SKU en extra (campo explicito) - navigate
  const sku = extra.sku;
  if (typeof sku === "string" && sku.trim()) {
    return { kind: "navigate", href: `/dashboard/productos/${encodeURIComponent(sku.trim())}` };
  }
  // 2a. End Consumer Unidrop (DNI + marker unidrop_consumer) - navigate al End Consumer 360
  if (extra.unidrop_consumer && typeof extra.dni === "string" && extra.dni.trim()) {
    return { kind: "navigate", href: `/dashboard/unidrop-customer/${encodeURIComponent(extra.dni.trim())}` };
  }
  // 2b. Customer Unistore con customer_id - navigate al Customer 360 Unistore
  const cid = extra.customer_id ?? extra.customerId;
  if (typeof cid === "number" && cid > 0) {
    return { kind: "navigate", href: `/dashboard/customer/${cid}` };
  }
  // 3. Provincia argentina - navigate
  if (AR_PROVINCES.has(cat)) {
    return { kind: "navigate", href: `/dashboard/mapa?province=${encodeURIComponent(cat)}` };
  }
  // 4. Area Digip - navigate
  if (DIGIP_AREAS.has(cat.toLowerCase())) {
    return { kind: "navigate", href: `/dashboard/stock-heatmap?area=${encodeURIComponent(cat)}` };
  }
  // 5. Lote - navigate
  if (extra.lote || /^(lote|batch)[-\s]?\d+/i.test(cat)) {
    const loteName = (extra.lote as string) || cat;
    return { kind: "navigate", href: `/dashboard/lotes?lote=${encodeURIComponent(loteName)}` };
  }
  // 6. Brand - navigate
  if (extra.brand && typeof extra.brand === "string") {
    return { kind: "navigate", href: `/dashboard/productos?marca=${encodeURIComponent(extra.brand)}` };
  }
  // 7. Lifecycle stage -> drill MODAL con customers-by-status
  if (LIFECYCLE_STAGES.has(cat)) {
    return {
      kind: "modal",
      endpoint: `/api/drilldowns/cs/customers-by-status?status=${encodeURIComponent(cat)}`,
      title: `Clientes en estado: ${cat}`,
      filename: `lifecycle_${cat.toLowerCase().replace(/\s+/g, "_")}.csv`,
    };
  }
  // 8. RFM segment -> drill MODAL con customers-by-rfm
  if (RFM_SEGMENTS.has(cat)) {
    return {
      kind: "modal",
      endpoint: `/api/drilldowns/cs/customers-by-rfm?segment=${encodeURIComponent(cat)}`,
      title: `Clientes RFM: ${cat}`,
      filename: `rfm_${cat.toLowerCase().replace(/\s+/g, "_")}.csv`,
    };
  }
  // 9. Hint generico
  const kind = (extra.kind as string) || (extra.type as string) || "";
  if (kind === "brand" || kind === "marca") {
    return { kind: "navigate", href: `/dashboard/productos?marca=${encodeURIComponent(cat)}` };
  }
  if (kind === "category" || kind === "categoria") {
    return { kind: "navigate", href: `/dashboard/productos?categoria=${encodeURIComponent(cat)}` };
  }
  return null;
}

export function CategoryTable({
  data,
  caption,
  subtitle,
  formatter = "currency",
  extraColumns = [],
  showProgress = true,
  onRowClick,
  enrichSku = true,
  skuUnit = "unistore",
  autoDrill = true,
}: {
  data: Row[];
  caption?: string;
  subtitle?: string;
  formatter?: "currency" | "number" | "raw";
  extraColumns?: { key: string; label: string; format?: "currency" | "number" | "raw" }[];
  showProgress?: boolean;
  onRowClick?: (r: Row) => void;
  /** Si una fila tiene `extra.sku`, traer y mostrar el thumbnail del producto. Default true. */
  enrichSku?: boolean;
  skuUnit?: "unistore" | "unidrop";
  /** Auto-detecta drill por contenido de la fila (provincia/SKU/customer/area/etc).
   *  Aplica solo si onRowClick NO se pasa explicitamente. Default true. */
  autoDrill?: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<{ endpoint: string; title: string; filename: string } | null>(null);
  // Sort state: clave = "value" para la columna Valor, o c.key para extras, o "category"
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const resolveDrill = (r: Row): AutoDrill | null => {
    if (!autoDrill) return null;
    return getAutoDrill(r);
  };

  // Helper para decidir el handler final de click por fila.
  // Prioridad: onRowClick explicito > autoDrill (navigate/modal) > nada
  const handleRowClick = (r: Row) => {
    if (onRowClick) { onRowClick(r); return; }
    const drill = resolveDrill(r);
    if (!drill) return;
    if (drill.kind === "navigate") {
      router.push(drill.href);
    } else {
      setModal({ endpoint: drill.endpoint, title: drill.title, filename: drill.filename });
    }
  };
  // Una fila es "interactiva" si tiene onRowClick custom o autoDrill match
  const isInteractive = (r: Row) => !!onRowClick || resolveDrill(r) !== null;

  // Ordenamiento por columna
  const sortedData = useMemo(() => {
    if (!sortBy) return data;
    const arr = [...data];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let va: number | string | boolean | null | undefined;
      let vb: number | string | boolean | null | undefined;
      if (sortBy === "value") {
        va = a.value; vb = b.value;
      } else if (sortBy === "category") {
        va = a.category; vb = b.category;
      } else {
        va = a.extra?.[sortBy];
        vb = b.extra?.[sortBy];
      }
      // null/undefined al final
      const aNull = va === null || va === undefined || va === "";
      const bNull = vb === null || vb === undefined || vb === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "es", { numeric: true }) * dir;
    });
    return arr;
  }, [data, sortBy, sortDir]);

  const max = Math.max(0, ...sortedData.map((d) => d.value));
  const fmt = (v: number, f?: string) => {
    const ff = f ?? formatter;
    if (ff === "currency") return formatCurrency(v);
    if (ff === "number") return formatNumber(v);
    return String(v);
  };

  // Enriquecer con imagen + EAN cuando las filas tienen SKUs
  const skusInData = useMemo(() => {
    if (!enrichSku) return [] as string[];
    const out: string[] = [];
    for (const r of data) {
      const s = r.extra?.sku;
      if (typeof s === "string" && s.trim()) out.push(s.trim());
    }
    return out;
  }, [data, enrichSku]);
  const skuEnriched = useSkuEnrichment(skuUnit, skusInData);
  const enrichments = skuEnriched.data ?? {};

  return (
    <div className="bg-surface border border-border rounded-xl p-4 sm:p-5">
      {(caption || subtitle) && (
        <div className="mb-3">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
      )}

      {/* Mobile: cards */}
      <div className="lg:hidden space-y-2">
        {sortedData.map((r, i) => {
          const pct = max > 0 ? (r.value / max) * 100 : 0;
          const sku = typeof r.extra?.sku === "string" ? (r.extra.sku as string) : null;
          const enrich = sku ? enrichments[sku] : undefined;
          const img = enrich?.image_url;
          const ean = enrich?.ean;
          const interactive = isInteractive(r);
          return (
            <div
              key={`m-${r.category}-${i}`}
              onClick={interactive ? () => handleRowClick(r) : undefined}
              className={
                "border border-border rounded-lg p-3 bg-soft/30 " +
                (interactive ? "cursor-pointer hover:bg-soft active:bg-soft transition" : "")
              }
            >
              <div className="flex items-start gap-3 mb-1.5">
                {sku && (
                  <div className="w-12 h-12 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={r.category} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <ImageOff className="w-4 h-4 text-text-muted/40" />
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-text-muted shrink-0">#{i + 1}</span>
                      <span className="font-medium text-text text-sm truncate" title={r.category}>{r.category}</span>
                    </div>
                    <span className="font-bold text-text text-sm tabular-nums shrink-0">{fmt(r.value)}</span>
                  </div>
                  {sku && (
                    <div className="text-[10px] text-text-muted/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono">{sku}</span>
                      {ean && (
                        <span
                          className="font-mono inline-flex items-center gap-0.5 px-1 rounded bg-amber-50 text-amber-800 border border-amber-200/60"
                          title="EAN - Codigo de barras oficial del producto"
                        >
                          <span className="text-[8px] font-bold">EAN</span> {ean}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {showProgress && (
                <div className="h-1 bg-soft rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {extraColumns.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                  {extraColumns.map((c) => {
                    const raw = r.extra?.[c.key];
                    return (
                      <div key={c.key} className="flex justify-between text-[11px]">
                        <span className="text-text-muted">{c.label}</span>
                        <span className="tabular-nums font-semibold text-text">
                          {raw === null || raw === undefined
                            ? "—"
                            : typeof raw === "number"
                              ? fmt(raw, c.format)
                              : String(raw)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sortedData.length === 0 && (
          <div className="py-8 text-center text-text-muted text-sm">Sin datos.</div>
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="overflow-x-auto hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="pl-2 py-2 w-8">#</th>
              <th className="py-2">
                <button
                  type="button"
                  onClick={() => toggleSort("category")}
                  className="inline-flex items-center gap-1 hover:text-text transition"
                >
                  Categoria
                  {sortBy === "category"
                    ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                    : <ArrowUpDown size={10} className="opacity-30" />}
                </button>
              </th>
              {extraColumns.map((c) => (
                <th key={c.key} className="py-2 text-right pr-3">
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="inline-flex items-center gap-1 hover:text-text transition"
                  >
                    {c.label}
                    {sortBy === c.key
                      ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                      : <ArrowUpDown size={10} className="opacity-30" />}
                  </button>
                </th>
              ))}
              <th className="py-2 text-right pr-2 min-w-[160px]">
                <button
                  type="button"
                  onClick={() => toggleSort("value")}
                  className="inline-flex items-center gap-1 hover:text-text transition"
                >
                  Valor
                  {sortBy === "value"
                    ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                    : <ArrowUpDown size={10} className="opacity-30" />}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((r, i) => {
              const pct = max > 0 ? (r.value / max) * 100 : 0;
              const sku = typeof r.extra?.sku === "string" ? (r.extra.sku as string) : null;
              const enrich = sku ? enrichments[sku] : undefined;
              const img = enrich?.image_url;
              const ean = enrich?.ean;
              const interactive = isInteractive(r);
              return (
                <tr
                  key={`${r.category}-${i}`}
                  onClick={interactive ? () => handleRowClick(r) : undefined}
                  className={
                    "border-t border-border hover:bg-soft transition group " +
                    (interactive ? "cursor-pointer" : "")
                  }
                >
                  <td className="pl-2 py-2 text-text-muted text-xs font-mono tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium text-text" title={r.category}>
                    <div className="flex items-center gap-2.5">
                      {sku && (
                        <div className="w-10 h-10 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={img}
                              alt={r.category}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <ImageOff className="w-3.5 h-3.5 text-text-muted/40" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate max-w-[320px] leading-tight">{r.category}</div>
                        {sku && (
                          <div className="text-[10px] text-text-muted/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono">{sku}</span>
                            {ean && (
                              <span
                                className="font-mono inline-flex items-center gap-0.5 px-1 rounded bg-amber-50 text-amber-800 border border-amber-200/60"
                                title="EAN - Código de barras oficial del producto"
                              >
                                <span className="text-[8px] font-bold">EAN</span> {ean}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {extraColumns.map((c) => {
                    const raw = r.extra?.[c.key];
                    // Cero o vacio -> em dash más limpio
                    const isZeroish = raw === null || raw === undefined || raw === "" || raw === 0;
                    return (
                      <td key={c.key} className="py-2 pr-3 text-right tabular-nums text-text-muted text-xs">
                        {isZeroish
                          ? <span className="text-text-muted/30">—</span>
                          : typeof raw === "number"
                            ? fmt(raw, c.format)
                            : String(raw)}
                      </td>
                    );
                  })}
                  <td className="py-2 pr-2 text-right tabular-nums">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="font-semibold text-text">{fmt(r.value)}</span>
                      {interactive && (
                        <ChevronRight
                          size={12}
                          className="text-text-muted opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                        />
                      )}
                    </div>
                    {showProgress && (
                      <div className="h-1 bg-soft rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {sortedData.length === 0 && (
              <tr>
                <td colSpan={2 + extraColumns.length} className="py-8 text-center text-text-muted text-sm">
                  Sin datos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <DrillDownModal
          title={modal.title}
          endpoint={modal.endpoint}
          filename={modal.filename}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
