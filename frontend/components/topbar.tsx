"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, RefreshCcw, CalendarRange, Calendar, Search, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getUser, type AuthUser } from "@/lib/api";
import { useGlobalFilters, type Period } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SkuSearchBox } from "@/components/sku-search-box";

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

function GlobalSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-text">Buscar SKU o EAN globalmente</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <SkuSearchBox
            unit="unistore"
            placeholder="Escribi un SKU o escanea EAN..."
            autoFocus
            onSkuSelected={(sku) => {
              onClose();
              router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
            }}
          />
          <div className="mt-3 text-[11px] text-text-muted">
            Tip: <kbd className="bg-soft border border-border rounded px-1.5 py-0.5 font-mono">Ctrl+K</kbd> abre este buscador desde cualquier pagina.
          </div>
        </div>
      </div>
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
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => setUser(getUser()), []);

  // Atajo Ctrl+K / Cmd+K para abrir busqueda global
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const display = user?.name || user?.email?.split("@")[0] || "anonimo";
  return (
    <>
      <header className="h-14 sm:h-16 bg-surface border-b border-border px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 lg:pl-8 pl-16">
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-bold text-text leading-none truncate">{title}</h1>
          {subtitle && <div className="text-[10px] sm:text-xs text-text-muted mt-1 truncate">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {!hidePeriod && (
            <div className="hidden lg:flex items-center gap-1.5 pr-2 mr-1 border-r border-border">
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
            onClick={() => setSearchOpen(true)}
            title="Buscar SKU/EAN (Ctrl+K)"
            className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
          >
            <Search size={15} />
          </button>
          <button
            onClick={() => qc.invalidateQueries()}
            title="Refrescar datos"
            className="hidden sm:grid w-9 h-9 place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
          >
            <RefreshCcw size={15} />
          </button>
          <button
            title="Notificaciones"
            className="hidden sm:grid w-9 h-9 place-items-center rounded-lg border border-border bg-surface text-text-muted hover:text-primary hover:border-primary/40 transition"
          >
            <Bell size={15} />
          </button>
          <div className="ml-1 sm:ml-2 flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-soft border border-border">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initial}
            </div>
            <div className="text-xs hidden sm:block">
              <div className="font-semibold text-text leading-none truncate max-w-[120px]">{display}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{user?.role || "..."}</div>
            </div>
          </div>
        </div>
      </header>

      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
