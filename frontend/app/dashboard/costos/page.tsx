"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { api, getToken, getUser } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { UploadCloud, Trash2, RefreshCcw, AlertCircle } from "lucide-react";

type Lote = {
  id: number;
  lote: string;
  proveedor: string | null;
  fecha_ingreso: string | null;
  origen: string | null;
  envio: string | null;
  moneda: string | null;
  source_file: string | null;
  imported_at: string;
  imported_by: string;
  items_count: number;
  skus: number;
};

type Sku = {
  sku: string;
  producto: string | null;
  categoria: string | null;
  sub_categoria: string | null;
  cantidad: number | null;
  costo_total_sin_iva_usd: number | null;
  costo_con_iva_usd: number | null;
  precio_ars: number | null;
  pct_rentabilidad: number | null;
  lote: string;
  fecha_ingreso: string | null;
};

type UsdRate = {
  venta: number;
  compra: number | null;
  source: string;
  fetched_at: string;
  from_cache?: boolean;
  stale?: boolean;
};

type Tab = "import" | "lotes" | "skus";
type Currency = "ars" | "usd";

export default function CostosPage() {
  const [tab, setTab] = useState<Tab>("skus");
  const [currency, setCurrency] = useState<Currency>("ars");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const user = getUser();
  const isAdmin = user?.is_admin || user?.role === "admin";

  const { data: rate, refetch: refetchRate } = useQuery<UsdRate>({
    queryKey: ["costs", "usd-rate"],
    queryFn: () => api<UsdRate>("/api/costs/usd-rate"),
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <Topbar
        title="Costos de importacion"
        subtitle="Lotes · SKUs vigentes · Importacion CSV/XLSX desde la planilla SharePoint"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "skus", label: "SKUs vigentes" },
              { value: "lotes", label: "Lotes" },
              { value: "import", label: "Importar" },
            ]}
          />
          <div className="flex items-center gap-3">
            <Segmented<Currency>
              value={currency}
              onChange={setCurrency}
              options={[
                { value: "ars", label: "ARS" },
                { value: "usd", label: "USD" },
              ]}
            />
            {rate && (
              <div
                className="flex items-center gap-2 text-xs text-text-muted bg-surface border border-border rounded-lg px-3 py-2"
                title={`Fuente: ${rate.source} · ${new Date(rate.fetched_at).toLocaleString("es-AR")}${rate.stale ? " (stale)" : ""}`}
              >
                <span className="font-semibold text-text">USD venta:</span>
                <span className="font-bold text-primary">$ {rate.venta.toFixed(2)}</span>
                <button
                  onClick={() => refetchRate()}
                  className="ml-1 hover:text-text"
                  title="Refrescar cotizacion BNA"
                >
                  <RefreshCcw size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {tab === "skus" && (
          <SkusTab
            search={search}
            setSearch={setSearch}
            currency={currency}
            rate={rate}
          />
        )}
        {tab === "lotes" && <LotesTab isAdmin={isAdmin} onChanged={() => qc.invalidateQueries({ queryKey: ["costs"] })} />}
        {tab === "import" && (
          <ImportTab
            isAdmin={isAdmin}
            onImported={() => {
              qc.invalidateQueries({ queryKey: ["costs"] });
              setTab("lotes");
            }}
          />
        )}
      </div>
    </>
  );
}

// ============================================================
// SKUs TAB
// ============================================================
function SkusTab({
  search,
  setSearch,
  currency,
  rate,
}: {
  search: string;
  setSearch: (s: string) => void;
  currency: Currency;
  rate?: UsdRate;
}) {
  const { data, isLoading } = useQuery<{ rows: Sku[]; usd_rate: UsdRate | null }>({
    queryKey: ["costs", "current", search],
    queryFn: () => api(`/api/costs/current?search=${encodeURIComponent(search)}&limit=1000`),
  });

  const fmtCost = (usd: number | null | undefined) => {
    if (usd === null || usd === undefined) return "—";
    if (currency === "usd") return `US$ ${usd.toFixed(2)}`;
    if (rate?.venta) return formatCurrency(usd * rate.venta);
    return `US$ ${usd.toFixed(2)}`;
  };

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Buscar SKU o producto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg text-sm w-80 focus:ring-1 focus:ring-primary outline-none"
        />
        <div className="text-xs text-text-muted">
          {data?.rows.length ?? 0} SKUs cargados
        </div>
      </div>
      {isLoading ? (
        <div className="p-12 text-center text-text-muted text-sm">Cargando...</div>
      ) : !data?.rows.length ? (
        <div className="p-12 text-center text-text-muted text-sm">
          {search ? "Sin coincidencias." : "Aun no hay costos cargados. Ir a la tab \"Importar\"."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted bg-soft">
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2 text-right">Costo c/IVA</th>
                <th className="px-4 py-2 text-right">Costo s/IVA</th>
                <th className="px-4 py-2 text-right">Precio sug.</th>
                <th className="px-4 py-2 text-right">% Rent</th>
                <th className="px-4 py-2">Lote</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.sku} className="border-t border-border hover:bg-soft transition">
                  <td className="px-4 py-2 font-mono font-semibold">
                    <Link
                      href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                      className="hover:text-primary"
                    >
                      {r.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-text-muted truncate max-w-[260px]" title={r.producto ?? ""}>
                    {r.producto || "—"}
                  </td>
                  <td className="px-4 py-2 text-text-muted text-xs">
                    {r.categoria || "—"}
                    {r.sub_categoria && <div className="text-[10px] text-text-muted">{r.sub_categoria}</div>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmtCost(r.costo_con_iva_usd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmtCost(r.costo_total_sin_iva_usd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.precio_ars ? formatCurrency(r.precio_ars) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.pct_rentabilidad !== null ? `${r.pct_rentabilidad.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted">{r.lote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOTES TAB
// ============================================================
function LotesTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const { data, isLoading } = useQuery<Lote[]>({
    queryKey: ["costs", "lotes"],
    queryFn: () => api<Lote[]>("/api/costs/lotes"),
  });

  async function deleteLote(l: Lote) {
    if (!confirm(`Eliminar lote "${l.lote}" con ${l.items_count} items? Esta accion no se puede deshacer.`)) return;
    try {
      await api(`/api/costs/lotes/${l.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {isLoading ? (
        <div className="p-12 text-center text-text-muted text-sm">Cargando...</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-text-muted text-sm">
          Aun no hay lotes importados. Ir a la tab \"Importar\".
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted bg-soft">
              <th className="px-4 py-2">Lote</th>
              <th className="px-4 py-2">Proveedor</th>
              <th className="px-4 py-2">Fecha ingreso</th>
              <th className="px-4 py-2">Origen</th>
              <th className="px-4 py-2">Envio</th>
              <th className="px-4 py-2 text-right">Items</th>
              <th className="px-4 py-2 text-right">SKUs</th>
              <th className="px-4 py-2">Importado por</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="border-t border-border hover:bg-soft transition">
                <td className="px-4 py-2 font-mono font-semibold">{l.lote}</td>
                <td className="px-4 py-2">{l.proveedor || "—"}</td>
                <td className="px-4 py-2 text-text-muted">{l.fecha_ingreso || "—"}</td>
                <td className="px-4 py-2 text-text-muted">{l.origen || "—"}</td>
                <td className="px-4 py-2 text-text-muted">{l.envio || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(l.items_count)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(l.skus)}</td>
                <td className="px-4 py-2 text-xs text-text-muted">
                  <div>{l.imported_by}</div>
                  <div className="text-[10px]">{new Date(l.imported_at).toLocaleString("es-AR")}</div>
                </td>
                <td className="px-4 py-2">
                  {isAdmin && (
                    <button
                      onClick={() => deleteLote(l)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-error hover:bg-red-50"
                    >
                      <Trash2 size={12} /> Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// IMPORT TAB
// ============================================================
function ImportTab({ isAdmin, onImported }: { isAdmin: boolean; onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    summary: { lote: string; items: number; replaced: boolean }[];
    total_rows: number;
    lotes_count: number;
    errors: string[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-6 text-sm flex items-start gap-3">
        <AlertCircle size={18} className="shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Solo administradores pueden importar lotes.</div>
          <div className="text-xs mt-1">Pedi al admin que cargue el archivo, los datos quedan disponibles para todos los usuarios al momento.</div>
        </div>
      </div>
    );
  }

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      // Detectar extension y rutear al endpoint correcto.
      // Excel (xlsx/xlsm) -> /import-excel (parser dedicado para "VALOR PRODUCTO.xlsx")
      // CSV/TSV/TXT -> /import (parser CSV generico)
      const isExcel = /\.(xlsx|xlsm)$/i.test(file.name);
      const endpoint = isExcel ? "/api/costs/import-excel" : "/api/costs/import";
      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(j.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Normalizar shape: el endpoint Excel usa nombres distintos
      if (isExcel) {
        const excelResult = data as {
          rows_total?: number;
          lotes_processed?: number;
          items_imported?: number;
          lote_results?: Array<{ lote: string; items_count?: number; replaced?: boolean; error?: string }>;
        };
        setResult({
          total_rows: excelResult.items_imported ?? excelResult.rows_total ?? 0,
          lotes_count: excelResult.lotes_processed ?? 0,
          summary: (excelResult.lote_results ?? []).map((r) => ({
            lote: r.lote,
            items: r.items_count ?? 0,
            replaced: r.replaced ?? false,
          })),
          errors: (excelResult.lote_results ?? [])
            .filter((r) => r.error)
            .map((r) => `${r.lote}: ${r.error}`),
        });
      } else {
        setResult(data);
      }
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-surface border-2 border-dashed border-border rounded-xl p-12 text-center">
        <UploadCloud size={48} className="mx-auto text-text-muted mb-4 opacity-60" />
        <div className="text-base font-semibold text-text mb-1">Importar planilla de costos</div>
        <div className="text-sm text-text-muted mb-6">
          <strong>Excel</strong> (.xlsx) — para el archivo oficial "VALOR PRODUCTO.xlsx" (hoja "VALOR COMPRA Y PESO").<br />
          <strong>CSV / TSV</strong> — para imports genericos.<br />
          Los lotes se reemplazan si subis el mismo nombre dos veces.
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md hover:shadow-lg transition disabled:opacity-50"
        >
          <UploadCloud size={16} />
          {busy ? "Procesando..." : "Elegir archivo"}
        </button>

        {err && (
          <div className="mt-6 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm text-left">
            <strong>Error:</strong> {err}
          </div>
        )}

        {result && (
          <div className="mt-6 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-4 py-4 text-sm text-left">
            <div className="font-semibold mb-2">
              ✓ {result.total_rows} filas procesadas en {result.lotes_count} lote(s)
            </div>
            <ul className="text-xs space-y-1 ml-2">
              {result.summary.map((s) => (
                <li key={s.lote}>
                  <strong>{s.lote}</strong>: {s.items} items
                  {s.replaced && <span className="ml-2 text-amber-700">(reemplazado)</span>}
                </li>
              ))}
            </ul>
            {result.errors.length > 0 && (
              <div className="mt-3 text-amber-800 text-xs">
                Avisos: {result.errors.join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold mb-3">Como funciona</div>
        <ul className="text-xs text-text-muted space-y-2 leading-relaxed">
          <li>• <strong>Detecta el lote</strong> a partir de la columna "Lote".</li>
          <li>• <strong>Mapea SKU2 → sku</strong> y "valor maximo" / "Costo Total S/IVA" / "Costo con IVA" / "Precio" / "% Rentab" automaticamente.</li>
          <li>• Si subis dos veces el mismo lote, se <strong>reemplazan los items</strong> (no duplica).</li>
          <li>• El payload completo de las 52 columnas queda guardado en raw_payload por SKU para auditoria.</li>
          <li>• La cotizacion <strong>USD/ARS se obtiene de BNA</strong> (cache 1h) y se usa para mostrar costos en pesos.</li>
        </ul>
      </div>
    </div>
  );
}
