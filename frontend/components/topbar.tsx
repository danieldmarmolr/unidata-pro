"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, RefreshCcw, CalendarRange, Calendar } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getUser, type AuthUser } from "@/lib/api";
import { useGlobalFilters, type Period } from "@/lib/store";
import { cn } from "@/lib/utils";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "HOY" },
  { value: "yesterday", label: "AYER" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "12m", label: "12 meses" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function CustomRangePicker() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const setCustomRange = useGlobalFilters((s) => s.setCustomRange);
  const setPeriod = useGlobalFilters((s) => s.setPeriod);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(customFrom ?? todayIso());
  const [to, setTo] = useState(customTo ?? todayIso());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [open]);

  const isActive = period === "custom";
  const label = isActive && customFrom && customTo
    ? `${customFrom} → ${customTo}`
    : "Personalizado";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-2.5 py-1 text-[11px] font-semibold rounded-md transition whitespace-nowrap inline-flex items-center gap-1.5",
          isActive
            ? "bg-surface text-primary shadow-sm"
            : "text-text-muted hover:text-primary",
        )}
      >
        <Calendar size={11} />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-surface border border-border rounded-xl shadow-lg p-4 w-[280px]">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
            Rango personalizado
          </div>
          <div className="space-y-2">
            <label className="block text-xs">
              <span className="text-text-muted">Desde</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="block w-full mt-1 px-2 py-1.5 border border-border rounded text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="text-text-muted">Hasta</span>
              <input
                type="date"
                value={to}
                min={from}
                max={todayIso()}
                onChange={(e) => setTo(e.target.value)}
                className="block w-full mt-1 px-2 py-1.5 border border-border rounded text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                setCustomRange(from, to);
                setOpen(false);
              }}
              className="flex-1 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow"
            >
              Aplicar
            </button>
            {isActive && (
              <button
                onClick={() => {
                  setPeriod("30d");
                  setOpen(false);
                }}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text"
              >
                Quitar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar({
  title,
  subtitle,
  hidePeriod = false,
}: {
  title: string;
  subtitle?: string;
  hidePeriod?: boolean;
}) {
  const qc = useQueryClient();
  const period = useGlobalFilters((s) => s.period);
  const setPeriod = useGlobalFilters((s) => s.setPeriod);
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => setUser(getUser()), []);
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const display = user?.name || user?.email?.split("@")[0] || "anonimo";
  return (
    <header className="h-16 bg-surface border-b border-border px-8 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-text leading-none">{title}</h1>
        {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        {!hidePeriod && (
          <div className="hidden md:flex items-center gap-1.5 pr-2 mr-1 border-r border-border">
            <CalendarRange size={13} className="text-text-muted" />
            <div className="inline-flex bg-soft border border-border rounded-lg p-0.5">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-semibold rounded-md transition whitespace-nowrap",
                    period === p.value
                      ? "bg-surface text-primary shadow-sm"
                      : "text-text-muted hover:text-primary",
                  )}
                >
                  {p.label}
                </button>
              ))}
              <CustomRangePicker />
            </div>
          </div>
        )}
        <button
          onClick={() => qc.invalidateQueries()}
          title="Refrescar datos"
          className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
        >
          <RefreshCcw size={15} />
        </button>
        <button
          title="Notificaciones"
          className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
        >
          <Bell size={15} />
        </button>
        <div className="ml-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-soft border border-border">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-primary text-white flex items-center justify-center text-xs font-bold">
            {initial}
          </div>
          <div className="text-xs">
            <div className="font-semibold text-text leading-none">{display}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{user?.role || "..."}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
