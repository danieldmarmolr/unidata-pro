"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

type TodayAnchor = { key: string; label: string; value: number; delta_pct: number | null };
type TodayBlock = { label: string; prefix?: string; suffix?: string; hint?: string; today: number; anchors: TodayAnchor[] };
type TodaySnapshot = { today_date: string; until_time?: string; blocks: TodayBlock[]; generated_at: string };

type Unit = "unistore" | "unidrop";
type Context =
  | "default" | "cs" | "productos" | "logistica"
  | "finanzas" | "marketing" | "saas" | "envios"
  | "devoluciones" | "pagos" | "subscriptions"
  | "dropshippers" | "clientes" | "costos";

function fmtVal(v: number, prefix?: string, suffix?: string): string {
  return `${prefix ?? ""}${formatNumber(v)}${suffix ?? ""}`;
}

function fmtDateAR(today_date: string): string {
  try {
    const [y, m, d] = today_date.split("-");
    return `${d}/${m}/${y}`;
  } catch { return today_date; }
}

function shortLabel(label: string): string {
  return label
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

/**
 * Comparador HOY unificado: barra compacta siempre, expandible al click.
 *
 * - Cerrada: strip horizontal con KPIs del area + delta vs 7d.
 * - Abierta: detalle 7d/28d/336d por KPI (anchors apples-to-apples).
 * - Toggle "Mi area / Toda la app": alterna entre context propio y vista cross gerencial.
 */
export function TodayPanel({
  title = "HOY",
  unit,
  context,
  defaultExpanded = false,
  allowCrossToggle = true,
}: {
  title?: string;
  unit?: Unit;
  context?: Context;
  defaultExpanded?: boolean;
  /** Si false oculta el toggle "Toda la app" (para Gerencia que ya es cross). */
  allowCrossToggle?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [crossView, setCrossView] = useState(false);

  const effectiveUnit: Unit | undefined = crossView ? undefined : unit;
  const effectiveContext: Context = crossView ? "default" : (context ?? "default");

  const scope = effectiveUnit ?? "all";
  const ctx = effectiveContext;
  const { data, isLoading } = useQuery<TodaySnapshot>({
    queryKey: ["dashboards", "today", scope, ctx],
    queryFn: () => api<TodaySnapshot>(`/api/dashboards/today?unit=${scope}&context=${ctx}`),
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return <div className="bg-surface border border-border rounded-xl mb-4 animate-pulse h-10" />;
  }

  const untilLabel = data.until_time ? `hasta las ${data.until_time}` : fmtDateAR(data.today_date);
  const hasBlocks = data.blocks.length > 0;

  return (
    <div className="bg-gradient-to-r from-primary/6 to-accent/6 border border-primary/20 rounded-xl mb-4">
      {/* Header / barra compacta */}
      <button
        type="button"
        onClick={() => hasBlocks && setExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-center gap-1 flex-wrap text-left"
        disabled={!hasBlocks}
      >
        <span className="text-[10px] font-bold text-text-muted whitespace-nowrap mr-2 shrink-0">
          {title} {fmtDateAR(data.today_date)} · {untilLabel}
        </span>
        <div className="flex items-center gap-3 overflow-x-auto flex-wrap flex-1">
          {hasBlocks ? data.blocks.map((b) => {
            const a7 = b.anchors.find((a) => a.key === "w_ago");
            return (
              <div key={b.label} className="flex items-center gap-1 whitespace-nowrap">
                <span className="text-[10px] text-text-muted font-semibold">{shortLabel(b.label)}:</span>
                <span className="text-[11px] font-bold text-text tabular-nums">
                  {fmtVal(b.today, b.prefix, b.suffix)}
                </span>
                {a7?.delta_pct !== null && a7?.delta_pct !== undefined && (
                  <span className={"text-[10px] font-semibold " + (a7.delta_pct >= 0 ? "text-emerald-600" : "text-error")}>
                    {a7.delta_pct >= 0 ? "↑" : "↓"}{Math.abs(a7.delta_pct).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          }) : (
            <span className="text-[11px] text-text-muted italic">sin KPIs del dia para este contexto</span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {allowCrossToggle && unit && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setCrossView((v) => !v); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setCrossView((v) => !v); } }}
              className={
                "inline-flex items-center gap-1 text-[10px] font-bold rounded-md px-2 py-0.5 border transition cursor-pointer " +
                (crossView
                  ? "bg-primary text-white border-primary"
                  : "bg-surface text-text-muted border-border hover:text-primary hover:border-primary/40")
              }
              title={crossView ? "Viendo cross-app · click para volver a mi area" : "Click para ver KPIs cross-app"}
            >
              <Layers size={10} />
              {crossView ? "Toda la app" : "Mi area"}
            </span>
          )}
          {hasBlocks && (
            <span className="text-text-muted">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
        </div>
      </button>

      {/* Detalle expandido (anchors 7d/28d/336d) */}
      {expanded && hasBlocks && (
        <div className="border-t border-primary/20 px-4 py-3 grid gap-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {data.blocks.map((b) => (
            <div key={b.label} className="bg-surface border border-border rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{b.label}</div>
              <div className="font-extrabold text-text mt-0.5 tabular-nums text-lg">
                {fmtVal(b.today, b.prefix, b.suffix)}
              </div>
              {b.hint && <div className="text-[10px] text-text-muted mt-0.5">{b.hint}</div>}
              <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border">
                {b.anchors.map((a) => (
                  <div key={a.key}>
                    <div className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{a.label}</div>
                    <div className="text-[11px] font-bold text-text-muted tabular-nums">
                      {fmtVal(a.value, b.prefix, b.suffix)}
                    </div>
                    {a.delta_pct !== null && (
                      <div className={"text-[10px] font-semibold " + (a.delta_pct >= 0 ? "text-emerald-600" : "text-error")}>
                        {a.delta_pct >= 0 ? "+" : ""}{a.delta_pct.toFixed(0)}%
                      </div>
                    )}
                    {a.delta_pct === null && a.value === 0 && (
                      <div className="text-[10px] text-text-muted">sin datos</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
