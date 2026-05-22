"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, RefreshCcw, CalendarRange, Calendar, Search, X, AlertCircle, AlertTriangle, Info, RotateCcw, CalendarClock, Wallet, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getUser, type AuthUser } from "@/lib/api";
import { useGlobalFilters, type Period } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SkuSearchBox } from "@/components/sku-search-box";
import { DrillDownModal } from "@/components/drilldown-modal";
import { NotificationBell as PeopleNotificationBell } from "@/components/people/notification-bell";
import { todayArIso } from "@/lib/dates";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "HOY" },
  { value: "yesterday", label: "AYER" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "12m", label: "12 meses" },
];

function todayIso(): string {
  return todayArIso();
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
      <header className="sticky top-0 z-30 min-h-14 sm:min-h-16 bg-surface border-b border-border px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 lg:pl-8 pl-16 flex-wrap py-2 sm:py-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-bold text-text leading-none truncate">{title}</h1>
          {subtitle && <div className="text-[10px] sm:text-xs text-text-muted mt-1 truncate">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
          {!hidePeriod && (
            <div className="flex items-center gap-1.5 sm:pr-2 sm:mr-1 sm:border-r sm:border-border order-last sm:order-none w-full sm:w-auto">
              <CalendarRange size={13} className="text-text-muted hidden sm:block" />
              <div className="inline-flex bg-soft border border-border rounded-lg p-0.5 flex-wrap sm:flex-nowrap w-full sm:w-auto justify-center">
                {PERIOD_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={cn(
                      "px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold rounded-md transition whitespace-nowrap",
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
          <NotificationBell />
          <PeopleNotificationBell />
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

// ============================================================
// Notification bell con dropdown en vivo
// ============================================================
type NotifItem = {
  id: string;
  severity: "error" | "warning" | "info";
  icon: string;
  title: string;
  body: string;
  href?: string;
  drill?: { endpoint: string; title: string; filename: string };
  count: number;
};
type NotifResp = {
  items: NotifItem[];
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  generated_at: string;
};

const ICON_MAP: Record<string, any> = {
  alert: AlertTriangle,
  x: AlertCircle,
  rotate: RotateCcw,
  calendar: CalendarClock,
  wallet: Wallet,
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState<{ endpoint: string; title: string; filename: string } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery<NotifResp>({
    queryKey: ["notifications"],
    queryFn: () => api<NotifResp>("/api/dashboards/notifications"),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [open]);

  const total = data?.total ?? 0;
  const hasError = (data?.errors ?? 0) > 0;
  const hasWarn = (data?.warnings ?? 0) > 0;

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={`${total} notificaciones`}
          className={cn(
            "hidden sm:grid relative w-9 h-9 place-items-center rounded-lg border bg-surface transition",
            total > 0
              ? hasError
                ? "border-rose-300 text-rose-600 hover:bg-rose-50"
                : hasWarn
                ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                : "border-blue-300 text-blue-700 hover:bg-blue-50"
              : "border-border text-text-muted hover:text-primary hover:border-primary/40",
          )}
        >
          <Bell size={15} />
          {total > 0 && (
            <span
              className={cn(
                "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white",
                hasError ? "bg-rose-500" : hasWarn ? "bg-amber-500" : "bg-blue-500",
              )}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 z-50 bg-surface border border-border rounded-xl shadow-xl w-[380px] max-w-[calc(100vw-32px)]">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-text">Notificaciones</div>
                <div className="text-[11px] text-text-muted">
                  {total === 0 ? "Sin alertas activas" : `${total} alertas activas`}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {!data ? (
                <div className="p-6 text-center text-text-muted text-xs">Cargando...</div>
              ) : data.items.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="text-4xl mb-2">✓</div>
                  <div className="text-sm font-semibold text-emerald-700">Todo en orden</div>
                  <div className="text-xs text-text-muted mt-1">Sin alertas operativas</div>
                </div>
              ) : (
                <div>
                  {data.items.map((n) => {
                    const Icon = ICON_MAP[n.icon] ?? Info;
                    const sevColor =
                      n.severity === "error"
                        ? "bg-rose-50 border-rose-200 text-rose-700"
                        : n.severity === "warning"
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-blue-50 border-blue-200 text-blue-700";
                    const action = (
                      <>
                        <div className="flex items-start gap-3">
                          <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0", sevColor)}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-text">{n.title}</div>
                            <div className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{n.body}</div>
                            <div className="flex items-center gap-2 mt-1.5">
                              {n.drill && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDrill(n.drill!);
                                    setOpen(false);
                                  }}
                                  className="text-[10px] font-bold text-primary hover:underline"
                                >
                                  Ver detalle
                                </button>
                              )}
                              {n.href && (
                                <span className="text-[10px] text-text-muted inline-flex items-center gap-0.5">
                                  <ExternalLink size={9} /> Ir a la pagina
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    );
                    if (n.href) {
                      return (
                        <Link
                          key={n.id}
                          href={n.href}
                          onClick={() => setOpen(false)}
                          className="block px-4 py-3 border-b border-border last:border-0 hover:bg-soft transition"
                        >
                          {action}
                        </Link>
                      );
                    }
                    return (
                      <div key={n.id} className="px-4 py-3 border-b border-border last:border-0">
                        {action}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {data && data.total > 0 && (
              <div className="px-4 py-2 border-t border-border bg-soft text-[10px] text-text-muted text-center">
                Refresca cada 60s · derivadas de business rules en runtime
              </div>
            )}
          </div>
        )}
      </div>

      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle="Drilldown desde notificaciones"
          endpoint={drill.endpoint}
          filename={drill.filename}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}
