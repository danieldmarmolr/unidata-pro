"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { KpiCard as KpiCardT } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

function formatValue(v: number | string, prefix?: string, suffix?: string) {
  if (typeof v === "number") {
    return `${prefix ?? ""}${formatNumber(Math.round(v))}${suffix ?? ""}`;
  }
  return `${prefix ?? ""}${v}${suffix ?? ""}`;
}

export function KpiCard({ data }: { data: KpiCardT }) {
  const { label, value, delta, prefix, suffix, hint } = data;
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:shadow-md hover:shadow-primary/5 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </div>
        {delta !== null && delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full",
              positive ? "text-success bg-emerald-50" : "text-error bg-red-50",
            )}
          >
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-text">
        {formatValue(value, prefix, suffix)}
      </div>
      {hint && (
        <div className="mt-2 text-xs text-text-muted truncate">{hint}</div>
      )}
    </div>
  );
}
