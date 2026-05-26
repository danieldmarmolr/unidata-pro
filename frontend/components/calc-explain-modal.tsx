"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, ExternalLink, Database, Code2, ChevronRight, Calculator } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { DrillDownModal } from "@/components/drilldown-modal";

type ExplainStep = {
  label: string;
  value: number;
  operator?: string | null;
  subtotal?: boolean;
  negative?: boolean;
  explain_metric?: string;
  drill_endpoint?: string;
  hint?: string;
  value_format?: "currency" | "percent" | "number";
};

type ExplainSource = {
  table: string;
  engine: string;
  filter: string;
  rows?: number;
};

export type ExplainResponse = {
  metric: string;
  title: string;
  value: number;
  value_format: "currency" | "percent" | "number";
  period: string;
  formula: string;
  description: string;
  steps: ExplainStep[];
  sources: ExplainSource[];
  sql_summary: string;
  warnings: string[];
  drilldown_url: string | null;
  computed_at: string;
};

function fmtValue(v: number, format: "currency" | "percent" | "number"): string {
  if (!Number.isFinite(v)) return "—";
  if (format === "percent") return `${v.toFixed(1)}%`;
  if (format === "number") return formatNumber(v);
  return formatCurrency(v);
}

export function CalcExplainModal({
  metric,
  period,
  customFrom,
  customTo,
  onClose,
}: {
  metric: string;
  period: string;
  customFrom?: string | null;
  customTo?: string | null;
  onClose: () => void;
}) {
  // Stack para nested explain (click "Cómo se calcula →" abre el explain del paso)
  const [stack, setStack] = useState<string[]>([metric]);
  const currentMetric = stack[stack.length - 1];

  const [drillEndpoint, setDrillEndpoint] = useState<string | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drillEndpoint) return; // ESC lo maneja el DrillDownModal anidado
      if (stack.length > 1) {
        setStack((s) => s.slice(0, -1));
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, onClose, drillEndpoint]);

  const qs = new URLSearchParams({ period });
  if (customFrom) qs.set("from", customFrom);
  if (customTo) qs.set("to", customTo);

  const { data, isLoading, error } = useQuery<ExplainResponse>({
    queryKey: ["explain", currentMetric, period, customFrom, customTo],
    queryFn: () => api<ExplainResponse>(`/api/dashboards/gerencia/explain/${currentMetric}?${qs.toString()}`),
    staleTime: 60_000,
  });

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-border w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-4 sm:p-5 border-b border-border gap-3">
            <div className="min-w-0 flex-1">
              {stack.length > 1 && (
                <button
                  onClick={() => setStack((s) => s.slice(0, -1))}
                  className="text-[11px] text-text-muted hover:text-primary inline-flex items-center gap-1 mb-1"
                >
                  ← Volver a {stack[stack.length - 2]}
                </button>
              )}
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted font-bold">
                <Calculator size={11} />
                Cómo se calcula · {period}
              </div>
              <div className="text-base sm:text-lg font-bold text-text truncate mt-0.5">
                {data?.title ?? currentMetric}
              </div>
              {data && (
                <div
                  className={cn(
                    "text-2xl sm:text-3xl font-extrabold tabular-nums mt-1",
                    data.value < 0 ? "text-error" : "text-text",
                  )}
                >
                  {fmtValue(data.value, data.value_format)}
                </div>
              )}
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text shrink-0" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            {isLoading && (
              <div className="p-8 text-center text-text-muted text-sm">Cargando cálculo…</div>
            )}
            {error && (
              <div className="m-4 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm">
                {(error as Error).message}
              </div>
            )}

            {data && (
              <div className="p-4 sm:p-5 space-y-5">
                {/* Descripción */}
                {data.description && (
                  <div className="text-xs text-text-muted leading-relaxed bg-soft/60 border border-border rounded-lg p-3">
                    {data.description}
                  </div>
                )}

                {/* Fórmula */}
                {data.formula && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1.5">
                      Fórmula
                    </div>
                    <code className="block text-xs bg-soft border border-border rounded px-3 py-2 font-mono text-text whitespace-pre-wrap break-words">
                      {data.formula}
                    </code>
                  </div>
                )}

                {/* Warnings */}
                {data.warnings.length > 0 && (
                  <div className="space-y-2">
                    {data.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 text-xs"
                      >
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <div className="leading-relaxed">{w}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Steps */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
                    Paso a paso
                  </div>
                  <div className="space-y-1">
                    {data.steps.map((s, i) => {
                      const isSubtotal = !!s.subtotal;
                      const format = s.value_format ?? data.value_format;
                      return (
                        <div
                          key={i}
                          className={cn(
                            "rounded-lg border px-3 py-2 transition",
                            isSubtotal
                              ? "bg-primary/5 border-primary/30"
                              : "bg-surface border-border hover:border-primary/40",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {s.operator && (
                                <span className="font-mono text-text-muted text-sm w-5 text-center shrink-0">
                                  {s.operator}
                                </span>
                              )}
                              <span
                                className={cn(
                                  "text-sm truncate",
                                  isSubtotal ? "font-extrabold text-text" : "font-semibold text-text",
                                )}
                              >
                                {s.label}
                              </span>
                            </div>
                            <span
                              className={cn(
                                "tabular-nums shrink-0",
                                isSubtotal ? "text-base font-extrabold" : "text-sm font-bold",
                                s.negative ? "text-error" : isSubtotal ? "text-primary" : "text-text",
                              )}
                            >
                              {fmtValue(s.value, format)}
                            </span>
                          </div>
                          {(s.hint || s.explain_metric || s.drill_endpoint) && (
                            <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[10px]">
                              {s.hint && <span className="text-text-muted">{s.hint}</span>}
                              {s.explain_metric && (
                                <button
                                  onClick={() => setStack((st) => [...st, s.explain_metric!])}
                                  className="inline-flex items-center gap-0.5 text-primary hover:underline font-semibold"
                                >
                                  Cómo se calcula <ChevronRight size={9} />
                                </button>
                              )}
                              {s.drill_endpoint && (
                                <button
                                  onClick={() => setDrillEndpoint(s.drill_endpoint!)}
                                  className="inline-flex items-center gap-0.5 text-primary hover:underline font-semibold"
                                >
                                  Ver datos <ExternalLink size={9} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Fuentes */}
                {data.sources.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2 flex items-center gap-1.5">
                      <Database size={11} /> Fuentes de datos
                    </div>
                    <div className="space-y-1.5">
                      {data.sources.map((src, i) => (
                        <div
                          key={i}
                          className="bg-soft/60 border border-border rounded-lg px-3 py-2 text-[11px]"
                        >
                          <div className="font-mono font-bold text-text break-words">{src.table}</div>
                          <div className="text-text-muted mt-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase mr-1.5">
                              {src.engine}
                            </span>
                            {src.filter}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SQL summary */}
                {data.sql_summary && (
                  <div>
                    <button
                      onClick={() => setSqlOpen((o) => !o)}
                      className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2 flex items-center gap-1.5 hover:text-text transition"
                    >
                      <Code2 size={11} /> SQL ({sqlOpen ? "ocultar" : "ver"})
                    </button>
                    {sqlOpen && (
                      <pre className="text-[11px] bg-text/90 text-amber-100 rounded-lg px-3 py-2 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                        {data.sql_summary}
                      </pre>
                    )}
                  </div>
                )}

                {/* Drilldown CTA */}
                {data.drilldown_url && (
                  <div className="border-t border-border pt-4">
                    {data.drilldown_url.startsWith("/api/") ? (
                      <button
                        onClick={() => setDrillEndpoint(data.drilldown_url!)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 transition"
                      >
                        <ExternalLink size={14} /> Ver datos crudos (validación manual)
                      </button>
                    ) : (
                      <a
                        href={data.drilldown_url}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 transition"
                      >
                        <ExternalLink size={14} /> Ir al panel relacionado
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-border bg-soft text-[10px] text-text-muted flex items-center gap-2">
            <span>ESC para cerrar · Click "Cómo se calcula" en cualquier paso para profundizar</span>
          </div>
        </div>
      </div>

      {drillEndpoint && (
        <DrillDownModal
          title={data?.title ?? currentMetric}
          subtitle={`Datos crudos · período ${period}`}
          endpoint={drillEndpoint}
          filename={`${currentMetric}_${period}.csv`}
          onClose={() => setDrillEndpoint(null)}
        />
      )}
    </>
  );
}
