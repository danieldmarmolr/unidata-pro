"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ImageOff, ArrowUp, ArrowDown } from "lucide-react";
import { ExportButtons } from "@/components/export-buttons";
import { formatCurrency, formatNumber } from "@/lib/utils";

export type SkuRow = {
  rank: number;
  sku: string;
  name: string;
  brand: string;
  ean: string;
  imagen: string;
  units: number;
  revenue: number;
  orders: number;
  customers: number;
  precio_avg: number;
  ganancia: number | null;
  margen_pct: number | null;
  abc: "A" | "B" | "C";
  pct_acum: number;
  xyz: "X" | "Y" | "Z" | null;
  cv: number | null;
  lifecycle: "nuevo" | "growth" | "maduro" | "declive" | "dormido";
  doi: number | null;
  doi_bucket: "rapido" | "normal" | "lento" | "muerto" | null;
  stock_actual: number;
  ventas_dia_avg: number;
  growth_30d_pct: number | null;
  returns_rate_pct: number | null;
  is_new_7d: boolean;
  is_stockout_risk_14d: boolean;
};

type SortKey = "rank" | "revenue" | "ganancia" | "margen_pct" | "units" | "orders"
  | "stock_actual" | "doi" | "growth_30d_pct" | "returns_rate_pct";

type Filter = "all" | "with-stock" | "no-stock" | "abc-a" | "abc-b" | "abc-c"
  | "stockout-risk" | "new-7d" | "growth" | "decline" | "dead-stock";

const ABC_COLOR: Record<string, string> = {
  A: "#10b981", B: "#f59e0b", C: "#94a3b8",
};
const XYZ_COLOR: Record<string, string> = {
  X: "#06b6d4", Y: "#8b5cf6", Z: "#ef4444",
};
const LIFECYCLE_COLOR: Record<string, string> = {
  nuevo: "#a259ff", growth: "#10b981", maduro: "#06b6d4", declive: "#f59e0b", dormido: "#94a3b8",
};
const DOI_COLOR: Record<string, string> = {
  rapido: "#10b981", normal: "#06b6d4", lento: "#f59e0b", muerto: "#ef4444",
};

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold text-white uppercase tracking-wide"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

export function SkuMasterTable({
  data,
  summary,
}: {
  data: SkuRow[];
  summary: {
    total_skus: number;
    total_revenue: number;
    total_ganancia: number;
    skus_clase_a: number;
    skus_growth: number;
    skus_declive: number;
    skus_nuevos_7d: number;
    skus_stockout_risk: number;
  };
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [limit, setLimit] = useState(100);

  const filtered = useMemo(() => {
    let rows = data;
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter(
        (r) =>
          r.sku?.toLowerCase().includes(s) ||
          r.name?.toLowerCase().includes(s) ||
          r.ean?.toLowerCase().includes(s) ||
          r.brand?.toLowerCase().includes(s),
      );
    }
    switch (filter) {
      case "with-stock": rows = rows.filter((r) => r.stock_actual > 0); break;
      case "no-stock": rows = rows.filter((r) => r.stock_actual === 0); break;
      case "abc-a": rows = rows.filter((r) => r.abc === "A"); break;
      case "abc-b": rows = rows.filter((r) => r.abc === "B"); break;
      case "abc-c": rows = rows.filter((r) => r.abc === "C"); break;
      case "stockout-risk": rows = rows.filter((r) => r.is_stockout_risk_14d); break;
      case "new-7d": rows = rows.filter((r) => r.is_new_7d); break;
      case "growth": rows = rows.filter((r) => (r.growth_30d_pct ?? 0) >= 30); break;
      case "decline": rows = rows.filter((r) => (r.growth_30d_pct ?? 0) <= -30); break;
      case "dead-stock": rows = rows.filter((r) => r.doi_bucket === "muerto"); break;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = (a[sortKey] ?? 0) as number;
      const vb = (b[sortKey] ?? 0) as number;
      if (va === vb) return a.rank - b.rank;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [data, filter, search, sortKey, sortDir]);

  const visible = filtered.slice(0, limit);

  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "rank" ? "asc" : "desc");
    }
  };

  const Hdr = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th
      onClick={() => onSort(k)}
      className={`px-2 py-2 cursor-pointer select-none hover:bg-soft/80 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <div className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {sortKey === k && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </div>
    </th>
  );

  const FILTER_CHIPS: Array<{ value: Filter; label: string; count?: number }> = [
    { value: "all", label: "Todos", count: data.length },
    { value: "abc-a", label: "Clase A", count: summary.skus_clase_a },
    { value: "stockout-risk", label: "Stockout 14d", count: summary.skus_stockout_risk },
    { value: "new-7d", label: "Nuevos 7d", count: summary.skus_nuevos_7d },
    { value: "growth", label: "En crecimiento", count: summary.skus_growth },
    { value: "decline", label: "En declive", count: summary.skus_declive },
    { value: "dead-stock", label: "Stock muerto", count: data.filter((r) => r.doi_bucket === "muerto").length },
    { value: "with-stock", label: "Con stock" },
    { value: "no-stock", label: "Sin stock" },
  ];

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-text">Tabla maestra por SKU</h3>
            <p className="text-[11px] text-text-muted">
              {formatNumber(filtered.length)} SKUs · click en una fila para ver el SKU 360 · 17 dimensiones cruzadas
            </p>
          </div>
          <ExportButtons
            filename="tabla_maestra_skus"
            columns={[
              "#", "SKU", "Nombre", "EAN", "Marca", "Unid", "Revenue", "Ganancia", "Margen%",
              "Ordenes", "Clientes", "PrecioAvg", "ABC", "%Acum", "XYZ", "CV", "Lifecycle",
              "DoI", "Stock", "Ventas/dia", "Growth30d%", "Returns%",
            ]}
            rows={filtered.map((r) => [
              r.rank, r.sku, r.name, r.ean, r.brand, r.units, r.revenue, r.ganancia ?? "",
              r.margen_pct ?? "", r.orders, r.customers, r.precio_avg, r.abc, r.pct_acum,
              r.xyz ?? "", r.cv ?? "", r.lifecycle, r.doi ?? "", r.stock_actual,
              r.ventas_dia_avg, r.growth_30d_pct ?? "", r.returns_rate_pct ?? "",
            ])}
          />
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar SKU, nombre, EAN o marca…"
            className="px-3 py-1.5 text-xs border border-border rounded-lg w-[280px] focus:outline-none focus:border-primary"
          />
          {FILTER_CHIPS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={
                "px-2.5 py-1 text-[11px] rounded-md transition border " +
                (filter === f.value
                  ? "bg-primary text-white border-primary"
                  : "bg-soft text-text-muted border-transparent hover:border-primary/40")
              }
            >
              {f.label}
              {typeof f.count === "number" && <span className="ml-1 opacity-70">({f.count})</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
            <tr>
              <Hdr k="rank" label="#" align="right" />
              <th className="text-left px-2 py-2">Producto</th>
              <Hdr k="units" label="Unid" />
              <Hdr k="orders" label="Ord" />
              <Hdr k="revenue" label="Revenue" />
              <Hdr k="ganancia" label="Ganancia" />
              <Hdr k="margen_pct" label="Mrgn%" />
              <th className="text-center px-2 py-2">ABC</th>
              <th className="text-center px-2 py-2">XYZ</th>
              <th className="text-center px-2 py-2">Lifecycle</th>
              <Hdr k="doi" label="DoI" />
              <Hdr k="stock_actual" label="Stock" />
              <Hdr k="growth_30d_pct" label="Growth30d" />
              <Hdr k="returns_rate_pct" label="Ret%" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.sku} className="border-t border-border hover:bg-soft/40">
                <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{r.rank}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                      {r.imagen ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.imagen} alt={r.name} className="w-full h-full object-cover" loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <ImageOff size={12} className="text-text-muted/40" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                        className="text-primary hover:underline font-medium block truncate max-w-[260px]"
                        title={r.name}
                      >
                        {r.name}
                        {r.is_new_7d && (
                          <span className="ml-1.5 inline-block text-[8px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-700 align-middle">
                            NUEVO 7d
                          </span>
                        )}
                      </Link>
                      <div className="text-[9px] text-text-muted/70 font-mono truncate max-w-[260px]">
                        {r.sku}{r.ean ? ` · EAN ${r.ean}` : ""}{r.brand ? ` · ${r.brand}` : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(r.units)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(r.orders)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-bold">{formatCurrency(r.revenue)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.ganancia !== null ? (
                    <span className="font-bold text-emerald-700">{formatCurrency(r.ganancia)}</span>
                  ) : (
                    <span className="text-text-muted/40">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.margen_pct !== null ? `${r.margen_pct}%` : <span className="text-text-muted/40">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center"><Chip label={r.abc} color={ABC_COLOR[r.abc]} /></td>
                <td className="px-2 py-1.5 text-center">
                  {r.xyz ? <Chip label={r.xyz} color={XYZ_COLOR[r.xyz]} /> : <span className="text-text-muted/40">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Chip label={r.lifecycle} color={LIFECYCLE_COLOR[r.lifecycle] ?? "#94a3b8"} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.doi !== null ? (
                    <span style={{ color: DOI_COLOR[r.doi_bucket ?? "normal"] }} className="font-bold">{r.doi}d</span>
                  ) : <span className="text-text-muted/40">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(r.stock_actual)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.growth_30d_pct !== null ? (
                    <span className={r.growth_30d_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                      {r.growth_30d_pct >= 0 ? "+" : ""}{r.growth_30d_pct}%
                    </span>
                  ) : <span className="text-text-muted/40">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.returns_rate_pct !== null && r.returns_rate_pct !== undefined ? (
                    <span className={
                      r.returns_rate_pct >= 15 ? "text-rose-700 font-bold"
                      : r.returns_rate_pct >= 5 ? "text-amber-700 font-bold"
                      : "text-emerald-700"
                    }>{r.returns_rate_pct}%</span>
                  ) : <span className="text-text-muted/40">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={14} className="text-center py-8 text-text-muted">Sin SKUs que coincidan con los filtros</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > limit && (
        <div className="px-4 py-2 border-t border-border bg-soft/40 text-center">
          <button
            onClick={() => setLimit(limit + 200)}
            className="text-xs text-primary hover:underline font-semibold"
          >
            Ver más ({filtered.length - limit} restantes) →
          </button>
        </div>
      )}
    </div>
  );
}
