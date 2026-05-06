"use client";

import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
import type { IntegrationHealth as Health } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META = {
  ok:    { color: "text-success",    bg: "bg-emerald-50",  icon: CheckCircle2,  label: "OK" },
  warn:  { color: "text-warn",       bg: "bg-amber-50",    icon: AlertTriangle, label: "Lento" },
  error: { color: "text-error",      bg: "bg-red-50",      icon: AlertOctagon,  label: "Sin sync" },
} as const;

export function IntegrationHealthList({ items }: { items: Health[] }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="text-sm font-bold text-text mb-4">Salud de integraciones</div>
      <ul className="space-y-2">
        {items.map((it) => {
          const meta = STATUS_META[it.status];
          const Icon = meta.icon;
          return (
            <li
              key={`${it.unit}-${it.name}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-soft transition"
            >
              <div className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", meta.bg, meta.color)}>
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text truncate">{it.name}</div>
                <div className="text-xs text-text-muted truncate">
                  {it.unit} ·{" "}
                  {it.last_event_at
                    ? `ultima actividad hace ${it.days_since_last ?? "?"}d`
                    : "sin lectura"}
                </div>
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full",
                  meta.bg,
                  meta.color,
                )}
              >
                {meta.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
