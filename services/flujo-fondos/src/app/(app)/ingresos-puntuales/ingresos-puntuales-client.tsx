'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownToLine, Pencil, Plus, Search, Trash2, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
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
  borrarIngresoPuntual,
  crearIngresoPuntual,
  editarIngresoPuntual,
} from './actions';
import {
  CATEGORIAS_INGRESO_PUNTUAL,
  CATEGORIA_LABELS,
  ingresoPuntualSchema,
  type CategoriaIngresoPuntual,
  type IngresoPuntualInput,
} from './schema';

type Item = {
  id: number;
  fecha: string;
  descripcion: string;
  monto: string;
  empresaId: number;
  bancoId: number | null;
  categoria: string | null;
  notas: string | null;
  origen: string;
};

type Empresa = { id: number; nombre: string };
type Banco = { id: number; nombre: string };

function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const CATEGORIA_BADGE: Record<CategoriaIngresoPuntual, string> = {
  cobro_cheque: 'bg-success/10 text-success border-success/30',
  prestamo: 'bg-info/10 text-info border-info/30',
  devolucion: 'bg-warning/10 text-warning border-warning/30',
  aporte_socio: 'bg-primary/10 text-primary border-primary/30',
  venta_activo: 'bg-muted text-muted-foreground border-border',
  otro: 'bg-muted text-muted-foreground border-border',
};

export function IngresosPuntualesClient({
  items,
  empresas,
  bancos,
}: {
  items: Item[];
  empresas: Empresa[];
  bancos: Banco[];
}) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Item | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const defaultValues: IngresoPuntualInput = {
    fecha: hoyISO(),
    descripcion: '',
    monto: '',
    empresaId: empresas[0]?.id ?? 0,
    bancoId: undefined,
    categoria: 'otro',
    notas: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<IngresoPuntualInput>({
    resolver: zodResolver(ingresoPuntualSchema),
    defaultValues,
  });

  function abrirNuevo() {
    setEditando(null);
    reset(defaultValues);
    setOpen(true);
  }

  function abrirEditar(it: Item) {
    setEditando(it);
    reset({
      fecha: it.fecha,
      descripcion: it.descripcion,
      monto: it.monto,
      empresaId: it.empresaId,
      bancoId: it.bancoId ?? undefined,
      categoria: (it.categoria as CategoriaIngresoPuntual | null) ?? 'otro',
      notas: it.notas ?? '',
    });
    setOpen(true);
  }

  function onSubmit(data: IngresoPuntualInput) {
    startTransition(async () => {
      const res = editando
        ? await editarIngresoPuntual(editando.id, data)
        : await crearIngresoPuntual(data);
      if (res.ok) {
        toast.success(editando ? 'Ingreso editado' : 'Ingreso registrado');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function onBorrar(it: Item) {
    if (
      !confirm(`Borrar el ingreso del ${fmtFechaAR(it.fecha)} por ${fmtMonto(it.monto)}?`)
    )
      return;
    startTransition(async () => {
      const res = await borrarIngresoPuntual(it.id);
      if (res.ok) toast.success('Ingreso borrado');
      else toast.error(res.error);
    });
  }

  const empresasMap = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.nombre])),
    [empresas],
  );
  const bancosMap = useMemo(
    () => new Map(bancos.map((b) => [b.id, b.nombre])),
    [bancos],
  );

  const itemsFiltrados = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        it.descripcion.toLowerCase().includes(q) ||
        (it.notas ?? '').toLowerCase().includes(q) ||
        (empresasMap.get(it.empresaId) ?? '').toLowerCase().includes(q),
    );
  }, [items, query, empresasMap]);

  const totalGeneral = items.reduce((a, x) => a + Number(x.monto), 0);
  const totalFuturo = items
    .filter((it) => it.fecha >= hoyISO())
    .reduce((a, x) => a + Number(x.monto), 0);

  if (empresas.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">No hay empresas cargadas</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Antes de cargar ingresos puntuales necesitas al menos una empresa.
          </p>
          <Link
            href="/empresas"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Ir a empresas →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total registrado</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-success">
              {fmtMonto(totalGeneral)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {items.length} {items.length === 1 ? 'ingreso' : 'ingresos'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">A futuro (hoy y despues)</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-info">
              {fmtMonto(totalFuturo)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Lo que se suma a la proyeccion
            </p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowDownToLine className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-xs font-medium">Carga masiva</p>
              <Link
                href="/importar"
                className="text-xs text-primary hover:underline"
              >
                Importar desde Excel →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por descripcion, empresa o nota..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-1.5" />
          Nuevo ingreso
        </Button>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Fecha
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Descripcion
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Monto
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Empresa
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Banco
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Categoria
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {query
                    ? `Sin coincidencias para "${query}"`
                    : 'Aun no hay ingresos puntuales cargados.'}
                </td>
              </tr>
            ) : (
              itemsFiltrados.map((it) => {
                const cat = (it.categoria as CategoriaIngresoPuntual | null) ?? 'otro';
                const esFuturo = it.fecha >= hoyISO();
                return (
                  <tr key={it.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs">
                      <p className="tabular-nums">{fmtFechaAR(it.fecha)}</p>
                      {esFuturo && (
                        <p className="text-[10px] text-info mt-0.5">a futuro</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{it.descripcion}</p>
                      {it.notas && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {it.notas}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-success">
                      +{fmtMonto(it.monto)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {empresasMap.get(it.empresaId) ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {it.bancoId ? bancosMap.get(it.bancoId) ?? '-' : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', CATEGORIA_BADGE[cat])}
                      >
                        {CATEGORIA_LABELS[cat]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => abrirEditar(it)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onBorrar(it)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-danger/10 text-muted-foreground hover:text-danger ml-1"
                        aria-label="Borrar"
                        title="Borrar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>
                {editando ? 'Editar ingreso puntual' : 'Nuevo ingreso puntual'}
              </DialogTitle>
              <DialogDescription>
                Plata que ENTRA por algun motivo extraordinario (no facturacion
                recurrente).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fecha">Fecha *</Label>
                  <Input id="fecha" type="date" {...register('fecha')} />
                  {errors.fecha && (
                    <p className="text-xs text-danger">{errors.fecha.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monto">Monto (ARS) *</Label>
                  <Input
                    id="monto"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...register('monto')}
                  />
                  {errors.monto && (
                    <p className="text-xs text-danger">{errors.monto.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="descripcion">Descripcion *</Label>
                <Input
                  id="descripcion"
                  placeholder="Ej: Cobro ECHEQ Gocuotas"
                  {...register('descripcion')}
                />
                {errors.descripcion && (
                  <p className="text-xs text-danger">{errors.descripcion.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Empresa *</Label>
                  <Controller
                    name="empresaId"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={String(field.value || '')}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Elegir empresa" />
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
                  <Label>Categoria</Label>
                  <Controller
                    name="categoria"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value ?? 'otro'}
                        onValueChange={(v) => field.onChange(v as CategoriaIngresoPuntual)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS_INGRESO_PUNTUAL.map((c) => (
                            <SelectItem key={c} value={c}>
                              {CATEGORIA_LABELS[c]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Banco (opcional)</Label>
                <Controller
                  name="bancoId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : 'none'}
                      onValueChange={(v) =>
                        field.onChange(v === 'none' ? undefined : Number(v))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin especificar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin especificar</SelectItem>
                        {bancos.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notas">Notas</Label>
                <Textarea
                  id="notas"
                  placeholder="Detalle adicional..."
                  rows={2}
                  {...register('notas')}
                />
              </div>
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
                {pending ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear ingreso'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
