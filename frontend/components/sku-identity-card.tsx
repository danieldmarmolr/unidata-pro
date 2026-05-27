"use client";

import { useEffect, useState } from "react";
import {
  Package, Barcode, Copy, CheckCircle2, XCircle, ExternalLink,
  CalendarDays, Hash, Image as ImageIcon, X,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// Card de identidad ULTRA compacto: thumbnail + SKU + EAN + Precio + Estado +
// Primera/Ultima venta + ProductID en una sola tarjeta horizontal. Reemplaza
// los 3 bloques separados que ocupaban ~400px de scroll arriba del SKU 360.

type Props = {
  sku: string;
  name?: string | null;
  brand?: string | null;
  ean?: string | null;
  price?: number | null;
  published?: boolean | null;
  productId?: number | null;
  firstSale?: string | null;
  lastSale?: string | null;
  images?: string[];
};

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function GalleryModal({ images, onClose, sku }: { images: string[]; sku: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-text">Imágenes del producto · {images.length}</h3>
            <p className="text-[11px] text-text-muted">SKU {sku}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a
              key={`${src}-${i}`}
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border overflow-hidden hover:border-primary transition"
            >
              <img
                src={src}
                alt={`SKU ${sku} imagen ${i + 1}`}
                className="w-full h-64 object-cover bg-soft"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkuIdentityCard({
  sku, name, brand, ean, price, published, productId, firstSale, lastSale, images = [],
}: Props) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const firstImage = images[0];
  const hasMoreImages = images.length > 1;

  return (
    <>
      <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-4">
        <div className="flex items-stretch gap-4 flex-wrap md:flex-nowrap">
          {/* Thumbnail */}
          <button
            type="button"
            onClick={() => images.length > 0 && setGalleryOpen(true)}
            className="relative shrink-0 w-20 h-20 rounded-lg border border-border bg-soft overflow-hidden group disabled:cursor-default"
            disabled={images.length === 0}
            title={images.length > 0 ? `Ver ${images.length} imágenes` : "Sin imágenes"}
          >
            {firstImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firstImage}
                alt={name ?? sku}
                className="w-full h-full object-cover group-hover:scale-105 transition"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <ImageIcon size={20} />
              </div>
            )}
            {hasMoreImages && (
              <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] font-bold rounded px-1 py-0.5">
                +{images.length - 1}
              </span>
            )}
          </button>

          {/* Identificacion + datos inline */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {/* Row 1: SKU + EAN + Precio + Estado */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/30">
                <Package size={11} className="text-primary" />
                <span className="text-[9px] uppercase tracking-wider text-primary/80 font-bold">SKU</span>
                <span className="font-mono font-extrabold text-text">{sku}</span>
              </span>

              {ean && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-300">
                  <Barcode size={11} className="text-amber-700" />
                  <span className="text-[9px] uppercase tracking-wider text-amber-800 font-bold">EAN</span>
                  <span className="font-mono font-extrabold text-text tracking-wider">{ean}</span>
                  <button
                    onClick={() => copyText(ean)}
                    className="text-amber-700 hover:text-amber-900 inline-flex items-center"
                    title="Copiar EAN"
                  >
                    <Copy size={10} />
                  </button>
                </span>
              )}

              {typeof price === "number" && price > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Precio</span>
                  <span className="font-bold text-text tabular-nums">{formatCurrency(price)}</span>
                </span>
              )}

              {published === true && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                  <CheckCircle2 size={9} /> Publicado
                </span>
              )}
              {published === false && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-zinc-100 text-zinc-700 border-zinc-300">
                  <XCircle size={9} /> Despublicado
                </span>
              )}
            </div>

            {/* Row 2: nombre + brand */}
            {(name || brand) && (
              <div className="flex items-baseline gap-2 min-w-0">
                {name && <span className="text-sm font-bold text-text truncate" title={name}>{name}</span>}
                {brand && <span className="text-[11px] text-text-muted shrink-0">· {brand}</span>}
              </div>
            )}

            {/* Row 3: fechas + product id */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
              {firstSale && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays size={10} />
                  Primera venta: <span className="font-semibold text-text">{firstSale.slice(0, 10)}</span>
                </span>
              )}
              {lastSale && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays size={10} />
                  Última venta: <span className="font-semibold text-text">{lastSale.slice(0, 10)}</span>
                </span>
              )}
              {productId && productId > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Hash size={10} />
                  TN ID: <span className="font-mono font-semibold text-text">{productId}</span>
                  <a
                    href={`https://unistoreargentina.com/admin/products/${productId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center"
                    title="Abrir en TN"
                  >
                    <ExternalLink size={9} />
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {galleryOpen && images.length > 0 && (
        <GalleryModal images={images} sku={sku} onClose={() => setGalleryOpen(false)} />
      )}
    </>
  );
}
