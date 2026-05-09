"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";

type Row = {
  category: string;
  value: number;
  extra?: Record<string, number | string | null> | null;
};

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
}) {
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
          return (
            <div
              key={`m-${r.category}-${i}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={
                "border border-border rounded-lg p-3 bg-soft/30 " +
                (onRowClick ? "cursor-pointer hover:bg-soft active:bg-soft transition" : "")
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
              return (
                <tr
                  key={`${r.category}-${i}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={
                    "border-t border-border hover:bg-soft transition " +
                    (onRowClick ? "cursor-pointer" : "")
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
                    <div className="font-semibold text-text">{fmt(r.value)}</div>
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
