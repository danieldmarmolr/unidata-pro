"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

type TodayAnchor = { key: string; label: string; value: number; delta_pct: number | null };
type TodayBlock = { label: string; prefix?: string; suffix?: string; hint?: string; today: number; anchors: TodayAnchor[] };
type TodaySnapshot = { today_date: string; blocks: TodayBlock[]; generated_at: string };

function fmtVal(v: number, prefix?: string, suffix?: string): string {
  return `${prefix ?? ""}${formatNumber(v)}${suffix ?? ""}`;
}

function fmtDateAR(today_date: string): string {
  try {
    const [y, m, d] = today_date.split("-");
    return `${d}/${m}/${y}`;
  } catch { return today_date; }
}

/**
 * Panel "Comparador HOY" reutilizable para todos los dashboards.
 *
 * - `compact=true`: vista resumida (cuando otra fecha esta activa, se muestra arriba como referencia)
 * - `compact=false`: vista expandida (cuando period=today, es la vista principal)
 */
export function TodayPanel({
  compact = false,
  title = "Comparador HOY",
  unit,
  context,
}: {
  compact?: boolean;
  title?: string;
  /** Si se pasa "unistore" o "unidrop" filtra a esa unidad. Sin valor = vista cross (Gerencial). */
  unit?: "unistore" | "unidrop";
  /** Cambia los bloques segun la pagina origen.
   *  - default: GMV / ordenes / ticket / devoluciones (gerencial / ventas)
   *  - cs: customers nuevos / recurrentes / cancelaciones / refunds (Customer Success)
   */
  context?: "default" | "cs";
}) {
  const scope = unit ?? "all";
  const ctx = context ?? "default";
  const { data, isLoading } = useQuery<TodaySnapshot>({
    queryKey: ["dashboards", "today", scope, ctx],
    queryFn: () => api<TodaySnapshot>(`/api/dashboards/today?unit=${scope}&context=${ctx}`),
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className={"bg-surface border border-border rounded-xl mb-6 animate-pulse " + (compact ? "h-[140px]" : "h-[260px]")} />
    );
  }

  return (
    <div className="bg-gradient-to-br from-primary/8 to-accent/8 border border-primary/30 rounded-xl p-5 mb-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-text">
            {title} ({fmtDateAR(data.today_date)})
          </div>
          <div className="text-xs text-text-muted mt-0.5">vs mismo dia hace 7d / 30d / 1 ano</div>
        </div>
      </div>
      <div className={"grid gap-3 " + (compact ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3")}>
        {data.blocks.map((b) => (
          <div key={b.label} className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{b.label}</div>
            <div className={"font-extrabold text-text mt-1 tabular-nums " + (compact ? "text-base" : "text-2xl")}>
              {fmtVal(b.today, b.prefix, b.suffix)}
            </div>
            {!compact && b.hint && <div className="text-[10px] text-text-muted mt-0.5">{b.hint}</div>}
            <div className={"grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border " + (compact ? "" : "mt-3 pt-3")}>
              {b.anchors.map((a) => (
                <div key={a.key}>
                  <div className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{a.label}</div>
                  {!compact && (
                    <div className="text-xs font-bold text-text-muted tabular-nums">
                      {fmtVal(a.value, b.prefix, b.suffix)}
                    </div>
                  )}
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
    </div>
  );
}
