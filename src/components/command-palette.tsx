'use client';

import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  Coins,
  FileText,
  Handshake,
  Home,
  Layers,
  LineChart,
  LogOut,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { cerrarSesion } from '@/app/login/actions';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { buscarGlobal } from '@/lib/busqueda-global';

type ResultadosGlobales = Awaited<ReturnType<typeof buscarGlobal>>;

const VACIO: ResultadosGlobales = {
  erogaciones: [],
  proveedores: [],
  acuerdos: [],
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultadosGlobales>(VACIO);
  const [, startTransition] = useTransition();

  // Atajo global Cmd+K / Ctrl+K
  useHotkeys(
    'mod+k',
    (e) => {
      e.preventDefault();
      setOpen((v) => !v);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // Modo presentacion: Cmd+Shift+P / Ctrl+Shift+P
  useHotkeys(
    'mod+shift+p',
    (e) => {
      e.preventDefault();
      setOpen(false);
      router.push('/presentacion');
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults(VACIO);
      return;
    }
    const t = setTimeout(() => {
      startTransition(async () => {
        const r = await buscarGlobal(query);
        setResults(r);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function navigate(to: string) {
    setOpen(false);
    router.push(to);
  }

  const totalResultados =
    results.erogaciones.length + results.proveedores.length + results.acuerdos.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Buscar y navegar"
      description="Buscar erogaciones, proveedores, acuerdos o navegar"
    >
      <CommandInput
        placeholder="Buscar (erogaciones, proveedores, acuerdos) o ir a una pantalla..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        {totalResultados > 0 && (
          <>
            {results.proveedores.length > 0 && (
              <CommandGroup heading="Proveedores">
                {results.proveedores.map((r) => (
                  <CommandItem
                    key={`prov-${r.id}`}
                    onSelect={() => navigate(r.href)}
                    value={`prov-${r.id}-${r.titulo}`}
                  >
                    <User className="mr-2 h-4 w-4" />
                    <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                      <span className="truncate">{r.titulo}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {r.detalle}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.erogaciones.length > 0 && (
              <CommandGroup heading="Erogaciones">
                {results.erogaciones.map((r) => (
                  <CommandItem
                    key={`erog-${r.id}`}
                    onSelect={() => navigate(r.href)}
                    value={`erog-${r.id}-${r.titulo}`}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                      <span className="truncate">{r.titulo}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {r.detalle}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.acuerdos.length > 0 && (
              <CommandGroup heading="Acuerdos">
                {results.acuerdos.map((r) => (
                  <CommandItem
                    key={`acu-${r.id}`}
                    onSelect={() => navigate(r.href)}
                    value={`acu-${r.id}-${r.titulo}`}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                      <span className="truncate">{r.titulo}</span>
                      <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[200px]">
                        {r.detalle}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Acciones">
          <CommandItem onSelect={() => navigate('/erogaciones?nueva=1')}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva erogacion
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate('/presentacion')}>
            <Maximize2 className="mr-2 h-4 w-4" />
            Modo presentacion
            <CommandShortcut>⌘⇧P</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navegacion">
          <CommandItem onSelect={() => navigate('/')}>
            <Home className="mr-2 h-4 w-4" />
            Inicio
          </CommandItem>
          <CommandItem onSelect={() => navigate('/erogaciones')}>
            <CircleDollarSign className="mr-2 h-4 w-4" />
            Erogaciones
          </CommandItem>
          <CommandItem onSelect={() => navigate('/recurrencias')}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Recurrencias
          </CommandItem>
          <CommandItem onSelect={() => navigate('/calendario')}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Calendario de caja
          </CommandItem>
          <CommandItem onSelect={() => navigate('/proyeccion')}>
            <TrendingUp className="mr-2 h-4 w-4" />
            Proyeccion de saldo
          </CommandItem>
          <CommandItem onSelect={() => navigate('/saldos')}>
            <Coins className="mr-2 h-4 w-4" />
            Saldos iniciales
          </CommandItem>
          <CommandItem onSelect={() => navigate('/acuerdos')}>
            <Handshake className="mr-2 h-4 w-4" />
            Acuerdos con proveedores
          </CommandItem>
          <CommandItem onSelect={() => navigate('/promedios')}>
            <LineChart className="mr-2 h-4 w-4" />
            Promedios por dia de semana
          </CommandItem>
          <CommandItem onSelect={() => navigate('/precision')}>
            <Target className="mr-2 h-4 w-4" />
            Precision del modelo
          </CommandItem>
          <CommandItem onSelect={() => navigate('/sugerencias')}>
            <Sparkles className="mr-2 h-4 w-4" />
            Sugerencias
          </CommandItem>
          <CommandItem onSelect={() => navigate('/analisis')}>
            <BarChart3 className="mr-2 h-4 w-4" />
            Analisis de gastos
          </CommandItem>
          <CommandItem onSelect={() => navigate('/empresas')}>
            <Building2 className="mr-2 h-4 w-4" />
            Empresas
          </CommandItem>
          <CommandItem onSelect={() => navigate('/unidades-negocio')}>
            <Layers className="mr-2 h-4 w-4" />
            Unidades de negocio
          </CommandItem>
          <CommandItem onSelect={() => navigate('/bancos')}>
            <Wallet className="mr-2 h-4 w-4" />
            Bancos
          </CommandItem>
          <CommandItem onSelect={() => navigate('/proveedores')}>
            <Users className="mr-2 h-4 w-4" />
            Proveedores
          </CommandItem>
          <CommandItem onSelect={() => navigate('/importar')}>
            <FileText className="mr-2 h-4 w-4" />
            Importar Excel
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sesion">
          <CommandItem
            onSelect={() => {
              setOpen(false);
              cerrarSesion();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesion
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
