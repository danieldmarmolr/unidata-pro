"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, ScanBarcode, User, Package, Truck, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { looksLikeEan, lookupByEan } from "@/lib/use-sku-enrichment";

/**
 * SmartSearch — buscador inteligente embebido por area.
 *
 * Modes:
 *  - "customers" (CS):     busca clientes Unistore por nombre/email/tel/id
 *  - "skus" (Producto):    busca SKUs por texto, EAN completo auto-resuelve
 *  - "orders" (Logistica): busca orden TN por numero, scaneo EAN abre SKU
 *
 * Visual: card hero con icono + input + dropdown de resultados con thumbnails.
 * Reusable arriba de cualquier dashboard relevante.
 */

type Mode = "customers" | "skus" | "orders";

type Props = {
  mode: Mode;
  /** unit = unistore | unidrop (afecta donde se busca) */
  unit?: "unistore" | "unidrop";
  /** Variante visual: hero grande o compact (inline en topbar/sidebar) */
  variant?: "hero" | "compact";
  /** Custom placeholder, sino se autodetecta segun mode */
  placeholder?: string;
};

type CustomerResult = {
  id: number;
  nombre: string;
  email: string;
  provincia: string;
  ordenes_pagas_lifetime: number;
};

type SkuResult = {
  sku: string;
  name: string;
  image_url: string | null;
  ean: string | null;
};

type OrderResult = {
  id: number;
  numero: string;
  fecha: string;
  total: number;
  cliente: string;
  provincia: string;
  payment: string;
};

const MODE_CONFIG: Record<Mode, {
  icon: any;
  title: string;
  subtitle: string;
  placeholder: string;
  gradient: string;
}> = {
  customers: {
    icon: User,
    title: "Buscar cliente",
    subtitle: "Por nombre, email, teléfono o ID · abre Customer 360",
    placeholder: "Ej: Pablo Amezcua, gmail.com, 11...",
    gradient: "from-violet-500 to-fuchsia-500",
  },
  skus: {
    icon: Package,
    title: "Buscar SKU o escanear EAN",
    subtitle: "Tipea SKU o nombre de producto · scaneo automático con código de barras",
    placeholder: "Ej: M25N, auriculares, 1000010800015",
    gradient: "from-emerald-500 to-teal-500",
  },
  orders: {
    icon: Truck,
    title: "Buscar pedido o escanear EAN",
    subtitle: "Número de orden TN o scaneo de producto físico",
    placeholder: "Ej: #56303, M25N, 1000010800015",
    gradient: "from-blue-500 to-cyan-500",
  },
};

export function SmartSearch({
  mode,
  unit = "unistore",
  variant = "hero",
  placeholder,
}: Props) {
  const router = useRouter();
  const cfg = MODE_CONFIG[mode];
  const Icon = cfg.icon;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const isEan = looksLikeEan(query);

  // Path EAN completo (modo skus / orders): auto-navigate al producto
  useEffect(() => {
    if (!debounced || !looksLikeEan(debounced)) return;
    if (mode === "customers") return; // EAN no aplica a clientes
    let cancel = false;
    setLoading(true);
    setError(null);
    lookupByEan(unit, debounced)
      .then((r) => {
        if (cancel) return;
        router.push(`/dashboard/productos/${encodeURIComponent(r.sku)}`);
        setQuery("");
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : "EAN no encontrado");
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [debounced, mode, unit, router]);

  // Path texto: query al endpoint correspondiente
  useEffect(() => {
    setError(null);
    if (!debounced || debounced.length < 2 || looksLikeEan(debounced)) {
      setResults([]);
      return;
    }
    let cancel = false;
    setLoading(true);
    let endpoint = "";
    if (mode === "customers") {
      endpoint = `/api/dashboards/search/unistore-customers?q=${encodeURIComponent(debounced)}&period=12m&limit=10`;
    } else if (mode === "skus") {
      endpoint = `/api/skus/${unit}/search?q=${encodeURIComponent(debounced)}&limit=10`;
    } else {
      // orders: usa search de orden por number (no hay endpoint dedicado aun;
      // fallback: probar customers search por si tipea cliente)
      endpoint = `/api/dashboards/search/unistore-customers?q=${encodeURIComponent(debounced)}&period=12m&limit=5`;
    }
    api<any>(endpoint)
      .then((r) => {
        if (cancel) return;
        // Unstore-customers devuelve {rows}, skus search devuelve array
        setResults(Array.isArray(r) ? r : (r.rows ?? []));
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [debounced, mode, unit]);

  function pickResult(r: any) {
    if (mode === "customers") {
      router.push(`/dashboard/customer/${(r as CustomerResult).id}`);
    } else if (mode === "skus") {
      router.push(`/dashboard/productos/${encodeURIComponent((r as SkuResult).sku)}`);
    }
    setQuery("");
    setResults([]);
  }

  const containerCls = variant === "hero"
    ? "bg-surface border border-border rounded-2xl p-5 shadow-sm"
    : "bg-surface border border-border rounded-xl p-3";

  return (
    <div className={containerCls + " relative"}>
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cfg.gradient} text-white flex items-center justify-center shadow-md flex-shrink-0`}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          {variant === "hero" && (
            <>
              <div className="text-sm font-bold text-text">{cfg.title}</div>
              <div className="text-xs text-text-muted mt-0.5 mb-3">{cfg.subtitle}</div>
            </>
          )}
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {isEan ? <ScanBarcode size={16} /> : <Search size={16} />}
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder ?? cfg.placeholder}
              className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition font-mono text-sm"
              autoComplete="off"
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
          </div>
          {error && (
            <div className="text-[11px] text-error mt-1.5">{error}</div>
          )}
          {isEan && !error && (
            <div className="text-[11px] text-text-muted mt-1.5">Detectado como EAN — buscando SKU automáticamente...</div>
          )}
        </div>
      </div>

      {/* Dropdown de resultados */}
      {results.length > 0 && !isEan && (
        <div className="mt-3 border-t border-border pt-2 max-h-[400px] overflow-y-auto">
          {mode === "customers" && (results as CustomerResult[]).map((r) => (
            <button
              key={r.id}
              onClick={() => pickResult(r)}
              className="w-full text-left px-3 py-2 hover:bg-soft rounded-lg transition flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text truncate">{r.nombre}</div>
                <div className="text-[11px] text-text-muted">
                  {r.email} {r.provincia && `· ${r.provincia}`}
                </div>
              </div>
              <div className="text-[10px] text-text-muted shrink-0">{r.ordenes_pagas_lifetime} órd.</div>
            </button>
          ))}
          {mode === "skus" && (results as SkuResult[]).map((r) => (
            <button
              key={r.sku}
              onClick={() => pickResult(r)}
              className="w-full text-left px-3 py-2 hover:bg-soft rounded-lg transition flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-md bg-soft border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <Package size={14} className="text-text-muted/40" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text truncate">{r.name || r.sku}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-primary font-bold">{r.sku}</span>
                  {r.ean && <span className="text-[10px] font-mono text-amber-700">EAN {r.ean}</span>}
                </div>
              </div>
            </button>
          ))}
          {mode === "orders" && (
            <div className="px-3 py-3 text-xs text-text-muted">
              Buscador de pedidos: ingresá número de orden TN o escaneá EAN para abrir el SKU.
              Si querés un cliente, usá la pestaña Customer Success.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
