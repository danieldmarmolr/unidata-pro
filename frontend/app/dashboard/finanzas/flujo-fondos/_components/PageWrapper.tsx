"use client";

import { Loader2 } from "lucide-react";

export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-4">
      {children}
    </div>
  );
}

export function LoadingState({ label = "Cargando..." }: { label?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center text-text-muted flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700 text-sm">
      {message}
    </div>
  );
}

export function EmptyState({ label = "Sin resultados" }: { label?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center text-text-muted">
      {label}
    </div>
  );
}

export function Tile({ label, value, sub, highlight, color }: {
  label: string; value: string; sub?: string; highlight?: boolean; color?: string;
}) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-soft border border-primary/30" : "bg-soft"}`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</div>
      <div className={`text-base font-bold mt-1 ${color ?? (highlight ? "text-primary" : "text-text")}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
