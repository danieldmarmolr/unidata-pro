"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageOff, ChevronRight } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";

type Row = {
  category: string;
  value: number;
  extra?: Record<string, number | string | null> | null;
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

/** Auto-detecta el destino de drill segun el contenido de la fila.
 *  Devuelve un href de Next.js o null si no hay match. */
function autoDrillHref(r: Row): string | null {
  const cat = (r.category || "").trim();
  const extra = r.extra || {};

  // 1. SKU en extra (campo explicito)
  const sku = extra.sku;
  if (typeof sku === "string" && sku.trim()) {
    return `/dashboard/productos/${encodeURIComponent(sku.trim())}`;
  }
  // 2. Customer con customer_id
  const cid = extra.customer_id ?? extra.customerId;
  if (typeof cid === "number" && cid > 0) {
    return `/dashboard/customer/${cid}`;
  }
  // 3. Provincia argentina
  if (AR_PROVINCES.has(cat)) {
    return `/dashboard/mapa?province=${encodeURIComponent(cat)}`;
  }
  // 4. Area Digip (stock)
  if (DIGIP_AREAS.has(cat.toLowerCase())) {
    return `/dashboard/stock-heatmap?area=${encodeURIComponent(cat)}`;
  }
  // 5. Lote
  if (extra.lote || /^(lote|batch)[-\s]?\d+/i.test(cat)) {
    const loteName = (extra.lote as string) || cat;
    return `/dashboard/lotes?lote=${encodeURIComponent(loteName)}`;
  }
  // 6. Brand (filtro en productos)
  if (extra.brand && typeof extra.brand === "string") {
    return `/dashboard/productos?marca=${encodeURIComponent(extra.brand)}`;
  }
  // 7. Hint generico de tipo
  const kind = (extra.kind as string) || (extra.type as string) || "";
  if (kind === "brand" || kind === "marca") {
    return `/dashboard/productos?marca=${encodeURIComponent(cat)}`;
  }
  if (kind === "category" || kind === "categoria") {
    return `/dashboard/productos?categoria=${encodeURIComponent(cat)}`;
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
  // Helper para decidir el handler final de click por fila.
  // Prioridad: onRowClick explicito > autoDrill href > nada
  const handleRowClick = (r: Row) => {
    if (onRowClick) { onRowClick(r); return; }
    if (autoDrill) {
      const href = autoDrillHref(r);
      if (href) router.push(href);
    }
  };
  // Una fila es "interactiva" si tiene onRowClick custom o autoDrill match
  const isInteractive = (r: Row) => !!onRowClick || (autoDrill && autoDrillHref(r) !== null);
  const max = Math.max(0, ...data.map((d) => d.value));
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
        {data.map((r, i) => {
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
        {data.length === 0 && (
          <div className="py-8 text-center text-text-muted text-sm">Sin datos.</div>
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="overflow-x-auto hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="pl-2 py-2 w-8">#</th>
              <th className="py-2">Categoria</th>
              {extraColumns.map((c) => (
                <th key={c.key} className="py-2 text-right pr-3">{c.label}</th>
              ))}
              <th className="py-2 text-right pr-2 min-w-[160px]">Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
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
                  <td className="pl-2 py-2 text-text-muted text-xs font-mono">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium text-text" title={r.category}>
                    <div className="flex items-center gap-2">
                      {sku && (
                        <div className="w-9 h-9 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
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
                            <ImageOff className="w-3 h-3 text-text-muted/40" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate max-w-[280px]">{r.category}</div>
                        {sku && (
                          <div className="text-[10px] text-text-muted/70 mt-0.5 flex items-center gap-1.5 truncate">
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
                  </td>
                  {extraColumns.map((c) => {
                    const raw = r.extra?.[c.key];
                    return (
                      <td key={c.key} className="py-2 pr-3 text-right tabular-nums text-text-muted text-xs">
                        {raw === null || raw === undefined
                          ? "—"
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
            {data.length === 0 && (
              <tr>
                <td colSpan={2 + extraColumns.length} className="py-8 text-center text-text-muted text-sm">
                  Sin datos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
