"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Hook compartido para tablas custom (no-CategoryTable) que necesitan sort
 * por columna asc/desc.
 *
 * Uso:
 *   const { rows, sortBy, sortDir, toggle, SortHeader } = useTableSort(data, "fecha");
 *   ...
 *   <th><SortHeader col="fecha" label="Fecha" /></th>
 *   {rows.map(r => ...)}
 */
export function useTableSort<T extends Record<string, any>>(
  data: T[],
  defaultSortBy: string | null = null,
  defaultDir: SortDir = "desc",
) {
  const [sortBy, setSortBy] = useState<string | null>(defaultSortBy);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    if (!sortBy) return data;
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...data];
    arr.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      const aNull = va === null || va === undefined || va === "";
      const bNull = vb === null || vb === undefined || vb === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      // Dates: try parsing
      if (typeof va === "string" && typeof vb === "string") {
        const da = Date.parse(va);
        const db = Date.parse(vb);
        if (!Number.isNaN(da) && !Number.isNaN(db)) return (da - db) * dir;
        return va.localeCompare(vb, "es", { numeric: true }) * dir;
      }
      return String(va).localeCompare(String(vb), "es", { numeric: true }) * dir;
    });
    return arr;
  }, [data, sortBy, sortDir]);

  return { rows, sortBy, sortDir, toggle };
}

/**
 * Componente helper para renderizar el header con icono asc/desc.
 * Uso:
 *   <SortHeader col="fecha" label="Fecha" sortBy={sortBy} sortDir={sortDir} onToggle={toggle} />
 */
export function SortHeader({
  col, label, sortBy, sortDir, onToggle, className = "",
}: {
  col: string;
  label: React.ReactNode;
  sortBy: string | null;
  sortDir: SortDir;
  onToggle: (col: string) => void;
  className?: string;
}) {
  const active = sortBy === col;
  const arrow = !active ? "↕" : sortDir === "asc" ? "↑" : "↓";
  const arrowColor = active ? "text-text" : "text-text-muted/40";
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={
        "inline-flex items-center gap-1 hover:text-text transition cursor-pointer select-none " +
        className
      }
    >
      <span>{label}</span>
      <span className={`text-[10px] ${arrowColor}`}>{arrow}</span>
    </button>
  );
}
