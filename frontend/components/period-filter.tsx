"use client";

import { cn } from "@/lib/utils";

export type Period = "7d" | "30d" | "90d" | "12m";
export type Channel = "all" | "tn" | "ml";

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  "12m": "12 meses",
};

const CHANNEL_LABELS: Record<Channel, string> = {
  all: "TN + ML",
  tn: "Tienda Nube",
  ml: "Mercado Libre",
};

export function PeriodFilter({
  period,
  channel,
  onPeriodChange,
  onChannelChange,
}: {
  period: Period;
  channel: Channel;
  onPeriodChange: (p: Period) => void;
  onChannelChange?: (c: Channel) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Period segmented */}
      <div className="inline-flex bg-soft border border-border rounded-lg p-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-md transition",
              period === p
                ? "bg-surface text-primary shadow-sm"
                : "text-text-muted hover:text-primary",
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      {onChannelChange && (
        <div className="inline-flex bg-soft border border-border rounded-lg p-1">
          {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => onChannelChange(c)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition",
                channel === c
                  ? "bg-surface text-primary shadow-sm"
                  : "text-text-muted hover:text-primary",
              )}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
