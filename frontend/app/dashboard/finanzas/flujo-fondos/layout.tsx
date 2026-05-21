"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { cn } from "@/lib/utils";
import {
  PiggyBank,
  Receipt,
  AlertTriangle,
  TrendingUp,
  Repeat,
  Handshake,
  CalendarRange,
  Wallet,
  LineChart,
  BarChart3,
  Activity,
  PieChart,
  Target,
  Lightbulb,
  Building2,
  Boxes,
  Landmark,
  Users,
  Upload,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof PiggyBank };
type NavGroup = { group: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: "Tablero",
    items: [
      { href: "/dashboard/finanzas/flujo-fondos", label: "Inicio", icon: PiggyBank },
    ],
  },
  {
    group: "Operacion diaria",
    items: [
      { href: "/dashboard/finanzas/flujo-fondos/erogaciones", label: "Erogaciones", icon: Receipt },
      { href: "/dashboard/finanzas/flujo-fondos/pagos-atrasados", label: "Pagos atrasados", icon: AlertTriangle },
      { href: "/dashboard/finanzas/flujo-fondos/ingresos-puntuales", label: "Ingresos puntuales", icon: TrendingUp },
      { href: "/dashboard/finanzas/flujo-fondos/recurrencias", label: "Recurrencias", icon: Repeat },
      { href: "/dashboard/finanzas/flujo-fondos/acuerdos", label: "Acuerdos", icon: Handshake },
      { href: "/dashboard/finanzas/flujo-fondos/calendario", label: "Calendario de caja", icon: CalendarRange },
      { href: "/dashboard/finanzas/flujo-fondos/saldos", label: "Saldos iniciales", icon: Wallet },
      { href: "/dashboard/finanzas/flujo-fondos/importar", label: "Importar Excel", icon: Upload },
    ],
  },
  {
    group: "Motor y analisis",
    items: [
      { href: "/dashboard/finanzas/flujo-fondos/proyeccion", label: "Proyeccion de saldo", icon: LineChart },
      { href: "/dashboard/finanzas/flujo-fondos/facturacion", label: "Facturacion diaria", icon: BarChart3 },
      { href: "/dashboard/finanzas/flujo-fondos/promedios", label: "Promedios", icon: Activity },
      { href: "/dashboard/finanzas/flujo-fondos/analisis", label: "Analisis de gastos", icon: PieChart },
      { href: "/dashboard/finanzas/flujo-fondos/precision", label: "Precision del modelo", icon: Target },
      { href: "/dashboard/finanzas/flujo-fondos/sugerencias", label: "Sugerencias", icon: Lightbulb },
    ],
  },
  {
    group: "Datos maestros",
    items: [
      { href: "/dashboard/finanzas/flujo-fondos/empresas", label: "Empresas", icon: Building2 },
      { href: "/dashboard/finanzas/flujo-fondos/unidades-negocio", label: "Unidades de negocio", icon: Boxes },
      { href: "/dashboard/finanzas/flujo-fondos/bancos", label: "Bancos", icon: Landmark },
      { href: "/dashboard/finanzas/flujo-fondos/proveedores", label: "Proveedores", icon: Users },
    ],
  },
];

function findActive(pathname: string): { group: NavGroup; item: NavItem } {
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.href === pathname) return { group: g, item: it };
    }
  }
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.href !== "/dashboard/finanzas/flujo-fondos" && pathname.startsWith(it.href)) {
        return { group: g, item: it };
      }
    }
  }
  return { group: NAV[0], item: NAV[0].items[0] };
}

export default function FlujoFondosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { group: activeGroup, item: activeItem } = findActive(pathname);

  return (
    <>
      <Topbar
        title={`Flujo de Fondos · ${activeItem.label}`}
        subtitle={`${activeGroup.group} · Tesoreria del grupo Unistore`}
        hidePeriod
      />

      <nav className="border-b border-border bg-surface">
        <div className="px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto -mb-px">
          {NAV.map((g) => {
            const isActive = g.group === activeGroup.group;
            const firstHref = g.items[0]?.href ?? "/dashboard/finanzas/flujo-fondos";
            return (
              <Link
                key={g.group}
                href={firstHref}
                className={cn(
                  "px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap uppercase tracking-wider text-[11px]",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-text-muted hover:text-text hover:bg-soft",
                )}
              >
                {g.group}
              </Link>
            );
          })}
        </div>
      </nav>

      {activeGroup.items.length > 1 && (
        <nav className="border-b border-border bg-soft">
          <div className="px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto py-1.5">
            {activeGroup.items.map((it) => {
              const I = it.icon;
              const isActive = it.href === activeItem.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap",
                    isActive
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-muted hover:text-text hover:bg-surface",
                  )}
                >
                  <I size={12} /> {it.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {children}
    </>
  );
}
