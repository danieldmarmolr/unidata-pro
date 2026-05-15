"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  ShoppingBag,
  Database,
  DollarSign,
  Terminal,
  ScrollText,
  LogOut,
  UserCog,
  UserCircle,
  Bell,
  HeartHandshake,
  Sparkles,
  RotateCcw,
  Network,
  Users,
  Map as MapIcon,
  ChevronDown,
  Layers,
  Store,
  Boxes,
  Shapes,
  Settings,
  Target,
  Warehouse,
  Repeat,
  AlertTriangle,
  X,
} from "lucide-react";

type Role = "admin" | "user" | "gerencia" | "analista" | "lector";

/** Slugs de areas operativas (sin Gerencia que es ROL). */
type AreaSlug =
  | "administracion" | "compras" | "finanzas" | "ventas"
  | "logistica" | "cs" | "marketing" | "people" | "it_data";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group?: string;
  badge?: string;
  adminOnly?: boolean;
  /** Si presente, solo visible para esos roles (admin siempre puede ver). */
  roles?: Role[];
  /** Si presente, colaboradores con esas areas (o gerentes/admin) lo ven. */
  areas?: AreaSlug[];
  children?: NavItem[];
};

const ALL: Role[] = ["admin", "user", "gerencia", "analista", "lector"];
const ONLY_GERENCIA: Role[] = ["admin", "gerencia"];

const ITEMS: NavItem[] = [
  { label: "Inicio",           href: "/dashboard/home",           icon: LayoutDashboard, group: "Principal", roles: ALL },
  { label: "Mi perfil",        href: "/dashboard/perfil",         icon: UserCircle,      group: "Principal", roles: ALL },
  { label: "Notificaciones",   href: "/dashboard/notificaciones", icon: Bell,            group: "Principal", roles: ALL },
  { label: "Buscar clientes",  href: "/dashboard/clientes",       icon: Users,           group: "Principal", roles: ALL },
  { label: "Exportaciones",    href: "/dashboard/exports",        icon: Database,        group: "Principal", roles: ALL },
  { label: "Gerencia",         href: "/dashboard",                icon: Crown,           group: "Cross", roles: ONLY_GERENCIA },
  { label: "Marketing",        href: "/dashboard/marketing",      icon: Megaphone,       group: "Cross", roles: ONLY_GERENCIA, areas: ["marketing"] },
  {
    label: "Customer Success",
    href: "/dashboard/cs",
    icon: HeartHandshake,
    group: "Cross",
    roles: ONLY_GERENCIA,
    areas: ["cs"],
    children: [
      { label: "Vista general",       href: "/dashboard/cs",         icon: HeartHandshake },
      { label: "Bandeja CS",          href: "/dashboard/cs-acciones",icon: Target         },
      { label: "Cohortes",            href: "/dashboard/cohortes",   icon: Users          },
      { label: "Segmentacion RFM",    href: "/dashboard/rfm",        icon: Target         },
      { label: "RFM Flows (migración)", href: "/dashboard/rfm-flows", icon: Repeat        },
      { label: "NLP Cancelaciones",     href: "/dashboard/cancel-nlp", icon: AlertTriangle },
    ],
  },
  { label: "Ventas",           href: "/dashboard/ventas",         icon: TrendingUp,      group: "Cross", roles: ONLY_GERENCIA, areas: ["ventas"] },
  { label: "Logistica",        href: "/dashboard/logistica",      icon: Truck,           group: "Cross", roles: ONLY_GERENCIA, areas: ["logistica"] },
  { label: "Finanzas",         href: "/dashboard/finanzas",       icon: Wallet,          group: "Cross", roles: ONLY_GERENCIA, areas: ["finanzas", "administracion"] },
  { label: "Mapa de distribucion", href: "/dashboard/mapa",       icon: MapIcon,         group: "Cross", roles: ONLY_GERENCIA, areas: ["logistica", "ventas"] },
  {
    label: "Producto",
    href: "/dashboard/productos",
    icon: ShoppingBag,
    group: "Cross",
    roles: ONLY_GERENCIA,
    areas: ["ventas", "compras"],
    children: [
      { label: "Vista general",       href: "/dashboard/productos",           icon: ShoppingBag },
      { label: "Análisis ABC + más",  href: "/dashboard/productos/analytics", icon: Layers      },
      { label: "SKU Optimizer",       href: "/dashboard/sku-optimizer",       icon: Sparkles    },
      { label: "Forecast demanda",    href: "/dashboard/forecast",            icon: TrendingUp  },
      { label: "Costos importacion",  href: "/dashboard/costos",              icon: DollarSign  },
      { label: "Heatmap stock",       href: "/dashboard/stock-heatmap",       icon: Warehouse   },
    ],
  },
  // UNISTORE — todo lo que la BD de Unistore permite, locked a unistore_api
  { label: "Ventas",           href: "/dashboard/ventas?unit=unistore",     icon: TrendingUp,     group: "Unistore", roles: ALL, areas: ["ventas"] },
  { label: "Logistica",        href: "/dashboard/logistica?unit=unistore",  icon: Truck,          group: "Unistore", roles: ALL, areas: ["logistica"] },
  { label: "Customer Success", href: "/dashboard/cs?unit=unistore",         icon: HeartHandshake, group: "Unistore", roles: ALL, areas: ["cs"] },
  { label: "Cohortes",         href: "/dashboard/cohortes?unit=unistore",   icon: Users,          group: "Unistore", roles: ALL, areas: ["cs", "ventas"] },
  { label: "Segmentacion RFM", href: "/dashboard/rfm?unit=unistore",        icon: Target,         group: "Unistore", roles: ALL, areas: ["cs", "marketing"] },
  { label: "RFM Flows",        href: "/dashboard/rfm-flows?unit=unistore",  icon: Repeat,         group: "Unistore", roles: ALL, areas: ["cs", "marketing"] },
  { label: "Marketing",        href: "/dashboard/marketing?unit=unistore",  icon: Megaphone,      group: "Unistore", roles: ALL, areas: ["marketing"] },
  { label: "Finanzas",         href: "/dashboard/finanzas?unit=unistore",   icon: Wallet,         group: "Unistore", roles: ALL, areas: ["finanzas", "administracion"] },
  { label: "Buscar clientes",  href: "/dashboard/clientes?unit=unistore",   icon: Users,          group: "Unistore", roles: ALL },
  { label: "Envios por canal", href: "/dashboard/envios-unistore",          icon: Package,        group: "Unistore", roles: ALL, areas: ["logistica"] },

  // UNIDROP — todo lo que la BD de Unidrop permite, locked a unidrop_api
  { label: "Ventas",           href: "/dashboard/ventas?unit=unidrop",      icon: TrendingUp,     group: "Unidrop", roles: ALL, areas: ["ventas"] },
  { label: "Logistica",        href: "/dashboard/logistica?unit=unidrop",   icon: Truck,          group: "Unidrop", roles: ALL, areas: ["logistica"] },
  { label: "Customer Success", href: "/dashboard/cs?unit=unidrop",          icon: HeartHandshake, group: "Unidrop", roles: ALL, areas: ["cs"] },
  { label: "Cohortes",         href: "/dashboard/cohortes?unit=unidrop",    icon: Users,          group: "Unidrop", roles: ALL, areas: ["cs", "ventas"] },
  { label: "Segmentacion RFM", href: "/dashboard/rfm?unit=unidrop",         icon: Target,         group: "Unidrop", roles: ALL, areas: ["cs", "marketing"] },
  { label: "RFM Flows",        href: "/dashboard/rfm-flows?unit=unidrop",   icon: Repeat,         group: "Unidrop", roles: ALL, areas: ["cs", "marketing"] },
  { label: "Marketing",        href: "/dashboard/marketing?unit=unidrop",   icon: Megaphone,      group: "Unidrop", roles: ALL, areas: ["marketing"] },
  { label: "Finanzas",         href: "/dashboard/finanzas?unit=unidrop",    icon: Wallet,         group: "Unidrop", roles: ALL, areas: ["finanzas", "administracion"] },
  { label: "Buscar dropshippers", href: "/dashboard/clientes?unit=unidrop", icon: Users,          group: "Unidrop", roles: ALL },
  { label: "SaaS Metrics",     href: "/dashboard/saas",           icon: LayoutDashboard, group: "Unidrop", roles: ALL, areas: ["ventas", "marketing"] },
  { label: "Dropshippers",     href: "/dashboard/dropshippers",   icon: Users,           group: "Unidrop", roles: ALL, areas: ["ventas", "cs"] },
  { label: "Pagos Talo",       href: "/dashboard/pagos",          icon: CreditCard,      group: "Unidrop", roles: ALL, areas: ["finanzas", "administracion"] },
  { label: "Suscripciones MELI", href: "/dashboard/subscriptions-meli", icon: Sparkles,  group: "Unidrop", roles: ALL, areas: ["finanzas", "ventas"] },
  { label: "Envios",           href: "/dashboard/envios",         icon: Package,         group: "Unidrop", roles: ALL, areas: ["logistica"] },
  { label: "Envios MELI por modo", href: "/dashboard/envios-meli", icon: Package,        group: "Unidrop", roles: ALL, areas: ["logistica"] },
  { label: "Devoluciones",     href: "/dashboard/devoluciones",   icon: RotateCcw,       group: "Unidev", roles: ALL, areas: ["cs", "logistica"] },
  { label: "NLP causas (Unidev)", href: "/dashboard/dev-nlp",     icon: AlertTriangle,   group: "Unidev", roles: ALL, areas: ["cs", "it_data"] },
  { label: "Data Catalog",     href: "/dashboard/catalog",        icon: Network,         group: "Datos", roles: ["admin", "gerencia", "analista"], areas: ["it_data"] },
  { label: "Explorador",       href: "/dashboard/sources",        icon: Database,        group: "Datos", roles: ["admin", "analista"] },
  { label: "SQL libre",        href: "/dashboard/sql",            icon: Terminal,        group: "Datos", roles: ["admin", "analista"] },
  { label: "Audit log",        href: "/dashboard/audit",          icon: ScrollText,      group: "Datos",       adminOnly: true },
  { label: "Usuarios",         href: "/dashboard/admin/users",    icon: UserCog,         group: "Admin",       adminOnly: true },
  { label: "Mi cuenta",        href: "/dashboard/account",        icon: UserCircle,      group: "Admin" },
];

const GROUP_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Principal: LayoutDashboard,
  Cross: Layers,
  Unistore: Store,
  Unidrop: Boxes,
  Unidev: RotateCcw,
  Datos: Database,
  Admin: Settings,
};

const STORAGE_KEY = "unidata.sidebar.collapsed";

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  /** Control de visibilidad en mobile (drawer pattern). En desktop siempre se muestra. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUnit = searchParams?.get("unit") || null;
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Cerrar drawer en mobile al cambiar de ruta
  useEffect(() => {
    if (mobileOpen && onMobileClose) onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ESC cierra el drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onMobileClose) onMobileClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  useEffect(() => {
    setUserState(getUser());
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
      } catch {}
    }
  }, [collapsed, hydrated]);

  const role = (user?.role as Role) ?? "user";
  const isAdmin = !!user?.is_admin || role === "admin";
  // RBAC por area: si el user no es admin/gerencia y el item tiene `areas`,
  // solo se muestra si su area_slug esta incluida. Items sin `areas` se
  // consideran cross-area (todos los pueden ver, respetando roles).
  const userAreaSlug = (user?.area_slug as AreaSlug | undefined) ?? undefined;
  const isPriviledged = isAdmin || role === "gerencia";
  const visibleItems = ITEMS.filter((it) => {
    if (it.adminOnly && !isAdmin) return false;
    if (it.roles && !isAdmin && !it.roles.includes(role)) return false;
    // RBAC area: si tiene areas restrictivas, gerentes/admin pasan; colaboradores
    // requieren que su area este en la lista.
    if (it.areas && it.areas.length > 0 && !isPriviledged) {
      if (!userAreaSlug || !it.areas.includes(userAreaSlug)) return false;
    }
    return true;
  });

  const grouped = useMemo(() => {
    const out: Record<string, NavItem[]> = {};
    for (const it of visibleItems) {
      const g = it.group ?? "Otros";
      if (!out[g]) out[g] = [];
      out[g].push(it);
    }
    return out;
  }, [visibleItems]);

  const isActive = (href: string) => {
    // Separar pathname y query del href
    const [hrefPath, hrefQuery = ""] = href.split("?");
    const hrefUnit = new URLSearchParams(hrefQuery).get("unit");
    // Match base pathname
    const pathMatches = pathname === hrefPath || (hrefPath !== "/dashboard" && pathname.startsWith(hrefPath));
    if (!pathMatches) return false;
    // Si el href no especifica unit, solo activa cuando la URL TAMPOCO especifica
    // (asi el item "Cross" no se ilumina cuando estamos en ?unit=unistore).
    // Si el href especifica unit, debe coincidir exactamente con la URL.
    if (hrefUnit) return currentUnit === hrefUnit;
    return !currentUnit;
  };

  const toggle = (group: string) =>
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));

  return (
    <>
      {/* Backdrop overlay (mobile only) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "bg-gradient-to-b from-[#21093a] to-[#4e1e7a] text-white flex flex-col",
          // Desktop: estatico ancho 64, h-screen explicito para que el morado
          // llene SIEMPRE el viewport completo (a veces el flex stretch fallaba
          // en builds prod cuando algun child rompia el contrato de altura).
          "lg:static lg:w-64 lg:translate-x-0 lg:shrink-0 lg:h-screen",
          // Mobile: drawer fijo desde izquierda
          "fixed top-0 left-0 h-screen w-[280px] z-50 transform transition-transform duration-300 ease-out shadow-2xl",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-primary/40 flex items-center justify-center font-extrabold text-lg flex-shrink-0">
              U
            </div>
            <div className="min-w-0">
              <div className="text-lg font-extrabold tracking-tight leading-none">UNIDATA</div>
              <div className="text-[11px] text-white/60 mt-0.5 truncate">Unistore Group</div>
            </div>
          </div>
          {/* Boton cerrar (solo mobile) */}
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="lg:hidden text-white/70 hover:text-white p-1"
              aria-label="Cerrar menu"
            >
              <X size={20} />
            </button>
          )}
        </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {Object.entries(grouped).map(([group, items]) => {
          const GroupIcon = GROUP_ICONS[group] ?? Layers;
          const groupHasActive = items.some((it) => isActive(it.href));
          const isCollapsed = collapsed[group] ?? false;
          const showItems = !isCollapsed || groupHasActive;
          return (
            <div key={group} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(group)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg mx-1 text-[11px] font-bold uppercase tracking-wider transition",
                  groupHasActive
                    ? "text-white/90 bg-white/5"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5",
                )}
                aria-expanded={!isCollapsed}
              >
                <GroupIcon size={14} className="shrink-0 opacity-80" />
                <span className="flex-1 text-left">{group}</span>
                <span className="text-[9px] text-white/40 normal-case font-semibold">
                  {items.length}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    "shrink-0 opacity-70 transition-transform duration-200",
                    isCollapsed && "-rotate-90",
                  )}
                />
              </button>
              {showItems && (
                <div className="mt-0.5 ml-4 pl-2 border-l border-white/10">
                  {items.map((it) => {
                    const Icon = it.icon;
                    const active = isActive(it.href);
                    const hasChildren = it.children && it.children.length > 0;
                    const subKey = `sub:${it.href}`;
                    const childActive = hasChildren && it.children!.some((c) => isActive(c.href));
                    const subCollapsed = collapsed[subKey] ?? false;
                    const showChildren = hasChildren && (!subCollapsed || childActive);
                    return (
                      <div key={it.href}>
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggle(subKey)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg my-0.5 text-sm transition",
                              active || childActive
                                ? "bg-white/10 text-white"
                                : "text-white/70 hover:text-white hover:bg-white/8",
                            )}
                            aria-expanded={!subCollapsed}
                          >
                            <Icon size={14} className="shrink-0 opacity-80" />
                            <span className="flex-1 truncate text-left">{it.label}</span>
                            <ChevronDown
                              size={12}
                              className={cn(
                                "shrink-0 opacity-60 transition-transform",
                                subCollapsed && "-rotate-90",
                              )}
                            />
                          </button>
                        ) : (
                          <Link
                            href={it.href}
                            className={cn(
                              "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg my-0.5 text-sm transition",
                              active
                                ? "bg-white/15 text-white shadow-inner"
                                : "text-white/70 hover:text-white hover:bg-white/8",
                            )}
                          >
                            <Icon size={14} className="shrink-0 opacity-80" />
                            <span className="flex-1 truncate">{it.label}</span>
                            {it.badge && (
                              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">
                                {it.badge}
                              </span>
                            )}
                          </Link>
                        )}
                        {showChildren && (
                          <div className="ml-4 pl-2 border-l border-white/10">
                            {it.children!.map((c) => {
                              const CI = c.icon;
                              const cActive = isActive(c.href);
                              return (
                                <Link
                                  key={c.href}
                                  href={c.href}
                                  className={cn(
                                    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg my-0.5 text-[13px] transition",
                                    cActive
                                      ? "bg-white/15 text-white shadow-inner"
                                      : "text-white/65 hover:text-white hover:bg-white/8",
                                  )}
                                >
                                  <CI size={12} className="shrink-0 opacity-75" />
                                  <span className="flex-1 truncate">{c.label}</span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
    </>
  );
}
