"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Download, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime, tnAdminUrl, looksLikeTnOrderId } from "@/lib/dates";

type Result = {
  columns: string[];
  rows: unknown[][];
  row_count: number;
};

const CURRENCY_HINT = /total|amount|subtotal|revenue|commission|costo|precio|gmv|cobrado|monto/i;
const NUMBER_HINT = /^(qty|cantidad|unidades|ordenes|orders|n|count|days|dias)$/i;
const PHONE_HINT = /^(phone|telefono|tel|whatsapp|celular)$/i;
const EMAIL_HINT = /^(email|mail|correo)$/i;

/** Normaliza un telefono argentino para wa.me. */
function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("549")) return digits;
  if (digits.startsWith("54")) return "549" + digits.slice(2);
  if (digits.startsWith("0")) return "549" + digits.slice(1);
  if (digits.length === 10) return "549" + digits;
  return digits;
}

export function CellRenderer({ col, v }: { col: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return <>—</>;
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return <>{formatCurrency(v)}</>;
    if (NUMBER_HINT.test(col)) return <>{formatNumber(v)}</>;
    // Order ID grande → linkear a TN admin
    if (looksLikeTnOrderId(col, v)) {
      return (
        <a
          href={tnAdminUrl(v)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
          onClick={(e) => e.stopPropagation()}
          title="Abrir en Tienda Nube"
        >
          {String(v)}
          <ExternalLink size={9} className="opacity-60" />
        </a>
      );
    }
    return <>{String(v)}</>;
  }
  // Detectar fechas: ISO con T o "YYYY-MM-DD HH:MM:SS"
  if (typeof v === "string" && (/^\d{4}-\d{2}-\d{2}T/.test(v) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v))) {
    return <>{fmtArDateTime(v)}</>;
  }
  // Order id como string
  if (typeof v === "string" && looksLikeTnOrderId(col, v)) {
    return (
      <a
        href={tnAdminUrl(v)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
        onClick={(e) => e.stopPropagation()}
        title="Abrir en Tienda Nube"
      >
        {v}
        <ExternalLink size={9} className="opacity-60" />
      </a>
    );
  }
  const s = String(v);
  // Phone -> WhatsApp link
  if (PHONE_HINT.test(col)) {
    const wa = waNumber(s);
    if (!wa) return <>—</>;
    return (
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
        title="Abrir en WhatsApp"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{s}</span>
      </a>
    );
  }
  // Email -> mailto
  if (EMAIL_HINT.test(col) && s.includes("@")) {
    return (
      <a
        href={`mailto:${s}`}
        className="text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {s}
      </a>
    );
  }
  const display = s.length > 80 ? s.slice(0, 77) + "..." : s;
  return <>{display}</>;
}

function formatCell(col: string, v: unknown): string {
  // legacy plain-string for places that need a string
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (CURRENCY_HINT.test(col)) return formatCurrency(v);
    if (NUMBER_HINT.test(col)) return formatNumber(v);
    return String(v);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    try { return new Date(v).toLocaleString("es-AR"); } catch { return v; }
  }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
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

export function DrillDownModal({
  title,
  subtitle,
  endpoint,
  filename = "drilldown.csv",
  onClose,
}: {
  title: string;
  subtitle?: string;
  endpoint: string | null;
  filename?: string;
  onClose: () => void;
}) {
  // Cierre con ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error } = useQuery<Result>({
    queryKey: ["drilldown", endpoint],
    queryFn: () => api(endpoint ?? "/"),
    enabled: !!endpoint,
    staleTime: 60_000,
  });

  if (!endpoint) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 animate-in fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-5xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="min-w-0">
            <div className="text-base font-bold text-text truncate">{title}</div>
            {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
            {data && (
              <div className="text-xs text-text-muted mt-1">
                {formatNumber(data.row_count)} resultados
                {data.row_count >= 200 && <span className="text-warn ml-1">(top 200)</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                const params = new URLSearchParams({
                  endpoint: endpoint!,
                  title,
                  subtitle: subtitle ?? "",
                  filename,
                });
                window.open(`/dashboard/explore?${params.toString()}`, "_blank", "noopener");
              }}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
              title="Abrir analisis completo en pestana nueva"
            >
              <ExternalLink size={12} /> Abrir
            </button>
            {data && data.rows.length > 0 && (
              <button
                onClick={() => downloadCsv(filename, data.columns, data.rows)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
              >
                <Download size={12} /> CSV
              </button>
            )}
            <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-1">
          {isLoading && (
            <div className="p-8 text-center text-text-muted text-sm">Cargando detalle...</div>
          )}
          {error && (
            <div className="m-4 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm">
              {(error as Error).message}
            </div>
          )}
          {data && data.rows.length === 0 && !isLoading && (
            <div className="p-12 text-center text-text-muted text-sm">
              Sin resultados para esta seleccion en el periodo actual.
            </div>
          )}
          {data && data.rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  {data.columns.map((c) => (
                    <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
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

        <div className="px-5 py-3 border-t border-border bg-soft text-xs text-text-muted flex items-center gap-2">
          <ExternalLink size={11} className="text-primary" />
          <span>Click ESC o fuera del modal para cerrar</span>
        </div>
      </div>
    </div>
  );
}
