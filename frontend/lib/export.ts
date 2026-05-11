/**
 * Utilidades de export CSV / Excel para reutilizar desde cualquier tabla
 * filtrada en la app. La idea es que SIEMPRE se exporte exactamente lo
 * que el usuario esta viendo (filtros + sort aplicados).
 */

export function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [columns.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  // BOM al inicio para que Excel detecte UTF-8 cuando abre el CSV
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Excel xlsx descargado: genera tabla HTML que Excel parsea como .xls.
 * Mantiene estilos basicos (header violeta UNIDATA) sin requerir libreria xlsx.
 */
export function downloadXlsx(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"></head>
    <body>
      <table border="1">
        <thead>
          <tr style="background:#7a3eae;color:white;font-weight:bold">
            ${columns.map((c) => `<th>${escape(c)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </body></html>`;
  const blob = new Blob(["﻿" + html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/\.(csv|xlsx?)$/i, "")}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Convierte una lista de objetos al par {columns, rows} para download. */
export function rowsFromObjects<T extends Record<string, unknown>>(
  objs: T[],
  columns: Array<{ key: keyof T & string; label?: string }>,
): { columns: string[]; rows: unknown[][] } {
  return {
    columns: columns.map((c) => c.label ?? c.key),
    rows: objs.map((o) => columns.map((c) => o[c.key])),
  };
}
