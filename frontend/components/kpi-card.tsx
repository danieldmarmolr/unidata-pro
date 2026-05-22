"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ArrowUpRight as LinkArrow, Search } from "lucide-react";
import type { KpiCard as KpiCardT } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { DrillDownModal } from "@/components/drilldown-modal";

export type KpiDrill = {
  endpoint: string;
  title?: string;
  subtitle?: string;
  filename?: string;
};

function formatValue(v: number | string, prefix?: string, suffix?: string) {
  if (typeof v === "number") {
    return `${prefix ?? ""}${formatNumber(Math.round(v))}${suffix ?? ""}`;
  }
  return `${prefix ?? ""}${v}${suffix ?? ""}`;
}

export function KpiCard({
  data,
  href,
  drill,
}: {
  data: KpiCardT;
  href?: string;
  drill?: KpiDrill;
}) {
  const { label, value, delta, delta_yoy, delta_yoy_label, target, target_direction, delta_target, prefix, suffix, hint } = data;
  const positive = (delta ?? 0) >= 0;
  const yoyPositive = (delta_yoy ?? 0) >= 0;
  // Target: signo del delta_target indica si excedimos el target. Para
  // lower_is_better, delta_target>0 = mal (estamos arriba del target).
  // Para higher_is_better, delta_target>0 = bien (superamos el target).
  const targetGood =
    delta_target == null
      ? null
      : target_direction === "higher_is_better"
      ? delta_target >= 0
      : delta_target <= 0;
  const [open, setOpen] = useState(false);

  const interactive = !!href || !!drill;
  const cardClass = cn(
    "bg-surface border border-border rounded-xl p-5 hover:shadow-md hover:shadow-primary/10 hover:border-primary/30 hover:-translate-y-0.5 transition fade-in-up relative group block",
    interactive && "cursor-pointer",
  );

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </div>
        {delta !== null && delta !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full",
              positive ? "text-success bg-emerald-50" : "text-error bg-red-50",
            )}
          >
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : interactive ? (
          <span className="text-text-muted opacity-0 group-hover:opacity-100 transition">
            {drill ? <Search size={12} /> : <LinkArrow size={12} />}
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-text">
        {formatValue(value, prefix, suffix)}
      </div>
      {delta_yoy !== null && delta_yoy !== undefined && (
        <div
          className={cn(
            "mt-1 text-[10px] font-semibold",
            yoyPositive ? "text-success" : "text-error",
          )}
          title={delta_yoy_label ?? "vs mismo periodo hace 1 ano"}
        >
          {yoyPositive ? "▲" : "▼"} {Math.abs(delta_yoy).toFixed(1)}% {delta_yoy_label ?? "YoY"}
        </div>
      )}
      {target !== null && target !== undefined && delta_target !== null && delta_target !== undefined && (
        <div
          className={cn(
            "mt-0.5 text-[10px] font-semibold",
            targetGood ? "text-success" : "text-warning",
          )}
          title={`Target: ${target}${suffix ?? ""}`}
        >
          {targetGood ? "✓" : "!"} {delta_target > 0 ? "+" : ""}
          {delta_target.toFixed(1)}% vs target {target}{suffix ?? ""}
        </div>
      )}
      {hint && (
        <div className="mt-2 text-xs text-text-muted truncate">{hint}</div>
      )}
    </>
  );

  if (href) {
    return <Link href={href} className={cardClass}>{inner}</Link>;
  }

  if (drill) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={cn(cardClass, "text-left w-full")}>
          {inner}
        </button>
        {open && (
          <DrillDownModal
            title={drill.title ?? label}
            subtitle={drill.subtitle ?? hint ?? ""}
            endpoint={drill.endpoint}
            filename={drill.filename ?? `${label.toLowerCase().replace(/\W+/g, "_")}.csv`}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  return <div className={cardClass}>{inner}</div>;
}
