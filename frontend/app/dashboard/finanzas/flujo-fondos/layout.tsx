"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { cn } from "@/lib/utils";
import { PiggyBank, Receipt, LineChart } from "lucide-react";

const TABS = [
  { href: "/dashboard/finanzas/flujo-fondos",            label: "Inicio",      icon: PiggyBank, subtitle: "Tesoreria del grupo Unistore" },
  { href: "/dashboard/finanzas/flujo-fondos/erogaciones", label: "Erogaciones", icon: Receipt,   subtitle: "Pagos pendientes, en curso y pagados" },
  { href: "/dashboard/finanzas/flujo-fondos/proyeccion",  label: "Proyeccion",  icon: LineChart, subtitle: "Saldo dia a dia proyectado" },
];

export default function FlujoFondosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = TABS.find((t) => t.href === pathname) ?? TABS[0];
  return (
    <>
      <Topbar title={`Flujo de Fondos · ${active.label}`} subtitle={active.subtitle} hidePeriod />
      <nav className="border-b border-border bg-surface">
        <div className="px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => {
            const I = t.icon;
            const isActive = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-text-muted hover:text-text hover:bg-soft",
                )}
              >
                <I size={14} /> {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}
