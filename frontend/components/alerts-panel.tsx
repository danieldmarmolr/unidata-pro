"use client";

import Link from "next/link";
import { Bell, ShieldCheck, ArrowUpRight } from "lucide-react";

function alertHref(alert: string): string | null {
  const a = alert.toLowerCase();
  if (a.includes("pedidos") && a.includes("atascados")) return "/dashboard/logistica";
  if (a.includes("sin fulfillment")) return "/dashboard/logistica";
  if (a.includes("suscripciones") && a.includes("vencen")) return "/dashboard/saas";
  if (a.includes("publicaciones ml")) return "/dashboard/saas";
  if (a.includes("integracion") || a.includes("sin sync") || a.includes("sin lectura")) return "/dashboard/sources";
  if (a.includes("cancelacion")) return "/dashboard/cs";
  return null;
}

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
          {alerts.map((a, i) => {
            const href = alertHref(a);
            const inner = (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                <span className="text-sm text-text leading-snug flex-1">{a}</span>
                {href && (
                  <ArrowUpRight size={13} className="text-primary opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5" />
                )}
              </>
            );
            return (
              <li key={i}>
                {href ? (
                  <Link
                    href={href}
                    className="group flex items-start gap-3 p-3 rounded-lg bg-soft border border-border hover:border-primary/40 hover:bg-soft transition cursor-pointer"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-soft border border-border">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
