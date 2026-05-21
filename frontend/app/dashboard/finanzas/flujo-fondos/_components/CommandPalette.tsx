"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Search, X, Building2, Receipt, Handshake, Navigation, ArrowRight, PiggyBank, AlertTriangle, TrendingUp, Repeat, CalendarRange, Wallet, LineChart, BarChart3, Activity, PieChart, Target, Lightbulb, Boxes, Landmark, Users, Upload } from "lucide-react";
import { fmtArs, fmtDate, ESTADO_LABEL } from "./helpers";

type SearchResp = {
  proveedores: { id: number; nombre: string; cuit: string | null; prioridad: string; saldo_pendiente: number }[];
  erogaciones: { id: number; fecha_pago: string; descripcion: string; monto: number; estado: string; proveedor_nombre: string | null }[];
  acuerdos: { id: number; compromiso: string; tipo: string; estado: string; fecha_compromiso: string | null; proveedor_id: number | null; proveedor_nombre: string | null }[];
};

const NAV_ITEMS = [
  { label: "Inicio", href: "/dashboard/finanzas/flujo-fondos", icon: PiggyBank, group: "Tablero" },
  { label: "Erogaciones", href: "/dashboard/finanzas/flujo-fondos/erogaciones", icon: Receipt, group: "Operacion" },
  { label: "Pagos atrasados", href: "/dashboard/finanzas/flujo-fondos/pagos-atrasados", icon: AlertTriangle, group: "Operacion" },
  { label: "Ingresos puntuales", href: "/dashboard/finanzas/flujo-fondos/ingresos-puntuales", icon: TrendingUp, group: "Operacion" },
  { label: "Recurrencias", href: "/dashboard/finanzas/flujo-fondos/recurrencias", icon: Repeat, group: "Operacion" },
  { label: "Acuerdos", href: "/dashboard/finanzas/flujo-fondos/acuerdos", icon: Handshake, group: "Operacion" },
  { label: "Calendario de caja", href: "/dashboard/finanzas/flujo-fondos/calendario", icon: CalendarRange, group: "Operacion" },
  { label: "Saldos iniciales", href: "/dashboard/finanzas/flujo-fondos/saldos", icon: Wallet, group: "Operacion" },
  { label: "Importar Excel", href: "/dashboard/finanzas/flujo-fondos/importar", icon: Upload, group: "Operacion" },
  { label: "Proyeccion de saldo", href: "/dashboard/finanzas/flujo-fondos/proyeccion", icon: LineChart, group: "Motor" },
  { label: "Facturacion diaria", href: "/dashboard/finanzas/flujo-fondos/facturacion", icon: BarChart3, group: "Motor" },
  { label: "Promedios", href: "/dashboard/finanzas/flujo-fondos/promedios", icon: Activity, group: "Motor" },
  { label: "Analisis de gastos", href: "/dashboard/finanzas/flujo-fondos/analisis", icon: PieChart, group: "Motor" },
  { label: "Precision del modelo", href: "/dashboard/finanzas/flujo-fondos/precision", icon: Target, group: "Motor" },
  { label: "Sugerencias", href: "/dashboard/finanzas/flujo-fondos/sugerencias", icon: Lightbulb, group: "Motor" },
  { label: "Empresas", href: "/dashboard/finanzas/flujo-fondos/empresas", icon: Building2, group: "Maestros" },
  { label: "Unidades de negocio", href: "/dashboard/finanzas/flujo-fondos/unidades-negocio", icon: Boxes, group: "Maestros" },
  { label: "Bancos", href: "/dashboard/finanzas/flujo-fondos/bancos", icon: Landmark, group: "Maestros" },
  { label: "Proveedores", href: "/dashboard/finanzas/flujo-fondos/proveedores", icon: Users, group: "Maestros" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setQ("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced query
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery<SearchResp>({
    queryKey: ["ff", "search", debounced],
    queryFn: () => api(`/api/flujo-fondos/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 1,
    staleTime: 10_000,
  });

  // Combinar resultados en una lista linear para navegacion con teclas
  const items = useMemo(() => {
    const list: { kind: string; label: string; sub: string; href: string; icon?: React.ComponentType<{ size?: number; className?: string }> }[] = [];
    const filteredNav = q.trim() ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase())) : NAV_ITEMS;
    if (filteredNav.length > 0) {
      for (const n of filteredNav.slice(0, q.trim() ? 8 : 18)) {
        list.push({ kind: "nav", label: n.label, sub: n.group, href: n.href, icon: n.icon });
      }
    }
    if (searchQ.data) {
      for (const p of searchQ.data.proveedores) {
        list.push({ kind: "proveedor", label: p.nombre, sub: `${p.cuit ?? "Sin CUIT"} · ${p.prioridad} · saldo ${fmtArs(p.saldo_pendiente)}`, href: `/dashboard/finanzas/flujo-fondos/proveedores/${p.id}` });
      }
      for (const e of searchQ.data.erogaciones) {
        list.push({ kind: "erogacion", label: e.descripcion, sub: `${fmtDate(e.fecha_pago)} · ${fmtArs(e.monto)} · ${ESTADO_LABEL[e.estado] ?? e.estado}${e.proveedor_nombre ? " · " + e.proveedor_nombre : ""}`, href: `/dashboard/finanzas/flujo-fondos/erogaciones` });
      }
      for (const a of searchQ.data.acuerdos) {
        list.push({ kind: "acuerdo", label: a.compromiso, sub: `${a.tipo} · ${a.estado}${a.proveedor_nombre ? " · " + a.proveedor_nombre : ""}${a.fecha_compromiso ? " · " + fmtDate(a.fecha_compromiso) : ""}`, href: a.proveedor_id ? `/dashboard/finanzas/flujo-fondos/proveedores/${a.proveedor_id}` : `/dashboard/finanzas/flujo-fondos/acuerdos` });
      }
    }
    return list;
  }, [q, searchQ.data]);

  useEffect(() => {
    setActiveIdx(0);
  }, [items.length, q]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(items.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[activeIdx];
        if (item) { router.push(item.href); onClose(); }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, activeIdx, router, onClose]);

  if (!open) return null;

  const grupos = items.reduce<Record<string, typeof items>>((acc, it, idx) => {
    const key = it.kind === "nav" ? "Navegacion" : it.kind === "proveedor" ? "Proveedores" : it.kind === "erogacion" ? "Erogaciones" : "Acuerdos";
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...it, _idx: idx } as never);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh]" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar proveedores, erogaciones, acuerdos o ir a una pantalla..."
            className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-text-muted"
          />
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={16} /></button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {searchQ.isFetching && debounced && <div className="p-4 text-xs text-text-muted">Buscando...</div>}
          {items.length === 0 && (
            <div className="p-8 text-center text-text-muted text-sm">
              {q.trim() ? `Sin resultados para "${q}"` : "Escribi para buscar o navegar..."}
            </div>
          )}
          {Object.entries(grupos).map(([grupo, list]) => (
            <div key={grupo}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-bold bg-soft/50 sticky top-0">{grupo}</div>
              {list.map((it) => {
                const idx = (it as never as { _idx: number })._idx;
                const isActive = idx === activeIdx;
                const Icon = it.icon ?? (it.kind === "proveedor" ? Building2 : it.kind === "erogacion" ? Receipt : it.kind === "acuerdo" ? Handshake : Navigation);
                return (
                  <Link
                    key={`${it.kind}-${it.href}-${it.label}-${idx}`}
                    href={it.href}
                    onClick={onClose}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`flex items-center gap-3 px-3 py-2 ${isActive ? "bg-primary/10" : "hover:bg-soft"}`}
                  >
                    <Icon size={14} className={`shrink-0 ${isActive ? "text-primary" : "text-text-muted"}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${isActive ? "text-primary" : "text-text"}`}>{it.label}</div>
                      <div className="text-[11px] text-text-muted truncate">{it.sub}</div>
                    </div>
                    <ArrowRight size={12} className={`shrink-0 ${isActive ? "text-primary opacity-100" : "opacity-0"}`} />
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="px-3 py-2 border-t border-border bg-soft/50 text-[10px] text-text-muted flex items-center justify-between">
          <div className="flex gap-3">
            <span><kbd className="px-1.5 py-0.5 bg-surface border border-border rounded">↑↓</kbd> navegar</span>
            <span><kbd className="px-1.5 py-0.5 bg-surface border border-border rounded">↵</kbd> abrir</span>
            <span><kbd className="px-1.5 py-0.5 bg-surface border border-border rounded">Esc</kbd> cerrar</span>
          </div>
          <div><kbd className="px-1.5 py-0.5 bg-surface border border-border rounded">Ctrl K</kbd> abrir desde cualquier solapa</div>
        </div>
      </div>
    </div>
  );
}
