"use client";

import { ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/utils";

type Step = { category: string; value: number };

export function Funnel({
  steps,
  caption,
  subtitle,
}: {
  steps: Step[];
  caption?: string;
  subtitle?: string;
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  const top = steps[0]?.value ?? 0;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {(caption || subtitle) && (
        <div className="mb-4">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
      )}
      <div className="space-y-2">
        {steps.map((step, i) => {
          const pct = (step.value / max) * 100;
          const conv = top > 0 ? (step.value / top) * 100 : 0;
          const stepConv =
            i === 0
              ? null
              : steps[i - 1].value > 0
                ? (step.value / steps[i - 1].value) * 100
                : 0;
          return (
            <div key={step.category}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-text">{step.category}</span>
                <span className="flex items-center gap-3 text-text-muted">
                  <span className="font-bold text-text">{formatNumber(step.value)}</span>
                  <span>{conv.toFixed(1)}% del total</span>
                  {stepConv !== null && (
                    <span className="inline-flex items-center gap-1 text-primary font-semibold">
                      <ChevronRight size={11} />
                      {stepConv.toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
              <div className="h-7 bg-soft rounded-md overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-md transition-all duration-500"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
