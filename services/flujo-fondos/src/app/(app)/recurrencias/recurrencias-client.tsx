'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useState, useTransition } from 'react';
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
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  borrarRecurrencia,
  crearRecurrencia,
  editarRecurrencia,
  generarErogacionesDeRecurrencia,
  toggleActivaRecurrencia,
} from './actions';
import {
  FRECUENCIAS,
  FRECUENCIA_LABELS,
  recurrenciaFormSchema,
  type Frecuencia,
  type RecurrenciaInput,
} from './schema';

type Entidad = { id: number; nombre: string };

type RecurrenciaFila = {
  id: number;
  descripcion: string;
  montoBase: string | null;
  frecuencia: Frecuencia;
  fechaInicio: string;
  fechaFin: string | null;
  cuotasTotales: number | null;
  empresaId: number | null;
  bancoId: number | null;
  proveedorId: number | null;
  activa: boolean;
  empresaNombre: string | null;
  bancoNombre: string | null;
  proveedorNombre: string | null;
};

type Props = {
  filas: RecurrenciaFila[];
  empresas: Entidad[];
  bancos: Entidad[];
  proveedores: Entidad[];
};

export function RecurrenciasClient({ filas, empresas, bancos, proveedores }: Props) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<RecurrenciaFila | null>(null);
  const [pending, startTransition] = useTransition();

  const defaultValues: RecurrenciaInput = {
    descripcion: '',
    montoBase: '',
    frecuencia: 'mensual',
    fechaInicio: '',
    fechaFin: '',
    empresaId: 0,
    bancoId: 0,
    activa: true,
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<RecurrenciaInput>({
    resolver: zodResolver(recurrenciaFormSchema),
    defaultValues,
  });

  function abrirNuevo() {
    setEditando(null);
    reset(defaultValues);
    setOpen(true);
  }

  function abrirEditar(r: RecurrenciaFila) {
    setEditando(r);
    reset({
      descripcion: r.descripcion,
      montoBase: r.montoBase ?? '',
      frecuencia: r.frecuencia,
      fechaInicio: r.fechaInicio,
      fechaFin: r.fechaFin ?? '',
      cuotasTotales: r.cuotasTotales ?? undefined,
      proveedorId: r.proveedorId ?? undefined,
      empresaId: r.empresaId ?? 0,
      bancoId: r.bancoId ?? 0,
      activa: r.activa,
    });
    setOpen(true);
  }

  function onSubmit(values: RecurrenciaInput) {
    startTransition(async () => {
      const res = editando
        ? await editarRecurrencia(editando.id, values)
        : await crearRecurrencia(values);
      if (res.ok) {
        toast.success(editando ? 'Recurrencia actualizada' : 'Recurrencia creada');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function onBorrar(r: RecurrenciaFila) {
    if (!confirm(`Borrar la recurrencia "${r.descripcion}"?`)) return;
    startTransition(async () => {
      const res = await borrarRecurrencia(r.id);
      if (res.ok) toast.success('Recurrencia borrada');
      else toast.error(res.error);
    });
  }

  function onToggle(r: RecurrenciaFila) {
    startTransition(async () => {
      const res = await toggleActivaRecurrencia(r.id, !r.activa);
      if (res.ok)
        toast.success(r.activa ? 'Desactivada' : 'Activada');
      else toast.error(res.error);
    });
  }

  function onGenerar(r: RecurrenciaFila) {
    if (!confirm(`Generar erogaciones pendientes de "${r.descripcion}" para los proximos 90 dias?`)) return;
    startTransition(async () => {
      const res = await generarErogacionesDeRecurrencia(r.id, 90);
      if (res.ok)
        toast.success(`${res.creadas} erogaciones creadas (${res.saltadas} ya existian)`);
      else toast.error(res.error);
    });
  }

  if (empresas.length === 0 || bancos.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">Faltan datos maestros</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Antes de crear recurrencias necesitas tener al menos una empresa y un
            banco cargados.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva recurrencia
        </Button>
      </div>

      {filas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-base font-medium">Todavia no hay recurrencias</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Defini gastos que se repiten (alquiler, sueldos, servicios) una sola
              vez y generá las erogaciones pendientes con un click.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Descripcion
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Frecuencia
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Monto base
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Vigencia
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Asignacion
                  </th>
                  <th className="text-center px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Estado
                  </th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-t hover:bg-muted/30',
                      !r.activa && 'opacity-60',
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.descripcion}</p>
                      {r.proveedorNombre && (
                        <p className="text-xs text-muted-foreground">
                          {r.proveedorNombre}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">
                        {FRECUENCIA_LABELS[r.frecuencia]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.montoBase ? fmtMonto(r.montoBase) : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      Desde {fmtFechaAR(r.fechaInicio)}
                      {r.fechaFin && <> · hasta {fmtFechaAR(r.fechaFin)}</>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>{r.empresaNombre ?? '-'}</div>
                      <div>{r.bancoNombre ?? '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          r.activa
                            ? 'bg-success/10 text-success border-success/30'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {r.activa ? 'Activa' : 'Pausada'}
                      </Badge>
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
                          <DropdownMenuItem onClick={() => onGenerar(r)} disabled={!r.activa}>
                            <Play className="h-3.5 w-3.5 mr-2" />
                            Generar 90 dias
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => abrirEditar(r)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onToggle(r)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-2" />
                            {r.activa ? 'Pausar' : 'Activar'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onBorrar(r)}
                            className="text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Borrar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Como funciona &quot;Generar 90 dias&quot;
          </p>
          <p>
            Crea erogaciones <strong className="text-foreground">pendientes</strong>{' '}
            en el Inbox para cada fecha programada de los proximos 90 dias, sin
            duplicar las que ya existan. Vos despues las marcas como pagadas cuando
            corresponda. Si cambian las condiciones, edita la recurrencia y volvé a
            generar (las viejas pendientes podes editarlas o borrarlas individualmente
            desde el Inbox).
          </p>
        </CardContent>
      </Card>

      {/* Dialog form */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editando ? 'Editar recurrencia' : 'Nueva recurrencia'}
            </DialogTitle>
            <DialogDescription>
              {editando
                ? 'Actualizá los datos de la recurrencia.'
                : 'Configurá un gasto que se repite (alquiler, sueldos, servicios).'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="descripcion">Descripcion</Label>
              <Input
                id="descripcion"
                {...register('descripcion')}
                placeholder="Alquiler oficina, Sueldos personal..."
              />
              {errors.descripcion && (
                <p className="text-xs text-danger">{errors.descripcion.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="montoBase">Monto base</Label>
                <Input
                  id="montoBase"
                  type="number"
                  step="0.01"
                  {...register('montoBase')}
                  placeholder="0.00"
                />
                {errors.montoBase && (
                  <p className="text-xs text-danger">{errors.montoBase.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="frecuencia">Frecuencia</Label>
                <Controller
                  control={control}
                  name="frecuencia"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v as Frecuencia)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FRECUENCIAS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FRECUENCIA_LABELS[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fechaInicio">Fecha de inicio</Label>
                <Input id="fechaInicio" type="date" {...register('fechaInicio')} />
                {errors.fechaInicio && (
                  <p className="text-xs text-danger">{errors.fechaInicio.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fechaFin">Fecha de fin (opcional)</Label>
                <Input id="fechaFin" type="date" {...register('fechaFin')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="empresaId">Empresa</Label>
                <Controller
                  control={control}
                  name="empresaId"
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : ''}
                      onValueChange={(v) => v && field.onChange(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir..." />
                      </SelectTrigger>
                      <SelectContent>
                        {empresas.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {e.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.empresaId && (
                  <p className="text-xs text-danger">{errors.empresaId.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bancoId">Banco</Label>
                <Controller
                  control={control}
                  name="bancoId"
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : ''}
                      onValueChange={(v) => v && field.onChange(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir..." />
                      </SelectTrigger>
                      <SelectContent>
                        {bancos.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.bancoId && (
                  <p className="text-xs text-danger">{errors.bancoId.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proveedorId">Proveedor (opcional)</Label>
              <Controller
                control={control}
                name="proveedorId"
                render={({ field }) => (
                  <Select
                    value={field.value ? String(field.value) : 'ninguno'}
                    onValueChange={(v) =>
                      v && field.onChange(v === 'ninguno' ? undefined : Number(v))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin proveedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ninguno">Sin proveedor</SelectItem>
                      {proveedores.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="activa"
                render={({ field }) => (
                  <input
                    type="checkbox"
                    id="activa"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                )}
              />
              <Label htmlFor="activa" className="cursor-pointer">
                Recurrencia activa (generara erogaciones)
              </Label>
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
                    : 'Crear recurrencia'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
