"use client";

import { Bell, ShieldCheck } from "lucide-react";

export function AlertsPanel({ alerts }: { alerts: string[] }) {
  const allClean =
    alerts.length === 1 && alerts[0].toLowerCase().includes("sin alertas");

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Bell size={14} className="text-primary" />
        <div className="text-sm font-bold text-text">Alertas operativas</div>
      </div>

      {allClean ? (
        <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-100">
          <ShieldCheck size={18} className="text-success shrink-0" />
          <div className="text-sm text-emerald-900">{alerts[0]}</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg bg-soft border border-border hover:border-primary/30 transition"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <span className="text-sm text-text leading-snug">{a}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
