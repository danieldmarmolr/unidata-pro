'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  ArrowDownUp,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Filter,
  KeyboardIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import {
  bulkBorrar,
  bulkCambiarEstado,
  bulkCambiarFecha,
  bulkOcultar,
  borrarErogacion,
  cambiarEstadoErogacion,
  cambiarOculto,
  crearErogacion,
  editarErogacion,
  type DuplicadoCandidato,
} from './actions';
import {
  ESTADO_EROGACION,
  ESTADO_LABELS,
  erogacionFormSchema,
  type ErogacionInput,
  type EstadoErogacion,
} from './schema';
import {
  ESTADO_PILL_CLASS,
  fmtFechaAR,
  fmtFechaRelativa,
  fmtMonto,
  hoyISO,
} from './utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  BancoMedioPago,
  Empresa,
  Proveedor,
} from '@/db/schema';
import { cn } from '@/lib/utils';

type ErogacionRow = {
  id: number;
  fechaPago: string;
  fechaSugeridaTentativa: string | null;
  descripcion: string;
  monto: string;
  moneda: string;
  empresaId: number;
  empresaNombre: string | null;
  bancoId: number;
  bancoNombre: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
  estado: EstadoErogacion;
  categoria: string | null;
  esCritico: boolean;
  notas: string | null;
  pagadoAt: Date | null;
  oculto: boolean;
};

type Filters = {
  estado?: EstadoErogacion;
  empresa?: number;
  banco?: number;
  proveedor?: number;
  desde?: string;
  hasta?: string;
  q?: string;
  oculto?: '1' | '0';
  sort: 'fecha_asc' | 'fecha_desc' | 'monto_asc' | 'monto_desc';
};

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Si contiene coma, comillas o salto de linea, lo escapamos.
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportarCSV(rows: ErogacionRow[]) {
  const headers = [
    'Fecha pago',
    'Descripcion',
    'Monto',
    'Moneda',
    'Empresa',
    'Banco',
    'Proveedor',
    'Estado',
    'Categoria',
    'Critico',
    'Notas',
    'Pagado el',
  ];
  const lines = [headers.map(escapeCSV).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.fechaPago,
        r.descripcion,
        r.monto,
        r.moneda,
        r.empresaNombre ?? '',
        r.bancoNombre ?? '',
        r.proveedorNombre ?? '',
        r.estado,
        r.categoria ?? '',
        r.esCritico ? 'si' : 'no',
        r.notas ?? '',
        r.pagadoAt ? new Date(r.pagadoAt).toISOString().slice(0, 10) : '',
      ]
        .map(escapeCSV)
        .join(','),
    );
  }
  // BOM para que Excel detecte UTF-8 correctamente
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `erogaciones-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Props = {
  erogaciones: ErogacionRow[];
  empresas: Empresa[];
  bancos: BancoMedioPago[];
  proveedores: Proveedor[];
  filters: Filters;
};

// ===== Status pill compartido =====
function EstadoPill({ estado }: { estado: EstadoErogacion }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        ESTADO_PILL_CLASS[estado],
      )}
    >
      {ESTADO_LABELS[estado]}
    </span>
  );
}

// ===== Empty state =====
function EmptyState({
  onNuevo,
  setupListo,
}: {
  onNuevo: () => void;
  setupListo: boolean;
}) {
  if (!setupListo) {
    return (
      <div className="rounded-lg border bg-card p-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-6 w-6 text-warning" />
        </div>
        <h3 className="font-medium text-foreground">Falta terminar el setup</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Antes de cargar erogaciones, necesitas crear al menos una empresa y un
          banco/medio de pago.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <a
            href="/empresas"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
            )}
          >
            Ir a Empresas
          </a>
          <a
            href="/bancos"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
            )}
          >
            Ir a Bancos
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Plus className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-foreground">Sin erogaciones cargadas</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        Empeza cargando pagos manualmente o corre el importador del Excel
        legacy. Cuando tengas datos cargados, este Inbox va a ser tu pantalla
        mas usada.
      </p>
      <Button onClick={onNuevo} className="mt-4" size="sm">
        <Plus className="h-4 w-4 mr-2" />
        Cargar primera erogacion
      </Button>
    </div>
  );
}

export function ErogacionesClient({
  erogaciones,
  empresas,
  bancos,
  proveedores,
  filters,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // --- selection state ---
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkFechaOpen, setBulkFechaOpen] = useState(false);
  const [bulkFechaValor, setBulkFechaValor] = useState('');

  // --- dialog state ---
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ErogacionRow | null>(null);
  const [duplicados, setDuplicados] = useState<DuplicadoCandidato[] | null>(
    null,
  );
  const [pendingInput, setPendingInput] = useState<ErogacionInput | null>(null);

  // --- detail drawer ---
  const [detail, setDetail] = useState<ErogacionRow | null>(null);

  // --- search input local state (debounced to URL) ---
  const [searchValue, setSearchValue] = useState(filters.q ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  // --- paginacion client-side ---
  // Renderizar todas las filas de golpe satura el browser y dispara
  // "This page couldn't load" en Edge/Chrome cuando hay 200+ rows con
  // Tooltips y dropdowns por fila. 50 por pagina es seguro.
  const TAMANO_PAGINA = 50;
  const [pagina, setPagina] = useState(0);
  const totalPaginas = Math.max(1, Math.ceil(erogaciones.length / TAMANO_PAGINA));
  // Reset a pagina 0 cuando cambia el listado de erogaciones (por filtro)
  useEffect(() => {
    setPagina(0);
  }, [erogaciones.length, filters.estado, filters.empresa, filters.banco, filters.proveedor, filters.q]);
  const erogacionesPagina = useMemo(
    () => erogaciones.slice(pagina * TAMANO_PAGINA, (pagina + 1) * TAMANO_PAGINA),
    [erogaciones, pagina],
  );

  // Sync search to URL with debounce
  useEffect(() => {
    if (searchValue === (filters.q ?? '')) return;
    const t = setTimeout(() => {
      updateUrl({ q: searchValue || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  // ===== URL update helper =====
  function updateUrl(patch: Partial<Filters> & { q?: string }) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) {
        sp.delete(k);
      } else {
        sp.set(k, String(v));
      }
    }
    router.push(`/erogaciones?${sp.toString()}`);
  }

  // ===== Form (RHF + Zod) =====
  const form = useForm<ErogacionInput>({
    resolver: zodResolver(erogacionFormSchema),
    defaultValues: defaultFormValues(),
  });

  function defaultFormValues(): ErogacionInput {
    return {
      fechaPago: hoyISO(),
      descripcion: '',
      monto: '',
      moneda: 'ARS',
      empresaId: empresas[0]?.id ?? 0,
      bancoId: bancos[0]?.id ?? 0,
      proveedorId: undefined,
      estado: 'pendiente',
      categoria: '',
      esCritico: false,
      notas: '',
    };
  }

  function abrirNuevo() {
    setEditing(null);
    form.reset(defaultFormValues());
    setDuplicados(null);
    setDialogOpen(true);
  }

  function abrirEditar(row: ErogacionRow) {
    setEditing(row);
    form.reset({
      fechaPago: row.fechaPago,
      descripcion: row.descripcion,
      monto: row.monto,
      moneda: row.moneda,
      empresaId: row.empresaId,
      bancoId: row.bancoId,
      proveedorId: row.proveedorId ?? undefined,
      estado: row.estado,
      categoria: row.categoria ?? '',
      esCritico: row.esCritico,
      notas: row.notas ?? '',
    });
    setDuplicados(null);
    setDialogOpen(true);
  }

  function onSubmit(values: ErogacionInput) {
    setPendingInput(values);
    startTransition(async () => {
      const res = editing
        ? await editarErogacion(editing.id, values)
        : await crearErogacion(values);

      if (res.ok) {
        toast.success(editing ? 'Erogacion actualizada' : 'Erogacion creada');
        setDialogOpen(false);
        setDuplicados(null);
      } else if ('duplicados' in res && res.duplicados.length > 0) {
        setDuplicados(res.duplicados);
        toast.warning(
          `Posible duplicado: ${res.duplicados.length} erogacion(es) similar(es)`,
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  function confirmarYGuardar() {
    if (!pendingInput) return;
    startTransition(async () => {
      const res = await crearErogacion(pendingInput, {
        confirmarDuplicados: true,
      });
      if (res.ok) {
        toast.success('Erogacion creada');
        setDialogOpen(false);
        setDuplicados(null);
      } else if (!('duplicados' in res)) {
        toast.error(res.error);
      }
    });
  }

  function cambiarEstadoRapido(row: ErogacionRow, nuevo: EstadoErogacion) {
    startTransition(async () => {
      const res = await cambiarEstadoErogacion(row.id, nuevo);
      if (res.ok) toast.success(`Marcada como ${ESTADO_LABELS[nuevo]}`);
      else toast.error(res.error);
    });
  }

  function borrar(row: ErogacionRow) {
    if (
      !confirm(
        `Borrar "${row.descripcion}" (${fmtMonto(row.monto)})? No se puede deshacer.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await borrarErogacion(row.id);
      if (res.ok) {
        toast.success('Erogacion borrada');
        if (detail?.id === row.id) setDetail(null);
      } else toast.error(res.error);
    });
  }

  // ===== Bulk actions =====
  function toggleSelectAll() {
    if (selectedIds.size === erogaciones.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(erogaciones.map((r) => r.id)));
  }
  function toggleRow(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }
  function bulkMarcar(estado: EstadoErogacion) {
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const res = await bulkCambiarEstado(ids, estado);
      if (res.ok) {
        toast.success(`${ids.length} marcadas como ${ESTADO_LABELS[estado]}`);
        setSelectedIds(new Set());
      } else toast.error(res.error);
    });
  }
  function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!confirm(`Borrar ${ids.length} erogaciones seleccionadas?`)) return;
    startTransition(async () => {
      const res = await bulkBorrar(ids);
      if (res.ok) {
        toast.success(`${ids.length} erogaciones borradas`);
        setSelectedIds(new Set());
      } else toast.error(res.error);
    });
  }
  function abrirBulkFecha() {
    setBulkFechaValor(hoyISO());
    setBulkFechaOpen(true);
  }
  function bulkToggleOcultar(ocultar: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await bulkOcultar(ids, ocultar);
      if (res.ok) {
        toast.success(
          ocultar
            ? `${ids.length} ${ids.length === 1 ? 'oculta' : 'ocultas'} de la proyeccion`
            : `${ids.length} ${ids.length === 1 ? 'visible' : 'visibles'} en la proyeccion`,
        );
        setSelectedIds(new Set());
      } else toast.error(res.error);
    });
  }
  function toggleOcultarFila(id: number, oculto: boolean) {
    startTransition(async () => {
      const res = await cambiarOculto(id, !oculto);
      if (res.ok) {
        toast.success(
          !oculto ? 'Oculta de la proyeccion' : 'Visible en la proyeccion',
        );
      } else toast.error(res.error);
    });
  }
  function aplicarBulkFecha() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bulkFechaValor)) {
      toast.error('Fecha invalida');
      return;
    }
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const res = await bulkCambiarFecha(ids, bulkFechaValor);
      if (res.ok) {
        toast.success(
          `${ids.length} erogacion${ids.length === 1 ? '' : 'es'} movida${ids.length === 1 ? '' : 's'} a ${fmtFechaAR(bulkFechaValor)}`,
        );
        setSelectedIds(new Set());
        setBulkFechaOpen(false);
      } else toast.error(res.error);
    });
  }

  // ===== Hotkeys =====
  useHotkeys(
    'n',
    (e) => {
      if (dialogOpen || detail || !setupListo) return;
      e.preventDefault();
      abrirNuevo();
    },
    { enableOnFormTags: false },
  );
  useHotkeys(
    '/',
    (e) => {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    { enableOnFormTags: false },
  );

  // ===== KPIs arriba =====
  const stats = useMemo(() => {
    let pendiente = 0;
    let enCurso = 0;
    let pagado = 0;
    let total = 0;
    // Las ocultas no cuentan en KPIs: la idea es que reflejen el escenario
    // de proyeccion actual, no lo "realmente cargado en el sistema".
    for (const r of erogaciones) {
      if (r.oculto) continue;
      const m = Number(r.monto);
      if (r.estado === 'pendiente') pendiente += m;
      else if (r.estado === 'en_curso') enCurso += m;
      else if (r.estado === 'pagado') pagado += m;
      total += 1;
    }
    return { pendiente, enCurso, pagado, total };
  }, [erogaciones]);

  const hayFiltrosActivos =
    filters.estado ||
    filters.empresa ||
    filters.banco ||
    filters.proveedor ||
    filters.desde ||
    filters.hasta ||
    filters.q;

  const setupListo = empresas.length > 0 && bancos.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-background px-8 py-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Operacion
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Inbox de erogaciones
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Todos los pagos programados, en curso y pagados.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                )}
              >
                <KeyboardIcon className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-1">
                  <p><kbd className="px-1 rounded bg-muted">N</kbd> nueva erogacion</p>
                  <p><kbd className="px-1 rounded bg-muted">/</kbd> buscar</p>
                  <p><kbd className="px-1 rounded bg-muted">Esc</kbd> cerrar</p>
                </div>
              </TooltipContent>
            </Tooltip>
            <Link
              href="/importar"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                !setupListo && 'pointer-events-none opacity-50',
              )}
              title={
                !setupListo
                  ? 'Primero carga al menos una empresa y un banco'
                  : 'Cargar erogaciones desde un archivo Excel'
              }
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Importar Excel
            </Link>
            <Button
              onClick={abrirNuevo}
              size="sm"
              disabled={!setupListo}
              title={
                !setupListo
                  ? 'Primero carga al menos una empresa y un banco'
                  : undefined
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Nueva erogacion
              <kbd className="ml-2 hidden sm:inline-flex h-4 select-none items-center rounded border bg-muted px-1 text-[10px] text-muted-foreground">
                N
              </kbd>
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <StatCard label="Total cargado" value={stats.total} muted />
          <StatCard
            label="Pendientes"
            value={fmtMonto(stats.pendiente)}
            tone="warning"
          />
          <StatCard
            label="En curso"
            value={fmtMonto(stats.enCurso)}
            tone="info"
          />
          <StatCard
            label="Pagado"
            value={fmtMonto(stats.pagado)}
            tone="success"
          />
        </div>

        {/* Vistas predefinidas */}
        <VistasPredefinidas filters={filters} updateUrl={updateUrl} />
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-8 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Buscar por descripcion..."
              className="pl-8 pr-8"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar busqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <FilterDropdown
            label="Estado"
            value={filters.estado}
            options={ESTADO_EROGACION.map((e) => ({
              value: e,
              label: ESTADO_LABELS[e],
            }))}
            onChange={(v) =>
              updateUrl({ estado: (v as EstadoErogacion) || undefined })
            }
          />

          <FilterDropdown
            label="Empresa"
            value={filters.empresa?.toString()}
            options={empresas.map((e) => ({
              value: e.id.toString(),
              label: e.nombre,
            }))}
            onChange={(v) =>
              updateUrl({ empresa: v ? Number(v) : undefined })
            }
          />

          <FilterDropdown
            label="Banco"
            value={filters.banco?.toString()}
            options={bancos.map((b) => ({
              value: b.id.toString(),
              label: b.nombre,
            }))}
            onChange={(v) => updateUrl({ banco: v ? Number(v) : undefined })}
          />

          {proveedores.length > 0 && (
            <FilterDropdown
              label="Proveedor"
              value={filters.proveedor?.toString()}
              options={proveedores.map((p) => ({
                value: p.id.toString(),
                label: p.nombre,
              }))}
              onChange={(v) =>
                updateUrl({ proveedor: v ? Number(v) : undefined })
              }
            />
          )}

          <div className="relative inline-flex">
            <select
              value={filters.sort ?? 'fecha_asc'}
              onChange={(e) =>
                updateUrl({
                  sort: e.target.value as
                    | 'fecha_asc'
                    | 'fecha_desc'
                    | 'monto_asc'
                    | 'monto_desc',
                })
              }
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'appearance-none pl-8 pr-8 cursor-pointer',
              )}
              aria-label="Ordenar"
            >
              <option value="fecha_asc">Fecha (asc)</option>
              <option value="fecha_desc">Fecha (desc)</option>
              <option value="monto_asc">Monto (asc)</option>
              <option value="monto_desc">Monto (desc)</option>
            </select>
            <ArrowDownUp className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
            <ChevronDown className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarCSV(erogaciones)}
            disabled={erogaciones.length === 0}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Exportar
          </Button>

          {hayFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchValue('');
                router.push('/erogaciones');
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {erogaciones.length === 0 ? (
          hayFiltrosActivos ? (
            <div className="rounded-lg border bg-card p-12 text-center">
              <Filter className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-foreground font-medium">
                Sin resultados
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Probá ajustar o limpiar los filtros.
              </p>
            </div>
          ) : (
            <EmptyState onNuevo={abrirNuevo} setupListo={setupListo} />
          )
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={
                        selectedIds.size > 0 &&
                        selectedIds.size === erogaciones.length
                      }
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            selectedIds.size > 0 &&
                            selectedIds.size < erogaciones.length;
                      }}
                      onChange={toggleSelectAll}
                      aria-label="Seleccionar todas"
                    />
                  </TableHead>
                  <TableHead className="w-32">Fecha</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead className="text-right w-32">Monto</TableHead>
                  <TableHead className="w-28">Estado</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {erogacionesPagina.map((row) => {
                  const selected = selectedIds.has(row.id);
                  const atrasado =
                    row.estado === 'pendiente' && row.fechaPago < hoyISO();
                  return (
                    <TableRow
                      key={row.id}
                      data-state={selected ? 'selected' : undefined}
                      className={cn(
                        'cursor-pointer',
                        atrasado && 'bg-warning/5',
                        row.oculto && 'opacity-50 line-through',
                      )}
                      onClick={(e) => {
                        // ignore clicks on input or buttons
                        const target = e.target as HTMLElement;
                        if (
                          target.closest('input') ||
                          target.closest('button')
                        )
                          return;
                        setDetail(row);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={selected}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`Seleccionar ${row.descripcion}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm tabular-nums">
                          {fmtFechaAR(row.fechaPago)}
                        </div>
                        <div
                          className={cn(
                            'text-xs',
                            atrasado
                              ? 'text-warning font-medium'
                              : 'text-muted-foreground',
                          )}
                        >
                          {atrasado ? 'ATRASADO • ' : ''}
                          {fmtFechaRelativa(row.fechaPago)}
                        </div>
                        {row.fechaSugeridaTentativa && (
                          <div className="text-[10px] mt-1 text-info font-medium">
                            Tentativa → {fmtFechaAR(row.fechaSugeridaTentativa)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.esCritico && (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                              </TooltipTrigger>
                              <TooltipContent>Critico</TooltipContent>
                            </Tooltip>
                          )}
                          <span className="font-medium line-clamp-1">
                            {row.descripcion}
                          </span>
                        </div>
                        {row.proveedorNombre && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {row.proveedorNombre}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.empresaNombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.bancoNombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmtMonto(row.monto)}
                      </TableCell>
                      <TableCell>
                        <EstadoPill estado={row.estado} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <Tooltip>
                            <TooltipTrigger
                              onClick={() => abrirEditar(row)}
                              className={cn(
                                buttonVariants({ variant: 'ghost', size: 'icon' }),
                                'h-8 w-8',
                              )}
                              aria-label="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </TooltipTrigger>
                            <TooltipContent>Editar</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              onClick={() =>
                                toggleOcultarFila(row.id, row.oculto)
                              }
                              className={cn(
                                buttonVariants({ variant: 'ghost', size: 'icon' }),
                                'h-8 w-8',
                                row.oculto && 'text-info',
                              )}
                              aria-label={
                                row.oculto
                                  ? 'Mostrar en proyeccion'
                                  : 'Ocultar de proyeccion'
                              }
                            >
                              {row.oculto ? (
                                <Eye className="h-3.5 w-3.5" />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {row.oculto
                                ? 'Mostrar en proyeccion'
                                : 'Ocultar de proyeccion'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              onClick={() => borrar(row)}
                              className={cn(
                                buttonVariants({ variant: 'ghost', size: 'icon' }),
                                'h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10',
                              )}
                              aria-label="Borrar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </TooltipTrigger>
                            <TooltipContent>Borrar</TooltipContent>
                          </Tooltip>
                          <div className="relative inline-flex">
                            <select
                              value=""
                              onChange={(e) => {
                                const nuevo = e.target.value as EstadoErogacion;
                                if (nuevo) cambiarEstadoRapido(row, nuevo);
                                e.target.value = '';
                              }}
                              className={cn(
                                buttonVariants({ variant: 'ghost', size: 'icon' }),
                                'h-8 w-8 appearance-none cursor-pointer p-0 text-transparent',
                              )}
                              aria-label="Cambiar estado"
                              title="Cambiar estado"
                            >
                              <option value="" disabled>
                                Cambiar estado
                              </option>
                              {ESTADO_EROGACION.filter(
                                (e) => e !== row.estado,
                              ).map((e) => (
                                <option key={e} value={e}>
                                  {ESTADO_LABELS[e]}
                                </option>
                              ))}
                            </select>
                            <MoreHorizontal className="h-4 w-4 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-foreground" />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20 text-sm">
                <p className="text-muted-foreground">
                  Mostrando{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {pagina * TAMANO_PAGINA + 1}–
                    {Math.min((pagina + 1) * TAMANO_PAGINA, erogaciones.length)}
                  </span>{' '}
                  de{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {erogaciones.length}
                  </span>
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagina(0)}
                    disabled={pagina === 0}
                  >
                    « Primera
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagina((p) => Math.max(0, p - 1))}
                    disabled={pagina === 0}
                  >
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground px-2 tabular-nums">
                    Pagina {pagina + 1} / {totalPaginas}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPagina((p) => Math.min(totalPaginas - 1, p + 1))
                    }
                    disabled={pagina >= totalPaginas - 1}
                  >
                    Siguiente
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagina(totalPaginas - 1)}
                    disabled={pagina >= totalPaginas - 1}
                  >
                    Ultima »
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk floating bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-lg border bg-background shadow-lg px-3 py-2">
          <span className="text-sm font-medium px-2">
            {selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'}
          </span>
          <Separator orientation="vertical" className="h-6" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkMarcar('pagado')}
            disabled={pending}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Marcar pagado
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkMarcar('en_curso')}
            disabled={pending}
          >
            <Clock className="h-3.5 w-3.5 mr-1" />
            En curso
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={abrirBulkFecha}
            disabled={pending}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-1" />
            Cambiar fecha
          </Button>
          {(() => {
            // Si TODAS las seleccionadas estan ocultas, el boton ofrece
            // "Mostrar". Si hay al menos una visible, ofrece "Ocultar".
            const seleccionadas = erogaciones.filter((e) =>
              selectedIds.has(e.id),
            );
            const todasOcultas =
              seleccionadas.length > 0 &&
              seleccionadas.every((e) => e.oculto);
            return (
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkToggleOcultar(!todasOcultas)}
                disabled={pending}
              >
                {todasOcultas ? (
                  <>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Mostrar en proyeccion
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5 mr-1" />
                    Ocultar de proyeccion
                  </>
                )}
              </Button>
            );
          })()}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Mas
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => bulkMarcar('cancelado')}>
                Marcar canceladas
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => bulkMarcar('pendiente')}>
                Marcar pendientes
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={bulkDelete}
                className="text-destructive focus:text-destructive"
              >
                Borrar seleccionadas
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ===== Dialog cambiar fecha masivo ===== */}
      <Dialog open={bulkFechaOpen} onOpenChange={setBulkFechaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mover {selectedIds.size} erogacion{selectedIds.size === 1 ? '' : 'es'} a otra fecha</DialogTitle>
            <DialogDescription>
              Cambia la fecha de pago de todas las seleccionadas. Si alguna
              tenia una fecha tentativa puesta, se descarta (la edicion manual
              toma prioridad).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="bulk-fecha" className="text-sm font-medium">
              Nueva fecha de pago
            </label>
            <Input
              id="bulk-fecha"
              type="date"
              value={bulkFechaValor}
              onChange={(e) => setBulkFechaValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  aplicarBulkFecha();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkFechaOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={aplicarBulkFecha} disabled={pending || !bulkFechaValor}>
              <CalendarIcon className="h-4 w-4 mr-1.5" />
              Aplicar a {selectedIds.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog crear/editar ===== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Editar erogacion' : 'Nueva erogacion'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Modifica los datos de la erogacion.'
                : 'Carga un nuevo pago. Los campos marcados son obligatorios.'}
            </DialogDescription>
          </DialogHeader>

          {duplicados && duplicados.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 text-warning font-medium">
                <AlertTriangle className="h-4 w-4" />
                Posible duplicado
              </div>
              <p className="text-foreground text-xs">
                Encontramos erogaciones con monto similar (±5%) en fechas
                cercanas para la misma empresa
                {pendingInput?.proveedorId ? ' y proveedor' : ''}:
              </p>
              <ul className="text-xs space-y-1">
                {duplicados.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1"
                  >
                    <span className="truncate">
                      {fmtFechaAR(d.fechaPago)} — {d.descripcion}
                    </span>
                    <span className="tabular-nums font-medium">
                      {fmtMonto(d.monto)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDuplicados(null);
                  }}
                >
                  Volver al formulario
                </Button>
                <Button
                  size="sm"
                  onClick={confirmarYGuardar}
                  disabled={pending}
                >
                  Cargar de todas formas
                </Button>
              </div>
            </div>
          )}

          {!duplicados && (
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              autoComplete="off"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="monto">Monto</Label>
                  <Input
                    id="monto"
                    placeholder="0.00"
                    autoFocus
                    {...form.register('monto')}
                  />
                  {form.formState.errors.monto && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.monto.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fechaPago">Fecha de pago</Label>
                  <Input
                    id="fechaPago"
                    type="date"
                    {...form.register('fechaPago')}
                  />
                  {form.formState.errors.fechaPago && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.fechaPago.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="descripcion">Descripcion</Label>
                <Input
                  id="descripcion"
                  placeholder="Ej: Pago COTELCAM"
                  {...form.register('descripcion')}
                />
                {form.formState.errors.descripcion && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.descripcion.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Empresa</Label>
                  <Controller
                    control={form.control}
                    name="empresaId"
                    render={({ field }) => (
                      <Select
                        value={field.value?.toString() ?? ''}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Elegir..." />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((e) => (
                            <SelectItem key={e.id} value={e.id.toString()}>
                              {e.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Banco</Label>
                  <Controller
                    control={form.control}
                    name="bancoId"
                    render={({ field }) => (
                      <Select
                        value={field.value?.toString() ?? ''}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Elegir..." />
                        </SelectTrigger>
                        <SelectContent>
                          {bancos.map((b) => (
                            <SelectItem key={b.id} value={b.id.toString()}>
                              {b.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Controller
                    control={form.control}
                    name="estado"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTADO_EROGACION.map((e) => (
                            <SelectItem key={e} value={e}>
                              {ESTADO_LABELS[e]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Proveedor (opcional)</Label>
                  <Controller
                    control={form.control}
                    name="proveedorId"
                    render={({ field }) => (
                      <Select
                        value={field.value?.toString() ?? 'none'}
                        onValueChange={(v) =>
                          field.onChange(v === 'none' ? undefined : Number(v))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Sin proveedor —</SelectItem>
                          {proveedores.map((p) => (
                            <SelectItem key={p.id} value={p.id.toString()}>
                              {p.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <details className="rounded-md border bg-muted/30 p-3 [&_summary]:cursor-pointer">
                <summary className="text-sm font-medium text-muted-foreground">
                  Mas detalles
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="categoria">Categoria</Label>
                    <Input
                      id="categoria"
                      placeholder="prestamo, sueldos, proveedores..."
                      {...form.register('categoria')}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="esCritico"
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      {...form.register('esCritico')}
                    />
                    <Label htmlFor="esCritico" className="cursor-pointer">
                      Critico (si no se paga se rompe algo)
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notas">Notas</Label>
                    <Textarea id="notas" rows={3} {...form.register('notas')} />
                  </div>
                </div>
              </details>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Drawer de detalle ===== */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
          {detail && (
            <>
              <SheetHeader className="p-6 pb-4 border-b">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <SheetTitle className="text-lg leading-tight truncate">
                      {detail.descripcion}
                    </SheetTitle>
                    <SheetDescription className="mt-1">
                      {fmtFechaAR(detail.fechaPago)} —{' '}
                      {fmtFechaRelativa(detail.fechaPago)}
                    </SheetDescription>
                  </div>
                  <EstadoPill estado={detail.estado} />
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight">
                    {fmtMonto(detail.monto)}
                  </p>
                  {detail.moneda !== 'ARS' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Moneda: {detail.moneda}
                    </p>
                  )}
                </div>

                <Separator />

                <DetailRow label="Empresa" value={detail.empresaNombre} />
                <DetailRow label="Banco" value={detail.bancoNombre} />
                <DetailRow
                  label="Proveedor"
                  value={
                    detail.proveedorId && detail.proveedorNombre ? (
                      <Link
                        href={`/proveedores/${detail.proveedorId}`}
                        className="text-primary hover:underline"
                      >
                        {detail.proveedorNombre}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  label="Categoria"
                  value={detail.categoria ?? '—'}
                />
                <DetailRow
                  label="Critico"
                  value={
                    detail.esCritico ? (
                      <Badge variant="destructive" className="text-[10px]">
                        Si
                      </Badge>
                    ) : (
                      'No'
                    )
                  }
                />
                {detail.pagadoAt && (
                  <DetailRow
                    label="Pagado el"
                    value={new Date(detail.pagadoAt).toLocaleString('es-AR')}
                  />
                )}
                {detail.notas && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Notas
                    </p>
                    <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3">
                      {detail.notas}
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t p-4 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => {
                    abrirEditar(detail);
                    setDetail(null);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editar
                </Button>
                {detail.estado !== 'pagado' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      cambiarEstadoRapido(detail, 'pagado');
                      setDetail(null);
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Marcar pagado
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive ml-auto"
                  onClick={() => borrar(detail)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Borrar
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ===== Sub-components =====

function StatCard({
  label,
  value,
  tone = 'default',
  muted = false,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'info';
  muted?: boolean;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    info: 'text-info',
  }[tone];
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums mt-0.5',
          muted ? 'text-foreground' : toneClass,
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (v: string | undefined) => void;
}) {
  // Select nativo: simple, accesible y sin riesgo de crashear el browser
  // (los dropdowns custom rompian con muchas instancias en la pagina).
  return (
    <div className="relative inline-flex">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={cn(
          buttonVariants({
            variant: value ? 'default' : 'outline',
            size: 'sm',
          }),
          'appearance-none pr-8 cursor-pointer',
        )}
        aria-label={label}
      >
        <option value="">{label}: todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
    </div>
  );
}

type VistaPredefinida = {
  key: string;
  label: string;
  patch: Partial<Filters>;
  /** Devuelve true si los filtros actuales coinciden con esta vista. */
  matches: (f: Filters) => boolean;
};

function buildVistas(): VistaPredefinida[] {
  // Usamos siempre local time. toISOString() es UTC y, en horarios de tarde
  // / noche en Argentina (UTC-3), puede devolver el dia siguiente y romper
  // los filtros relativos a "hoy" / "ayer".
  function localISO(offsetDias: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const hoy = hoyISO();
  const en7 = localISO(7);
  const en30 = localISO(30);
  const ayer = localISO(-1);
  return [
    {
      key: 'todas',
      label: 'Todas',
      patch: {
        estado: undefined,
        empresa: undefined,
        banco: undefined,
        proveedor: undefined,
        desde: undefined,
        hasta: undefined,
        q: undefined,
        oculto: undefined,
      },
      matches: (f) =>
        !f.estado && !f.empresa && !f.banco && !f.proveedor && !f.desde && !f.hasta && !f.q && !f.oculto,
    },
    {
      key: 'atrasadas',
      label: 'Atrasadas',
      patch: {
        estado: 'pendiente',
        desde: undefined,
        hasta: ayer,
        oculto: undefined,
      },
      matches: (f) =>
        f.estado === 'pendiente' && !f.desde && !!f.hasta && f.hasta < hoy && !f.oculto,
    },
    {
      key: 'hoy',
      label: 'Para hoy',
      patch: { desde: hoy, hasta: hoy, estado: undefined, oculto: undefined },
      matches: (f) => f.desde === hoy && f.hasta === hoy && !f.oculto,
    },
    {
      key: 'semana',
      label: 'Proximos 7 dias',
      patch: {
        desde: hoy,
        hasta: en7,
        estado: 'pendiente',
        oculto: undefined,
      },
      matches: (f) =>
        f.desde === hoy && f.hasta === en7 && f.estado === 'pendiente' && !f.oculto,
    },
    {
      key: 'mes',
      label: 'Proximos 30 dias',
      patch: { desde: hoy, hasta: en30, estado: undefined, oculto: undefined },
      matches: (f) => f.desde === hoy && f.hasta === en30 && !f.oculto,
    },
    {
      key: 'ocultas',
      label: 'Ocultas',
      patch: {
        oculto: '1',
        estado: undefined,
        empresa: undefined,
        banco: undefined,
        proveedor: undefined,
        desde: undefined,
        hasta: undefined,
        q: undefined,
      },
      matches: (f) => f.oculto === '1',
    },
  ];
}

function VistasPredefinidas({
  filters,
  updateUrl,
}: {
  filters: Filters;
  updateUrl: (patch: Partial<Filters> & { q?: string }) => void;
}) {
  const vistas = buildVistas();
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4">
      <span className="text-xs text-muted-foreground mr-1">Vistas:</span>
      {vistas.map((v) => {
        const activa = v.matches(filters);
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => updateUrl(v.patch)}
            className={cn(
              'px-2.5 py-1 rounded-full border text-xs transition-colors',
              activa
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-input hover:bg-muted',
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
