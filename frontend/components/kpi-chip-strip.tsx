"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { KpiCard as KpiCardT } from "@/lib/types";
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

function Chip({ data, drill }: { data: KpiCardT; drill?: KpiDrill }) {
  const [open, setOpen] = useState(false);
  const interactive = !!drill;
  const cls = cn(
    "group flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg bg-surface border border-border min-w-[120px] transition",
    interactive && "hover:border-primary/40 hover:shadow-sm cursor-pointer text-left",
  );
  const inner = (
    <>
      <div className="flex items-center gap-1 w-full">
        <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted truncate flex-1">
          {data.label}
        </span>
        {interactive && (
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
  if (drill) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={cls}>{inner}</button>
        {open && (
          <DrillDownModal
            title={drill.title ?? data.label}
            subtitle={drill.subtitle ?? data.hint ?? ""}
            endpoint={drill.endpoint}
            filename={drill.filename ?? `${data.label.toLowerCase().replace(/\W+/g, "_")}.csv`}
            onClose={() => setOpen(false)}
          />
        )}
      </>
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
