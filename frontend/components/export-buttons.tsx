"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { downloadCsv, downloadXlsx } from "@/lib/export";

/**
 * Botones de export Excel + CSV reusable.
 *
 * Lo que se exporta es EXACTAMENTE lo que recibe — filtros + sort se aplican
 * en el caller, no aca. Asi cualquier tabla puede exportar lo que el usuario
 * esta viendo en pantalla sin re-fetchear ni filtrar otra vez.
 */
export function ExportButtons({
  filename,
  columns,
  rows,
  size = "sm",
  showLabel = true,
  className = "",
}: {
  filename: string;
  columns: string[];
  rows: unknown[][];
  size?: "sm" | "xs";
  showLabel?: boolean;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <span className={`text-[10px] text-text-muted/60 ${className}`}>
        Sin filas para exportar
      </span>
    );
  }
  const sz = size === "xs" ? "text-[10px] px-2 py-1" : "text-xs px-2.5 py-1.5";
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-[10px] text-text-muted hidden sm:inline">
        {rows.length} fila{rows.length === 1 ? "" : "s"}:
      </span>
      <button
        onClick={() => downloadXlsx(filename, columns, rows)}
        className={`inline-flex items-center gap-1 ${sz} rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition font-semibold`}
        title="Descargar como Excel (.xls)"
      >
        <FileSpreadsheet size={size === "xs" ? 10 : 12} />
        {showLabel && <span>Excel</span>}
      </button>
      <button
        onClick={() => downloadCsv(filename, columns, rows)}
        className={`inline-flex items-center gap-1 ${sz} rounded-lg border border-border bg-surface text-text hover:border-primary hover:text-primary transition`}
        title="Descargar como CSV (UTF-8)"
      >
        <FileText size={size === "xs" ? 10 : 12} />
        {showLabel && <span>CSV</span>}
      </button>
    </div>
  );
}
