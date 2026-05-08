"use client";

import { useState, useEffect } from "react";
import { Search, ScanBarcode, Loader2, AlertCircle } from "lucide-react";
import { looksLikeEan, lookupByEan, type SkuLookupResult } from "@/lib/use-sku-enrichment";

type Props = {
  /** unidad (por ahora solo "unistore" soporta lookup por EAN) */
  unit: string;
  /** placeholder del input */
  placeholder?: string;
  /** se llama con el SKU resuelto (sea que el user haya tipeado SKU directo o un EAN) */
  onSkuSelected: (sku: string, info?: SkuLookupResult) => void;
  /** auto-focus al cargar */
  autoFocus?: boolean;
  /** debounce ms (default 300) para que el typing no spamee la API */
  debounceMs?: number;
};

/**
 * Componente de busqueda inteligente: detecta si el input es SKU (texto)
 * o EAN (numerico de 8/12/13/14 digitos) y resuelve a SKU automaticamente.
 *
 * Casos:
 * - User tipea "10IVA21" -> queda como SKU literal, no hace lookup
 * - User tipea "1000010800002" (13 dig) -> hace POST /lookup-by-ean -> devuelve SKU
 * - User scanea con lector de codigo (que pega numero + Enter) -> idem
 *
 * Usado en vistas de logistica donde el operario tiene el producto fisico en
 * la mano y scanea el codigo de barra. UNIDATA resuelve a SKU y abre el detalle.
 */
export function SkuSearchBox({
  unit,
  placeholder = "Buscar por SKU o escanear EAN...",
  onSkuSelected,
  autoFocus = false,
  debounceMs = 300,
}: Props) {
  const [value, setValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedHint, setResolvedHint] = useState<string | null>(null);

  // Debounced auto-resolve cuando es EAN claro (13 dig). Para SKU texto no resolvemos
  // automaticamente, esperamos Enter o submit explicito.
  useEffect(() => {
    setError(null);
    setResolvedHint(null);
    const v = value.trim();
    if (!v) return;
    if (!looksLikeEan(v)) return;

    const t = setTimeout(async () => {
      setResolving(true);
      try {
        const r = await lookupByEan(unit, v);
        setResolvedHint(`${r.sku} — ${(r.name || "").slice(0, 40)}`);
        onSkuSelected(r.sku, r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "EAN no encontrado");
      } finally {
        setResolving(false);
      }
    }, debounceMs);

    return () => clearTimeout(t);
  }, [value, unit, debounceMs, onSkuSelected]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    if (looksLikeEan(v)) return; // ya lo manejo el debounced
    // SKU literal: pasarlo directo
    onSkuSelected(v);
  }

  const isEan = looksLikeEan(value);

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          {isEan ? <ScanBarcode size={16} /> : <Search size={16} />}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition font-mono text-sm"
        />
        {resolving && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
      </div>

      {/* Hint visual */}
      {value && (
        <div className="mt-1 text-[11px] flex items-center gap-2">
          {error ? (
            <span className="text-error flex items-center gap-1">
              <AlertCircle size={11} /> {error}
            </span>
          ) : resolvedHint ? (
            <span className="text-success">✓ {resolvedHint}</span>
          ) : isEan ? (
            <span className="text-text-muted">Detectado como EAN — buscando SKU...</span>
          ) : (
            <span className="text-text-muted">Tratando como SKU. Presiona Enter para buscar.</span>
          )}
        </div>
      )}
    </form>
  );
}
