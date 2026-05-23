"use client";

import { DollarSign, Package, ShoppingCart, TrendingUp, Boxes, Wallet } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { KpiCard as KpiCardT } from "@/lib/types";

// Reemplazo compacto de las 5-6 KpiCard grandes del SKU 360. Mismo data pero
// en 1 fila densa con dividers verticales — ahorra ~80px de scroll. Mantiene
// los hints en hover (title) y resalta los valores en tabular-nums.

type Props = { cards: KpiCardT[] };

// Map: matcheo por label substring → icono + acento de color
function iconFor(label: string): { icon: any; tone: string } {
  const l = label.toLowerCase();
  if (l.includes("ganancia")) return { icon: Wallet, tone: "text-emerald-700 bg-emerald-50" };
  if (l.includes("revenue")) return { icon: DollarSign, tone: "text-primary bg-primary/10" };
  if (l.includes("unidades")) return { icon: Package, tone: "text-violet-700 bg-violet-50" };
  if (l.includes("orden") || l.includes("cliente")) return { icon: ShoppingCart, tone: "text-amber-700 bg-amber-50" };
  if (l.includes("stock")) return { icon: Boxes, tone: "text-cyan-700 bg-cyan-50" };
  return { icon: TrendingUp, tone: "text-text-muted bg-soft" };
}

function fmtValue(value: number | string, prefix?: string, suffix?: string): string {
  if (typeof value === "string") return value;
  if (prefix === "$ " || prefix === "$") return formatCurrency(value);
  return `${prefix ?? ""}${formatNumber(value)}${suffix ?? ""}`;
}

export function SkuKpiStrip({ cards }: Props) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="bg-surface border border-border rounded-xl px-1 py-0.5 mb-6 overflow-x-auto">
      <div className="flex items-stretch divide-x divide-border min-w-fit">
        {cards.map((c, i) => {
          const { icon: Icon, tone } = iconFor(c.label);
          return (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 min-w-[180px]"
              title={c.hint ?? c.label}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold leading-none mb-1 truncate">
                  {c.label}
                </div>
                <div className="text-lg font-extrabold tabular-nums text-text leading-none truncate">
                  {fmtValue(c.value as number | string, c.prefix, c.suffix)}
                </div>
                {c.hint && (
                  <div className="text-[10px] text-text-muted mt-0.5 truncate">{c.hint}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
