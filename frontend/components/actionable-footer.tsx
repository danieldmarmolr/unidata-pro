"use client";

/**
 * Footer reutilizable para modales con accionables:
 * - Boton "Exportar CSV"  : descarga la lista actual como CSV
 * - Boton "Generar accion CS" : crea entry en cs_actions y notifica
 *
 * Patron unificado: card del dashboard -> click -> modal con
 *   (1) que significa  (2) lista  (3) accion sugerida  (4) este footer
 *
 * Cuando el equipo agregue nuevos modales accionables, importan este componente
 * y pasan los props correspondientes.
 */
import { useState } from "react";
import { Download, Target, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";

export type ActionableFooterProps = {
  // Identificacion de origen
  sourceType: "rfm_segment" | "rfm_flow" | "manual";
  sourceKey: string; // ej "champions" o "nuevo_este_mes->leales"
  unit: "unistore" | "unidrop";
  title: string;
  suggestedAction: string;
  // Datos para CSV + creacion de accion
  targetIds: number[];
  csvFilename: string; // sin .csv
  csvHeaders: string[];
  csvRows: (string | number)[][];
  // Color de acento (toma el color del segmento/flow)
  accentColor?: string;
  // Texto custom (opcional)
  exportLabel?: string;
  actionLabel?: string;
  // Callback opcional cuando se crea la accion (para refrescar contadores)
  onActionCreated?: () => void;
};

export function ActionableFooter({
  sourceType, sourceKey, unit, title, suggestedAction,
  targetIds, csvFilename, csvHeaders, csvRows,
  accentColor = "#7a3eae",
  exportLabel = "Exportar CSV",
  actionLabel = "Generar accion CS",
  onActionCreated,
}: ActionableFooterProps) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleExportCsv = () => {
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [csvHeaders.map(escape).join(",")];
    for (const r of csvRows) lines.push(r.map(escape).join(","));
    const bom = "﻿"; // Excel utf-8 BOM
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFilename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCreateAction = async () => {
    if (creating) return;
    if (!targetIds || targetIds.length === 0) {
      setErr("No hay items para accionar");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const res = await api<{ id: number }>(`/api/cs-actions`, {
        method: "POST",
        body: JSON.stringify({
          source_type: sourceType,
          source_key: sourceKey,
          unit,
          title,
          suggested_action: suggestedAction,
          target_ids: targetIds,
          metadata: { csv_rows: csvRows.length, generated_at: new Date().toISOString() },
        }),
      });
      setCreated(res.id);
      onActionCreated?.();
    } catch (e: any) {
      setErr(e?.message || "Error creando accion");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="px-5 py-3 border-t border-border bg-soft/30 flex items-center gap-2 flex-wrap">
      <button
        onClick={handleExportCsv}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-border bg-surface hover:bg-soft transition"
        disabled={!targetIds || targetIds.length === 0}
      >
        <Download size={13} /> {exportLabel} ({csvRows.length})
      </button>

      {created != null ? (
        <a
          href="/dashboard/cs-acciones"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
        >
          <CheckCircle2 size={13} /> Accion #{created} creada — ver bandeja
        </a>
      ) : (
        <button
          onClick={handleCreateAction}
          disabled={creating || !targetIds.length}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-white shadow disabled:opacity-50 transition"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` }}
        >
          {creating ? <Loader2 size={13} className="animate-spin" /> : <Target size={13} />}
          {creating ? "Creando..." : actionLabel} ({targetIds.length})
        </button>
      )}

      {err && <div className="text-[11px] text-red-600 font-semibold">{err}</div>}

      <div className="ml-auto text-[10px] text-text-muted">
        La accion queda en <a href="/dashboard/cs-acciones" className="underline">bandeja CS</a>
      </div>
    </div>
  );
}
