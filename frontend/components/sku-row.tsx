"use client";

import { ImageOff } from "lucide-react";
import type { SkuEnrichment } from "@/lib/use-sku-enrichment";

type Props = {
  index?: number;
  sku: string;
  name?: string | null;
  rightValue?: React.ReactNode;
  enrichment?: SkuEnrichment;
  onClick?: () => void;
};

/**
 * Componente reutilizable para mostrar una fila de SKU con:
 * - thumbnail (imagen del producto, fallback a icono)
 * - nombre + EAN (si lo tenemos)
 * - valor numerico a la derecha (revenue, unidades, etc.)
 *
 * Funciona aun cuando enrichment esta cargando (placeholder gris).
 */
export function SkuRow({ index, sku, name, rightValue, enrichment, onClick }: Props) {
  const displayName = enrichment?.name || name || sku;
  const ean = enrichment?.ean;
  const img = enrichment?.image_url;

  return (
    <div
      className={`flex items-center gap-3 py-1.5 ${onClick ? "cursor-pointer hover:bg-soft/60 -mx-2 px-2 rounded" : ""}`}
      onClick={onClick}
    >
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

      {/* Texto: nombre + sku/ean en linea menor */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text truncate" title={displayName}>
          {displayName}
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
    </div>
  );
}
