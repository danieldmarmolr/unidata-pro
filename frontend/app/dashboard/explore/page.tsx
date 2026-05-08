"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { CellRenderer } from "@/components/drilldown-modal";
import { Download, ArrowDown, ArrowUp, RefreshCcw, Search } from "lucide-react";

type Result = { columns: string[]; rows: unknown[][]; row_count: number };

const CURRENCY_HINT = /total|amount|subtotal|revenue|commission|costo|precio|gmv|monto/i;
const NUMBER_HINT = /^(qty|cantidad|unidades|ordenes|orders|n|count|days|dias|stock|variantes|frec|frequency|recency)/i;
const DATE_HINT = /(fecha|date|creado|vence|created|updated)/i;

function formatCell(col: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return formatCurrency(v);
    if (NUMBER_HINT.test(col)) return formatNumber(v);
    return String(v);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toLocaleString("es-AR");
    } catch {}
  }
  return String(v);
}

function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [columns.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ExploreContent() {
  const sp = useSearchParams();
  const endpoint = sp.get("endpoint") ?? "";
  const title = sp.get("title") ?? "Analisis";
  const subtitle = sp.get("subtitle") ?? "";
  const filename = sp.get("filename") ?? "explore.csv";

  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data, isLoading, error, refetch, isFetching } = useQuery<Result>({
    queryKey: ["explore", endpoint],
    queryFn: () => api(endpoint),
    enabled: !!endpoint,
    staleTime: 30_000,
  });

  const filteredSorted = useMemo(() => {
    if (!data) return null;
    let rows = data.rows;
    if (search.trim()) {
      const lc = search.toLowerCase();
      rows = rows.filter((r) =>
        r.some((v) => v != null && String(v).toLowerCase().includes(lc)),
      );
    }
    if (sortCol !== null) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return rows;
  }, [data, search, sortCol, sortDir]);

  const onSortClick = (i: number) => {
    if (sortCol === i) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(i); setSortDir("asc"); }
  };

  return (
    <>
      <Topbar title={title} subtitle={subtitle || "Analisis completo - explorador"} hidePeriod />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="bg-surface border border-border rounded-xl flex flex-col h-[calc(100vh-160px)]">
          {/* Toolbar */}
          <div className="flex items-center gap-3 p-4 border-b border-border flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Filtrar en cualquier columna..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-border hover:border-primary hover:text-primary transition disabled:opacity-50"
            >
              <RefreshCcw size={13} className={isFetching ? "animate-spin" : ""} /> Refrescar
            </button>
            {data && data.rows.length > 0 && (
              <button
                onClick={() => downloadCsv(filename, data.columns, filteredSorted ?? data.rows)}
                className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white shadow"
              >
                <Download size={13} /> CSV
              </button>
            )}
            {data && (
              <div className="text-xs text-text-muted ml-auto">
                {formatNumber(filteredSorted?.length ?? data.row_count)} de {formatNumber(data.row_count)} filas
                {data.row_count >= 1000 && <span className="ml-1 text-amber-600">(limite 1000)</span>}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            {isLoading && <div className="p-12 text-center text-text-muted">Cargando...</div>}
            {error && (
              <div className="m-4 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm">
                Error: {(error as Error).message}
              </div>
            )}
            {data && filteredSorted && filteredSorted.length === 0 && !isLoading && (
              <div className="p-12 text-center text-text-muted text-sm">
                {search ? "Sin coincidencias para el filtro" : "Sin resultados"}
              </div>
            )}
            {data && filteredSorted && filteredSorted.length > 0 && (
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    {data.columns.map((c, i) => {
                      const sortedHere = sortCol === i;
                      return (
                        <th
                          key={c}
                          onClick={() => onSortClick(i)}
                          className="text-left px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-border/40"
                        >
                          <span className="inline-flex items-center gap-1">
                            {c}
                            {sortedHere && (sortDir === "asc" ? <ArrowUp size={9} /> : <ArrowDown size={9} />)}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((r, i) => (
                    <tr key={i} className="border-t border-border hover:bg-soft transition">
                      {r.map((v, j) => (
                        <td key={j} className="px-3 py-1.5 whitespace-nowrap font-mono text-[11px]">
                          <CellRenderer col={data.columns[j]} v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-text-muted">Cargando...</div>}>
      <ExploreContent />
    </Suspense>
  );
}
