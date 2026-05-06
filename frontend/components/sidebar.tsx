"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getUser, type AuthUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  Truck,
  Wallet,
  Megaphone,
  Crown,
  CreditCard,
  Package,
  Database,
  Terminal,
  ScrollText,
  LogOut,
  UserCog,
  UserCircle,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group?: string;
  badge?: string;
  adminOnly?: boolean;
};

const ITEMS: NavItem[] = [
  { label: "Gerencial",        href: "/dashboard",                icon: Crown,           group: "Cross" },
  { label: "Ventas",           href: "/dashboard/ventas",         icon: TrendingUp,      group: "Unistore" },
  { label: "Logistica",        href: "/dashboard/logistica",      icon: Truck,           group: "Unistore" },
  { label: "Finanzas",         href: "/dashboard/finanzas",       icon: Wallet,          group: "Unistore" },
  { label: "Marketing",        href: "/dashboard/marketing",      icon: Megaphone,       group: "Cross" },
  { label: "SaaS Metrics",     href: "/dashboard/saas",           icon: LayoutDashboard, group: "Unidrop" },
  { label: "Pagos Talo",       href: "/dashboard/pagos",          icon: CreditCard,      group: "Unidrop" },
  { label: "Envios",           href: "/dashboard/envios",         icon: Package,         group: "Unidrop" },
  { label: "Explorador",       href: "/dashboard/sources",        icon: Database,        group: "Datos" },
  { label: "SQL libre",        href: "/dashboard/sql",            icon: Terminal,        group: "Datos" },
  { label: "Audit log",        href: "/dashboard/audit",          icon: ScrollText,      group: "Datos",       adminOnly: true },
  { label: "Usuarios",         href: "/dashboard/admin/users",    icon: UserCog,         group: "Admin",       adminOnly: true },
  { label: "Mi cuenta",        href: "/dashboard/account",        icon: UserCircle,      group: "Admin" },
];

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-5 pb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
      {children}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUserState] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUserState(getUser());
  }, []);

  const visibleItems = ITEMS.filter((it) => !it.adminOnly || user?.role === "admin");

  const grouped = visibleItems.reduce<Record<string, NavItem[]>>((acc, it) => {
    const g = it.group ?? "Otros";
    if (!acc[g]) acc[g] = [];
    acc[g].push(it);
    return acc;
  }, {});

  return (
    <aside className="w-64 shrink-0 bg-gradient-to-b from-[#21093a] to-[#4e1e7a] text-white flex flex-col">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-primary/40 flex items-center justify-center font-extrabold text-lg">
            U
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-tight leading-none">UNIDATA</div>
            <div className="text-[11px] text-white/60 mt-0.5">Unistore Group</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <GroupHeader>{group}</GroupHeader>
            {items.map((it) => {
              const Icon = it.icon;
              const active = pathname === it.href || (it.href !== "/dashboard" && pathname.startsWith(it.href));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg mx-1 my-0.5 text-sm transition",
                    active
                      ? "bg-white/15 text-white shadow-inner"
                      : "text-white/70 hover:text-white hover:bg-white/8",
                  )}
                >
                  <Icon size={16} className="shrink-0 opacity-90" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.badge && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">
                      {it.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
          className="w-full flex items-center gap-2 justify-center px-3 py-2 rounded-lg text-sm text-white/80 hover:text-white hover:bg-white/8 transition"
        >
          <LogOut size={14} /> Cerrar sesion
        </button>
      </div>
    </aside>
  );
}
