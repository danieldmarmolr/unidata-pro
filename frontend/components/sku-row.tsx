"use client";

import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { SkuEnrichment } from "@/lib/use-sku-enrichment";

type Props = {
  index?: number;
  sku: string;
  name?: string | null;
  rightValue?: React.ReactNode;
  enrichment?: SkuEnrichment;
  /** Si se pasa, sobreescribe el comportamiento default (link al detalle del SKU). */
  onClick?: () => void;
  /** Si true, renderiza sin link (modo display puro). */
  noLink?: boolean;
};

/**
 * Componente reutilizable para mostrar una fila de SKU con:
 * - thumbnail (imagen del producto, fallback a icono)
 * - nombre + EAN (si lo tenemos)
 * - valor numerico a la derecha (revenue, unidades, etc.)
 *
 * Funciona aun cuando enrichment esta cargando (placeholder gris).
 */
export function SkuRow({ index, sku, name, rightValue, enrichment, onClick, noLink }: Props) {
  const displayName = enrichment?.name || name || sku;
  const ean = enrichment?.ean;
  const img = enrichment?.image_url;

  // Comportamiento default: si no hay onClick custom y no esta el flag noLink,
  // wrapear en Link al detalle del SKU
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    if (onClick) {
      return (
        <div
          className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-soft/60 -mx-2 px-2 rounded transition"
          onClick={onClick}
        >
          {children}
        </div>
      );
    }
    if (!noLink && sku) {
      return (
        <Link
          href={`/dashboard/productos/${encodeURIComponent(sku)}`}
          className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-soft/60 -mx-2 px-2 rounded transition"
        >
          {children}
        </Link>
      );
    }
    return <div className="flex items-center gap-3 py-1.5">{children}</div>;
  };

  return (
    <Wrapper>
    <>
      {/* Index */}
      {typeof index === "number" && (
        <div className="text-xs text-text-muted font-semibold tabular-nums w-4 text-right">
          {index}.
        </div>
      )}

      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
        {img ? (
          <img
            src={img}
            alt={displayName}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              // si falla la imagen, escondemos el img y dejamos el fallback
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <ImageOff className="w-4 h-4 text-text-muted/40" />
        )}
      </div>

      {/* Texto: nombre + sku/ean + badge servicio */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text truncate flex items-center gap-2" title={displayName}>
          <span className="truncate">{displayName}</span>
          {enrichment?.is_service && (
            <span className="flex-shrink-0 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
              Servicio Unidrop
            </span>
          )}
        </div>
        <div className="text-[10px] text-text-muted/70 mt-0.5 flex items-center gap-2 truncate">
          <span className="font-mono">{sku}</span>
          {ean && (
            <>
              <span className="opacity-50">·</span>
              <span className="font-mono">EAN {ean}</span>
            </>
          )}
        </div>
      </div>

      {/* Valor a la derecha */}
      {rightValue !== undefined && (
        <div className="text-sm font-semibold text-text tabular-nums whitespace-nowrap">
          {rightValue}
        </div>
      )}
    </>
    </Wrapper>
  );
}
