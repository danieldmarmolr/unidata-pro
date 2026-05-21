"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  /** Identificador unico de la columna (no necesariamente una key del row). */
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Render custom de la celda. Si no se pasa, muestra `getValue(row)` como string. */
  render?: (row: T) => React.ReactNode;
  /** Valor para sort + filtro. Si no se pasa, intenta `row[key]`. */
  getValue?: (row: T) => string | number | null | undefined | boolean;
  /** Si filterable=false, no muestra input de filtro debajo del header. Default true. */
  filterable?: boolean;
  /** Si sortable=false, no permite click para ordenar. Default true. */
  sortable?: boolean;
  /** Tipo del valor (number o string). Default 'string'. Solo afecta el sort. */
  type?: "string" | "number" | "date";
  /** Clase extra opcional. */
  className?: string;
  /** Ancho aproximado (ej. "w-32"). */
  width?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  data,
  columns,
  rowKey,
  renderActions,
  emptyLabel = "Sin resultados",
  defaultSort,
  maxHeight,
  className,
}: {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  renderActions?: (row: T) => React.ReactNode;
  emptyLabel?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Si se pasa, la tabla scrollea vertical con header sticky (ej. "max-h-[500px]"). */
  maxHeight?: string;
  className?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);
  const [showFilters, setShowFilters] = useState(false);

  const getCol = (key: string) => columns.find((c) => c.key === key);

  function getValue(row: T, col: Column<T>): string | number | null | undefined | boolean {
    if (col.getValue) return col.getValue(row);
    // intentar row[key] como fallback
    const v = (row as unknown as Record<string, unknown>)[col.key];
    return v as string | number | null | undefined | boolean;
  }

  const filtered = useMemo(() => {
    return data.filter((row) => {
      for (const col of columns) {
        const f = filters[col.key];
        if (!f) continue;
        const v = getValue(row, col);
        if (v === null || v === undefined) return false;
        const text = String(v).toLowerCase();
        if (!text.includes(f.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, filters, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = getCol(sort.key);
    if (!col) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = getValue(a, col);
      const vb = getValue(b, col);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      let cmp: number;
      if (col.type === "number") {
        cmp = Number(va) - Number(vb);
      } else if (col.type === "date") {
        cmp = new Date(String(va)).getTime() - new Date(String(vb)).getTime();
      } else {
        cmp = String(va).localeCompare(String(vb), "es", { numeric: true });
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort, columns]);

  function toggleSort(col: Column<T>) {
    if (col.sortable === false) return;
    setSort((s) => {
      if (!s || s.key !== col.key) return { key: col.key, dir: "asc" };
      if (s.dir === "asc") return { key: col.key, dir: "desc" };
      return null;
    });
  }

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  return (
    <div className={cn("rounded-xl border border-border bg-surface overflow-hidden", className)}>
      <div className="px-3 py-2 border-b border-border bg-soft flex items-center justify-between gap-2 text-xs">
        <div className="text-text-muted">
          {sorted.length} de {data.length} {sorted.length === 1 ? "fila" : "filas"}
          {hasActiveFilters && <span className="ml-2 text-primary font-semibold">· filtros activos</span>}
          {sort && (
            <span className="ml-2 text-primary font-semibold">
              · orden: {getCol(sort.key)?.label} ({sort.dir})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="px-2 py-1 rounded text-text-muted hover:text-text hover:bg-surface flex items-center gap-1"
              title="Limpiar filtros"
            >
              <X size={11} /> Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "px-2 py-1 rounded flex items-center gap-1 transition",
              showFilters ? "bg-primary text-white" : "text-text-muted hover:text-text hover:bg-surface",
            )}
            title={showFilters ? "Ocultar filtros" : "Mostrar filtros"}
          >
            <Filter size={11} /> Filtros
          </button>
        </div>
      </div>
      <div className={cn("overflow-x-auto", maxHeight && `${maxHeight} overflow-y-auto`)}>
        <table className="w-full text-sm">
          <thead className={cn("bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted", maxHeight && "sticky top-0 z-10")}>
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const SortIcon = isSorted ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3 py-2 whitespace-nowrap",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      !col.align && "text-left",
                      sortable && "cursor-pointer select-none hover:text-text",
                      col.width,
                    )}
                    onClick={() => sortable && toggleSort(col)}
                  >
                    <div className={cn(
                      "flex items-center gap-1",
                      col.align === "right" && "justify-end",
                      col.align === "center" && "justify-center",
                    )}>
                      <span>{col.label}</span>
                      {sortable && (
                        <SortIcon
                          size={11}
                          className={cn(
                            "shrink-0 transition",
                            isSorted ? "text-primary opacity-100" : "opacity-40",
                          )}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
              {renderActions && <th className="px-3 py-2 text-right w-20">Acciones</th>}
            </tr>
            {showFilters && (
              <tr className="border-t border-border bg-surface">
                {columns.map((col) => {
                  const filterable = col.filterable !== false;
                  if (!filterable) return <th key={col.key} className="px-2 py-1.5" />;
                  return (
                    <th key={col.key} className="px-2 py-1.5">
                      <input
                        type="text"
                        value={filters[col.key] ?? ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                        placeholder="Filtrar..."
                        className="w-full px-2 py-1 border border-border rounded text-xs font-normal normal-case tracking-normal focus:ring-1 focus:ring-primary outline-none bg-surface"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  );
                })}
                {renderActions && <th />}
              </tr>
            )}
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (renderActions ? 1 : 0)} className="px-3 py-10 text-center text-text-muted">
                  {hasActiveFilters ? "Sin resultados para los filtros" : emptyLabel}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={rowKey(row)} className="border-t border-border hover:bg-soft">
                  {columns.map((col) => {
                    const v = col.render ? col.render(row) : (() => {
                      const raw = getValue(row, col);
                      return raw === null || raw === undefined ? "—" : String(raw);
                    })();
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          col.className,
                        )}
                      >
                        {v}
                      </td>
                    );
                  })}
                  {renderActions && <td className="px-3 py-2 text-right whitespace-nowrap">{renderActions(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
