"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Calculator, X, Database, Calendar, Sigma } from "lucide-react";
import type { KpiCard as KpiCardT, KpiFormula } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { DrillDownModal } from "@/components/drilldown-modal";
import type { KpiDrill } from "@/components/kpi-card";

function fmt(v: number | string, prefix?: string, suffix?: string) {
  if (typeof v === "number") {
    const rounded = Math.abs(v) >= 100 ? Math.round(v) : v;
    return `${prefix ?? ""}${formatNumber(rounded as number)}${suffix ?? ""}`;
  }
  return `${prefix ?? ""}${v}${suffix ?? ""}`;
}

function fmtBreakdownValue(v: number | string, prefix?: string, suffix?: string) {
  if (typeof v === "number") {
    return `${prefix ?? ""}${formatNumber(Math.round(v))}${suffix ?? ""}`;
  }
  return `${prefix ?? ""}${v}${suffix ?? ""}`;
}

// Popover anclado al chip que muestra como se calcula la KPI: fuente, periodo,
// formula simbolica y breakdown numerico. Se cierra al click fuera o ESC.
function FormulaPopover({
  card, formula, onClose,
}: { card: KpiCardT; formula: KpiFormula; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      className="absolute z-30 left-0 top-full mt-1 min-w-[280px] max-w-[360px] bg-surface border border-border rounded-xl shadow-xl p-3 text-left"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-1.5">
          <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Calculator size={12} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Cómo se calcula</div>
            <div className="text-xs font-bold text-text leading-tight">{card.label}</div>
            <div className="text-base font-extrabold tabular-nums text-primary leading-tight mt-0.5">
              {fmt(card.value, card.prefix, card.suffix)}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text shrink-0"
          aria-label="Cerrar"
        >
          <X size={14} />
        </button>
      </div>

      <div className="text-[11px] text-text leading-snug mb-2">{formula.description}</div>

      {formula.expression && (
        <div className="bg-soft/60 border border-border rounded px-2 py-1.5 mb-2 font-mono text-[11px] text-text break-words">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold mb-0.5 flex items-center gap-1">
            <Sigma size={9} /> Expresion
          </div>
          {formula.expression}
        </div>
      )}

      {(formula.source || formula.period) && (
        <div className="flex flex-wrap gap-2 mb-2 text-[10px]">
          {formula.source && (
            <span className="inline-flex items-center gap-1 bg-soft/40 border border-border rounded px-1.5 py-0.5">
              <Database size={9} className="text-text-muted" />
              <span className="font-mono text-text">{formula.source}</span>
            </span>
          )}
          {formula.period && (
            <span className="inline-flex items-center gap-1 bg-soft/40 border border-border rounded px-1.5 py-0.5">
              <Calendar size={9} className="text-text-muted" />
              <span className="text-text">{formula.period}</span>
            </span>
          )}
        </div>
      )}

      {formula.breakdown && formula.breakdown.length > 0 && (
        <div className="border-t border-border pt-2 mt-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold mb-1">Breakdown</div>
          <div className="space-y-0.5">
            {formula.breakdown.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex justify-between gap-3 text-[11px]",
                  r.highlight && "border-t border-border pt-1 mt-1 font-bold text-text",
                )}
              >
                <span className={r.highlight ? "text-text" : "text-text-muted"}>{r.label}</span>
                <span className="font-bold tabular-nums">{fmtBreakdownValue(r.value, r.prefix, r.suffix)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ data, drill }: { data: KpiCardT; drill?: KpiDrill }) {
  const [drillOpen, setDrillOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const hasFormula = !!data.formula;
  const hasDrill = !!drill;
  const interactive = hasFormula || hasDrill;

  const cls = cn(
    "group flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg bg-surface border border-border min-w-[120px] transition w-full",
    interactive && "hover:border-primary/40 hover:shadow-sm cursor-pointer text-left",
  );

  const inner = (
    <>
      <div className="flex items-center gap-1 w-full">
        <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted truncate flex-1">
          {data.label}
        </span>
        {hasFormula && (
          <Calculator size={9} className="text-primary/60 opacity-70 group-hover:opacity-100 transition shrink-0" />
        )}
        {hasDrill && !hasFormula && (
          <Search size={9} className="text-text-muted opacity-0 group-hover:opacity-100 transition shrink-0" />
        )}
      </div>
      <div className="text-base font-extrabold tabular-nums text-text leading-tight">
        {fmt(data.value, data.prefix, data.suffix)}
      </div>
      {data.hint && (
        <div className="text-[9px] text-text-muted truncate max-w-[180px]" title={data.hint}>
          {data.hint}
        </div>
      )}
    </>
  );

  // Si tiene drill, click abre el drill modal (prioridad sobre formula).
  // Si solo tiene formula, click abre el popover.
  if (hasDrill || hasFormula) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (hasDrill) setDrillOpen(true);
            else if (hasFormula) setFormulaOpen((v) => !v);
          }}
          className={cls}
        >
          {inner}
        </button>
        {drillOpen && drill && (
          <DrillDownModal
            title={drill.title ?? data.label}
            subtitle={drill.subtitle ?? data.hint ?? ""}
            endpoint={drill.endpoint}
            filename={drill.filename ?? `${data.label.toLowerCase().replace(/\W+/g, "_")}.csv`}
            onClose={() => setDrillOpen(false)}
          />
        )}
        {formulaOpen && data.formula && (
          <FormulaPopover card={data} formula={data.formula} onClose={() => setFormulaOpen(false)} />
        )}
      </div>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function KpiChipStrip({
  cards,
  getDrill,
}: {
  cards: KpiCardT[];
  getDrill?: (label: string) => KpiDrill | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {cards.map((c) => (
        <Chip key={c.label} data={c} drill={getDrill?.(c.label)} />
      ))}
    </div>
  );
}
