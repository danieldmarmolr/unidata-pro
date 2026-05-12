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
  disabled = false,
  lockedHint,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Si true, los botones no responden y se muestran con menor opacidad */
  disabled?: boolean;
  /** Texto opcional que aparece al lado cuando esta locked (ej: "Fijado por seccion") */
  lockedHint?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <div
        className={cn(
          "inline-flex bg-soft border border-border rounded-lg p-1",
          disabled && "opacity-60",
        )}
        title={disabled ? (lockedHint || "Fijado por la sección actual") : undefined}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap",
              value === opt.value
                ? "bg-surface text-primary shadow-sm"
                : "text-text-muted hover:text-primary",
              disabled && "cursor-not-allowed hover:text-text-muted",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {disabled && lockedHint && (
        <span className="text-[10px] text-text-muted italic">{lockedHint}</span>
      )}
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
