'use client';

import {
  ArrowDownToLine,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  Clock,
  Command,
  Coins,
  FileSpreadsheet,
  Handshake,
  Home,
  Inbox,
  Layers,
  LineChart,
  LogOut,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cerrarSesion } from '@/app/login/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type NavGroup = {
  label: string;
  items: { href: string; label: string; icon: typeof Home }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tablero',
    items: [{ href: '/', label: 'Inicio', icon: Home }],
  },
  {
    label: 'Operacion diaria',
    items: [
      { href: '/erogaciones', label: 'Erogaciones', icon: Inbox },
      { href: '/pagos-atrasados', label: 'Pagos atrasados', icon: Clock },
      {
        href: '/ingresos-puntuales',
        label: 'Ingresos puntuales',
        icon: ArrowDownToLine,
      },
      { href: '/recurrencias', label: 'Recurrencias', icon: CalendarClock },
      { href: '/acuerdos', label: 'Acuerdos', icon: Handshake },
      { href: '/calendario', label: 'Calendario de caja', icon: CalendarDays },
      { href: '/saldos', label: 'Saldos iniciales', icon: Coins },
    ],
  },
  {
    label: 'Motor y analisis',
    items: [
      { href: '/proyeccion', label: 'Proyeccion de saldo', icon: TrendingUp },
      { href: '/facturacion', label: 'Facturacion diaria', icon: LineChart },
      { href: '/promedios', label: 'Promedios', icon: LineChart },
      { href: '/analisis', label: 'Analisis de gastos', icon: BarChart3 },
      { href: '/precision', label: 'Precision del modelo', icon: Target },
      { href: '/sugerencias', label: 'Sugerencias', icon: Sparkles },
    ],
  },
  {
    label: 'Datos maestros',
    items: [
      { href: '/empresas', label: 'Empresas', icon: Building2 },
      { href: '/unidades-negocio', label: 'Unidades de negocio', icon: Layers },
      { href: '/bancos', label: 'Bancos', icon: Wallet },
      { href: '/proveedores', label: 'Proveedores', icon: Users },
      { href: '/importar', label: 'Importar Excel', icon: FileSpreadsheet },
    ],
  },
];

type Perfil = {
  nombre: string;
  email: string;
  rol: string;
};

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).slice(0, 2);
  return partes
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

export function AppSidebar({ perfil }: { perfil: Perfil }) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-sidebar text-sidebar-foreground flex flex-col shrink-0">
      <div className="p-5 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center shrink-0">
          <CircleDollarSign className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold leading-tight tracking-tight">
            Flujo de fondos
          </h1>
          <p className="text-xs text-muted-foreground truncate">Unistore</p>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
              {group.label}
            </p>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active =
                href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <Separator />

      <div className="px-3 py-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => {
            // Trigger Cmd+K via dispatching keyboard event.
            const e = new KeyboardEvent('keydown', {
              key: 'k',
              code: 'KeyK',
              ctrlKey: true,
              metaKey: navigator.platform.toLowerCase().includes('mac'),
              bubbles: true,
            });
            window.dispatchEvent(e);
          }}
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md hover:bg-sidebar-accent/40 transition-colors"
        >
          <Command className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Buscar / Comandos</span>
          <kbd className="h-4 select-none items-center rounded border bg-muted px-1 text-[10px]">
            Ctrl K
          </kbd>
        </button>
      </div>

      <Separator />

      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-sidebar-accent text-sidebar-accent-foreground flex items-center justify-center text-xs font-semibold shrink-0">
            {iniciales(perfil.nombre)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{perfil.nombre}</p>
            <p className="text-xs text-muted-foreground truncate">{perfil.email}</p>
            <Badge
              variant={perfil.rol === 'admin' ? 'default' : 'secondary'}
              className="text-[10px] mt-1.5 h-4 px-1.5"
            >
              {perfil.rol}
            </Badge>
          </div>
          <ThemeToggle />
        </div>

        <form action={cerrarSesion}>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            <LogOut className="h-4 w-4 mr-2" />
            Cerrar sesion
          </Button>
        </form>
      </div>
    </aside>
  );
}
