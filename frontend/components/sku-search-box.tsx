"use client";

import { useEffect, useRef, useState } from "react";
import { Search, ScanBarcode, Loader2, AlertCircle, ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import { looksLikeEan, lookupByEan, type SkuLookupResult } from "@/lib/use-sku-enrichment";

type Props = {
  unit: string;
  placeholder?: string;
  /** Se llama cuando el user elige un resultado o resolvio un EAN completo */
  onSkuSelected: (sku: string, info?: SkuLookupResult) => void;
  autoFocus?: boolean;
  debounceMs?: number;
};

type SearchResult = {
  sku: string;
  name: string;
  image_url: string | null;
  ean: string | null;
};

/**
 * Buscador inteligente de SKU/EAN.
 *
 * Modo SKU (lo que tipea el user no parece EAN completo):
 *  - Mientras tipea (>= 2 chars), llama a /api/skus/{unit}/search y muestra
 *    un dropdown con thumbnails + nombre + SKU + EAN. Click selecciona.
 *  - Teclado: ArrowUp/Down navega, Enter selecciona el highlighted.
 *
 * Modo EAN (input es numerico de 8/12/13/14 digitos):
 *  - Hace POST /lookup-by-ean automaticamente (debounced) y dispara el
 *    onSkuSelected con el SKU resuelto - se usa para lectores de codigo
 *    de barra que tipean el numero + Enter.
 */
export function SkuSearchBox({
  unit,
  placeholder = "Buscar por SKU o escanear EAN...",
  onSkuSelected,
  autoFocus = false,
  debounceMs = 250,
}: Props) {
  const [value, setValue] = useState("");
  const [debouncedValue, setDebouncedValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedHint, setResolvedHint] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounce del input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [value, debounceMs]);

  const isEan = looksLikeEan(value);

  // Path EAN: resolver automaticamente
  useEffect(() => {
    setError(null);
    setResolvedHint(null);
    if (!debouncedValue || !looksLikeEan(debouncedValue)) return;
    let cancelled = false;
    setResolving(true);
    setShowDropdown(false);
    lookupByEan(unit, debouncedValue)
      .then((r) => {
        if (cancelled) return;
        setResolvedHint(`${r.sku} - ${(r.name || "").slice(0, 40)}`);
        onSkuSelected(r.sku, r);
        setValue(""); // limpia el input despues de seleccionar
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "EAN no encontrado");
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [debouncedValue, unit, onSkuSelected]);

  // Path SKU: autocomplete dropdown
  useEffect(() => {
    setError(null);
    setResolvedHint(null);
    if (!debouncedValue || looksLikeEan(debouncedValue) || debouncedValue.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setResolving(true);
    api<SearchResult[]>(`/api/skus/${unit}/search?q=${encodeURIComponent(debouncedValue)}&limit=12`)
      .then((r) => {
        if (cancelled) return;
        setResults(r);
        setHighlightIdx(0);
        setShowDropdown(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error buscando");
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [debouncedValue, unit]);

  // Click fuera -> cerrar dropdown
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(r: SearchResult) {
    setShowDropdown(false);
    setValue("");
    onSkuSelected(r.sku, {
      sku: r.sku,
      image_url: r.image_url,
      ean: r.ean,
      name: r.name,
      is_service: false,
      kind: "product",
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || results.length === 0) {
      if (e.key === "Enter" && value.trim() && !isEan) {
        // Sin resultados pero el user tipeo algo - usar como SKU literal
        e.preventDefault();
        onSkuSelected(value.trim());
        setValue("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick_ = results[highlightIdx] ?? results[0];
      if (pick_) pick(pick_);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  return (
    <div ref={containerRef} className="w-full relative">
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted z-10">
          {isEan ? <ScanBarcode size={16} /> : <Search size={16} />}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition font-mono text-sm"
        />
        {resolving && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-primary z-10">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown autocomplete - solo en modo SKU */}
      {showDropdown && results.length > 0 && !isEan && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-lg shadow-xl max-h-[400px] overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={r.sku}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={
                "w-full flex items-center gap-3 px-3 py-2 text-left transition " +
                (i === highlightIdx ? "bg-soft" : "hover:bg-soft/60")
              }
            >
              <div className="w-10 h-10 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <ImageOff size={14} className="text-text-muted/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text truncate">{r.name || "(sin nombre)"}</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-primary font-bold">{r.sku}</span>
                  {r.ean && (
                    <span
                      className="text-[10px] font-mono inline-flex items-center gap-0.5 px-1 rounded bg-amber-50 text-amber-800 border border-amber-200/60"
                      title="EAN - codigo de barras"
                    >
                      <span className="text-[8px] font-bold">EAN</span> {r.ean}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Mensaje "sin resultados" */}
      {showDropdown && debouncedValue.length >= 2 && results.length === 0 && !resolving && !isEan && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-lg shadow-xl p-4 text-xs text-text-muted text-center">
          Sin resultados para <strong>{debouncedValue}</strong>. Presiona Enter para buscar literal.
        </div>
      )}

      {/* Hint visual / errores */}
      {value && (
        <div className="mt-1 text-[11px] flex items-center gap-2">
          {error ? (
            <span className="text-error flex items-center gap-1">
              <AlertCircle size={11} /> {error}
            </span>
          ) : resolvedHint ? (
            <span className="text-success">✓ {resolvedHint}</span>
          ) : isEan ? (
            <span className="text-text-muted">Detectado como EAN - buscando SKU automaticamente...</span>
          ) : (
            <span className="text-text-muted">{results.length > 0 ? `${results.length} match · ↑↓ para navegar · Enter para abrir` : "Tipea al menos 2 caracteres"}</span>
          )}
        </div>
      )}
    </div>
  );
}
