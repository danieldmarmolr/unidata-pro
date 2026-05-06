"use client";

import { cn } from "@/lib/utils";

export type Period = "7d" | "30d" | "90d" | "12m";
export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "12m", label: "12 meses" },
];

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-soft border border-border rounded-lg p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap",
            value === opt.value
              ? "bg-surface text-primary shadow-sm"
              : "text-text-muted hover:text-primary",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodSegmented({
  value,
  onChange,
}: {
  value: Period;
  onChange: (v: Period) => void;
}) {
  return <Segmented value={value} options={PERIOD_OPTIONS} onChange={onChange} />;
}
