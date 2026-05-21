'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  Handshake,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  borrarAcuerdo,
  cambiarEstadoAcuerdo,
  crearAcuerdo,
  editarAcuerdo,
} from './actions';
import {
  ESTADO_ACUERDO,
  ESTADO_ACUERDO_LABELS,
  TIPO_ACUERDO,
  TIPO_ACUERDO_DESC,
  TIPO_ACUERDO_LABELS,
  acuerdoFormSchema,
  type AcuerdoInput,
  type AcuerdosFilters,
  type EstadoAcuerdo,
  type TipoAcuerdo,
} from './schema';
import { ESTADO_ACUERDO_PILL, TIPO_ACUERDO_PILL, diasHasta } from './utils';

type Proveedor = { id: number; nombre: string };

type AcuerdoFila = {
  id: number;
  proveedorId: number;
  proveedorNombre: string;
  tipo: TipoAcuerdo;
  compromiso: string;
  fechaCompromiso: string | null;
  montoCompromiso: string | null;
  estado: EstadoAcuerdo;
  contexto: string | null;
  erogacionId: number | null;
  erogacionDescripcion: string | null;
  createdAt: Date;
  fechaResolucion: Date | null;
};

type Props = {
  filas: AcuerdoFila[];
  proveedores: Proveedor[];
  filtros: AcuerdosFilters;
  porEstado: { pendiente: number; cumplido: number; incumplido: number };
};

export function AcuerdosClient({ filas, proveedores, filtros, porEstado }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<AcuerdoFila | null>(null);
  const [searchInput, setSearchInput] = useState(filtros.q ?? '');
  const [pending, startTransition] = useTransition();

  const defaultValues: AcuerdoInput = {
    proveedorId: 0,
    tipo: 'diferimiento',
    compromiso: '',
    fechaCompromiso: '',
    montoCompromiso: '',
    estado: 'pendiente',
    contexto: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AcuerdoInput>({
    resolver: zodResolver(acuerdoFormSchema),
    defaultValues,
  });

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    });
    startNav(() => {
      router.replace(`/acuerdos?${params.toString()}`);
    });
  }

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== (filtros.q ?? '')) {
        setQuery({ q: searchInput.trim() === '' ? null : searchInput.trim() });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function abrirNuevo() {
    setEditando(null);
    reset(defaultValues);
    setOpen(true);
  }

  function abrirEditar(a: AcuerdoFila) {
    setEditando(a);
    reset({
      proveedorId: a.proveedorId,
      tipo: a.tipo,
      compromiso: a.compromiso,
      fechaCompromiso: a.fechaCompromiso ?? '',
      montoCompromiso: a.montoCompromiso ?? '',
      estado: a.estado,
      contexto: a.contexto ?? '',
      erogacionId: a.erogacionId ?? undefined,
    });
    setOpen(true);
  }

  function onSubmit(values: AcuerdoInput) {
    startTransition(async () => {
      const result = editando
        ? await editarAcuerdo(editando.id, values)
        : await crearAcuerdo(values);
      if (result.ok) {
        toast.success(editando ? 'Acuerdo actualizado' : 'Acuerdo creado');
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function onBorrar(a: AcuerdoFila) {
    if (!confirm(`Borrar el acuerdo "${a.compromiso}"?`)) return;
    startTransition(async () => {
      const result = await borrarAcuerdo(a.id);
      if (result.ok) toast.success('Acuerdo borrado');
      else toast.error(result.error);
    });
  }

  function onCambiarEstado(a: AcuerdoFila, nuevo: EstadoAcuerdo) {
    startTransition(async () => {
      const result = await cambiarEstadoAcuerdo(a.id, nuevo);
      if (result.ok) toast.success(`Marcado como ${ESTADO_ACUERDO_LABELS[nuevo]}`);
      else toast.error(result.error);
    });
  }

  const hayFiltros =
    !!filtros.estado || !!filtros.tipo || !!filtros.proveedor || !!filtros.q;

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setQuery({ estado: filtros.estado === 'pendiente' ? null : 'pendiente' })}
          className={cn(
            'rounded-lg border p-4 text-left transition-colors hover:bg-muted/40',
            filtros.estado === 'pendiente' && 'border-warning/40 bg-warning/5',
          )}
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Handshake className="h-3 w-3 text-warning" /> Pendientes
          </p>
          <p className="text-2xl font-semibold tabular-nums mt-1 text-warning">
            {porEstado.pendiente}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setQuery({ estado: filtros.estado === 'cumplido' ? null : 'cumplido' })}
          className={cn(
            'rounded-lg border p-4 text-left transition-colors hover:bg-muted/40',
            filtros.estado === 'cumplido' && 'border-success/40 bg-success/5',
          )}
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success" /> Cumplidos
          </p>
          <p className="text-2xl font-semibold tabular-nums mt-1 text-success">
            {porEstado.cumplido}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setQuery({ estado: filtros.estado === 'incumplido' ? null : 'incumplido' })}
          className={cn(
            'rounded-lg border p-4 text-left transition-colors hover:bg-muted/40',
            filtros.estado === 'incumplido' && 'border-danger/40 bg-danger/5',
          )}
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <XCircle className="h-3 w-3 text-danger" /> Incumplidos
          </p>
          <p className="text-2xl font-semibold tabular-nums mt-1 text-danger">
            {porEstado.incumplido}
          </p>
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border bg-card">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar compromiso..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8 h-9 w-64"
          />
        </div>

        <Select
          value={filtros.tipo ?? 'todos'}
          onValueChange={(v) =>
            v && setQuery({ tipo: v === 'todos' ? null : v })
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {TIPO_ACUERDO.map((t) => (
              <SelectItem key={t} value={t}>
                {TIPO_ACUERDO_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filtros.proveedor ? String(filtros.proveedor) : 'todos'}
          onValueChange={(v) =>
            v && setQuery({ proveedor: v === 'todos' ? null : String(v) })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los proveedores</SelectItem>
            {proveedores.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hayFiltros && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              startNav(() => router.replace('/acuerdos'));
            }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Limpiar
          </button>
        )}

        <div className="ml-auto">
          <Button onClick={abrirNuevo} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Nuevo acuerdo
          </Button>
        </div>
      </div>

      {/* Empty states */}
      {proveedores.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Handshake className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-base font-medium">No hay proveedores cargados</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Antes de registrar acuerdos necesitas tener proveedores creados.
            </p>
            <Link
              href="/proveedores"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir a proveedores →
            </Link>
          </CardContent>
        </Card>
      ) : filas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Handshake className="h-10 w-10 mx-auto text-muted-foreground" />
            {hayFiltros ? (
              <>
                <p className="text-base font-medium">Sin resultados</p>
                <p className="text-sm text-muted-foreground">
                  Ningun acuerdo coincide con los filtros aplicados.
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-medium">Todavia no hay acuerdos</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Cuando le prometas algo a un proveedor (un diferimiento, un pago
                  parcial, un plan de cuotas), registralo acá para tener trazabilidad
                  de qué cumpliste y qué no.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Proveedor
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Tipo
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Compromiso
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Fecha
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Monto
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Estado
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((a) => {
                  const dias = diasHasta(a.fechaCompromiso);
                  const vencido =
                    a.estado === 'pendiente' && dias !== null && dias < 0;
                  const porVencer =
                    a.estado === 'pendiente' && dias !== null && dias >= 0 && dias <= 7;
                  return (
                    <tr
                      key={a.id}
                      className={cn(
                        'border-t hover:bg-muted/30',
                        vencido && 'bg-danger/5',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/acuerdos?proveedor=${a.proveedorId}`}
                          className="font-medium hover:underline"
                        >
                          {a.proveedorNombre}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', TIPO_ACUERDO_PILL[a.tipo])}
                        >
                          {TIPO_ACUERDO_LABELS[a.tipo]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <p className="line-clamp-2">{a.compromiso}</p>
                        {a.contexto && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {a.contexto}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {a.fechaCompromiso ? (
                          <div className="space-y-0.5">
                            <p className="text-sm tabular-nums">
                              {fmtFechaAR(a.fechaCompromiso)}
                            </p>
                            {vencido && (
                              <p className="text-[10px] font-medium text-danger uppercase">
                                Vencido hace {Math.abs(dias!)}d
                              </p>
                            )}
                            {porVencer && (
                              <p className="text-[10px] font-medium text-warning">
                                {dias === 0
                                  ? 'Vence hoy'
                                  : `En ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">
                            sin fecha
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.montoCompromiso ? (
                          fmtMonto(a.montoCompromiso)
                        ) : (
                          <span className="text-xs text-muted-foreground/60">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] hover:bg-muted',
                              ESTADO_ACUERDO_PILL[a.estado],
                            )}
                          >
                            {ESTADO_ACUERDO_LABELS[a.estado]}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {ESTADO_ACUERDO.filter((e) => e !== a.estado).map((e) => (
                              <DropdownMenuItem
                                key={e}
                                onClick={() => onCambiarEstado(a, e)}
                              >
                                Marcar como {ESTADO_ACUERDO_LABELS[e]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted"
                            aria-label="Acciones"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => abrirEditar(a)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onBorrar(a)}
                              className="text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Borrar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dialog form */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editando ? 'Editar acuerdo' : 'Nuevo acuerdo'}
            </DialogTitle>
            <DialogDescription>
              {editando
                ? 'Actualiza los datos o cambia el estado del acuerdo.'
                : 'Registra una promesa hecha a un proveedor para llevar trazabilidad.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proveedorId">Proveedor</Label>
              <Controller
                control={control}
                name="proveedorId"
                render={({ field }) => (
                  <Select
                    value={field.value ? String(field.value) : ''}
                    onValueChange={(v) => v && field.onChange(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Elegir proveedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {proveedores.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.proveedorId && (
                <p className="text-xs text-danger">{errors.proveedorId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo de acuerdo</Label>
              <Controller
                control={control}
                name="tipo"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => v && field.onChange(v as TipoAcuerdo)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_ACUERDO.map((t) => (
                        <SelectItem key={t} value={t}>
                          <div className="flex flex-col">
                            <span>{TIPO_ACUERDO_LABELS[t]}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {TIPO_ACUERDO_DESC[t]}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="compromiso">Compromiso</Label>
              <Textarea
                id="compromiso"
                {...register('compromiso')}
                placeholder="Le prometo pagar el dia 25 con un 5% de recargo..."
                rows={3}
              />
              {errors.compromiso && (
                <p className="text-xs text-danger">{errors.compromiso.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fechaCompromiso">Fecha (opcional)</Label>
                <Input
                  id="fechaCompromiso"
                  type="date"
                  {...register('fechaCompromiso')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="montoCompromiso">Monto (opcional)</Label>
                <Input
                  id="montoCompromiso"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...register('montoCompromiso')}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="estado">Estado</Label>
              <Controller
                control={control}
                name="estado"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => v && field.onChange(v as EstadoAcuerdo)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADO_ACUERDO.map((e) => (
                        <SelectItem key={e} value={e}>
                          {ESTADO_ACUERDO_LABELS[e]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contexto">Contexto / notas (opcional)</Label>
              <Textarea
                id="contexto"
                {...register('contexto')}
                placeholder="Por qué accediste a este acuerdo, condiciones especiales..."
                rows={2}
              />
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: 'outline' })}
              >
                Cancelar
              </button>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Guardando...'
                  : editando
                    ? 'Guardar cambios'
                    : 'Crear acuerdo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Footer info */}
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
          <p>
            <strong className="text-foreground">¿Cuándo registrar un acuerdo?</strong>{' '}
            Cada vez que le prometés algo a un proveedor que no es el plan de pago
            original: un diferimiento, un pago parcial, una refinanciación, una
            promesa de fecha. Tener historial te protege: cuando un proveedor te dice
            &quot;vos siempre cumplís&quot; o &quot;ya me fallaste antes&quot;, podés
            verificar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
