'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Activity,
  ArrowDownToLine,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  borrarFacturacion,
  crearFacturacion,
  editarFacturacion,
} from './actions';
import { facturacionSchema, type FacturacionInput } from './schema';

type Item = {
  id: number;
  fecha: string;
  unidadNegocioId: number;
  empresaId: number | null;
  monto: string;
  esEventoPuntual: boolean;
  origen: string;
};

type Unidad = { id: number; nombre: string };
type Empresa = { id: number; nombre: string };

const COLORS = ['#16a34a', '#0ea5e9', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6'];

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function FacturacionClient({
  items,
  unidades,
  empresas,
  rango,
  total,
  cantidad,
}: {
  items: Item[];
  unidades: Unidad[];
  empresas: Empresa[];
  rango: { desde: string; hasta: string };
  total: number;
  cantidad: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Item | null>(null);
  const [pendingForm, startFormTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [vista, setVista] = useState<'consolidado' | number>('consolidado');

  const unidadesMap = useMemo(
    () => new Map(unidades.map((u) => [u.id, u.nombre])),
    [unidades],
  );
  const empresasMap = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.nombre])),
    [empresas],
  );

  const defaultValues: FacturacionInput = {
    fecha: hoyISO(),
    unidadNegocioId: unidades[0]?.id ?? 0,
    empresaId: undefined,
    monto: '',
    esEventoPuntual: false,
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FacturacionInput>({
    resolver: zodResolver(facturacionSchema),
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
      unidadNegocioId: it.unidadNegocioId,
      empresaId: it.empresaId ?? undefined,
      monto: it.monto,
      esEventoPuntual: it.esEventoPuntual,
    });
    setOpen(true);
  }

  function onSubmit(data: FacturacionInput) {
    startFormTransition(async () => {
      const res = editando
        ? await editarFacturacion(editando.id, data)
        : await crearFacturacion(data);
      if (res.ok) {
        toast.success(editando ? 'Facturacion editada' : 'Facturacion cargada');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function onBorrar(it: Item) {
    const u = unidadesMap.get(it.unidadNegocioId) ?? '';
    if (
      !confirm(
        `Borrar facturacion de ${u} del ${fmtFechaAR(it.fecha)} por ${fmtMonto(it.monto)}?`,
      )
    )
      return;
    startFormTransition(async () => {
      const res = await borrarFacturacion(it.id);
      if (res.ok) toast.success('Facturacion borrada');
      else toast.error(res.error);
    });
  }

  function actualizarRango(desde: string, hasta: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('desde', desde);
    params.set('hasta', hasta);
    startTransition(() => {
      router.replace(`/facturacion?${params.toString()}`);
    });
  }

  // Serie para el grafico de lineas
  // Index por (fecha, unidadId) -> monto sumado
  const indexFechaUnidad = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const k = `${it.fecha}|${it.unidadNegocioId}`;
      m.set(k, (m.get(k) ?? 0) + Number(it.monto));
    }
    return m;
  }, [items]);

  // Set de fechas unicas ordenadas asc
  const fechasOrdenadas = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.fecha);
    return Array.from(set).sort();
  }, [items]);

  const chartData = useMemo(() => {
    return fechasOrdenadas.map((fecha) => {
      const point: Record<string, string | number | null> = {
        fecha,
        fechaCorta: format(parseISO(fecha), 'd MMM', { locale: es }),
      };
      let consolidado = 0;
      for (const u of unidades) {
        const v = indexFechaUnidad.get(`${fecha}|${u.id}`) ?? 0;
        point[`u_${u.id}`] = v > 0 ? v : null;
        consolidado += v;
      }
      point.consolidado = consolidado > 0 ? consolidado : null;
      return point;
    });
  }, [fechasOrdenadas, indexFechaUnidad, unidades]);

  // Lista filtrada para tabla
  const itemsFiltrados = useMemo(() => {
    let lista = items;
    if (vista !== 'consolidado') {
      lista = lista.filter((it) => it.unidadNegocioId === vista);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      lista = lista.filter((it) => {
        const uNombre = (unidadesMap.get(it.unidadNegocioId) ?? '').toLowerCase();
        const eNombre = it.empresaId
          ? (empresasMap.get(it.empresaId) ?? '').toLowerCase()
          : '';
        return (
          uNombre.includes(q) ||
          eNombre.includes(q) ||
          it.fecha.includes(q) ||
          it.monto.includes(q)
        );
      });
    }
    return lista;
  }, [items, vista, query, unidadesMap, empresasMap]);

  function exportarCSV() {
    const headers = ['fecha', 'unidad_negocio', 'empresa', 'monto', 'evento_puntual', 'origen'];
    const filas = itemsFiltrados.map((it) => [
      it.fecha,
      unidadesMap.get(it.unidadNegocioId) ?? '',
      it.empresaId ? empresasMap.get(it.empresaId) ?? '' : '',
      it.monto,
      it.esEventoPuntual ? 'si' : 'no',
      it.origen,
    ]);
    const csv = [headers, ...filas]
      .map((row) =>
        row
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturacion-${rango.desde}-a-${rango.hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (unidades.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">No hay unidades de negocio cargadas</p>
          <Link
            href="/unidades-negocio"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Ir a unidades →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs + acciones */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total en el periodo</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-success">
              {fmtMonto(total)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Registros</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{cantidad}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Desde / hasta</p>
            <div className="flex gap-1.5 mt-1">
              <Input
                type="date"
                value={rango.desde}
                onChange={(e) => actualizarRango(e.target.value, rango.hasta)}
                className="h-7 text-xs"
              />
              <Input
                type="date"
                value={rango.hasta}
                onChange={(e) => actualizarRango(rango.desde, e.target.value)}
                className="h-7 text-xs"
              />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-4 flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4 text-primary" />
            <Link href="/importar" className="text-xs text-primary hover:underline flex-1">
              Importar desde Excel
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Tabs unidad / consolidado */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setVista('consolidado')}
            className={cn(
              'h-8 px-3 text-xs rounded-md border transition-colors',
              vista === 'consolidado'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card hover:bg-muted',
            )}
          >
            Consolidado
          </button>
          {unidades.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setVista(u.id)}
              className={cn(
                'h-8 px-3 text-xs rounded-md border transition-colors inline-flex items-center gap-1.5',
                vista === u.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-muted',
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              {u.nombre}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico */}
      <Card>
        <CardContent className="p-5">
          {chartData.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Sin datos de facturacion en el rango. Cargá filas con el boton abajo o
              importá desde Excel.
            </div>
          ) : (
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.6} />
                  <XAxis
                    dataKey="fechaCorta"
                    fontSize={11}
                    tick={{ fill: '#6b7280' }}
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    fontSize={11}
                    tick={{ fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={fmtCorto}
                    width={60}
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as {
                        fecha: string;
                        consolidado: number | null;
                      };
                      return (
                        <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-1">
                          <p className="font-medium capitalize">
                            {format(parseISO(d.fecha), "EEEE d 'de' MMMM", {
                              locale: es,
                            })}
                          </p>
                          {vista === 'consolidado' ? (
                            <>
                              {unidades.map((u) => {
                                const v = (
                                  d as unknown as Record<string, number | null>
                                )[`u_${u.id}`];
                                if (v === null || v === undefined) return null;
                                return (
                                  <p key={u.id} className="tabular-nums">
                                    {u.nombre}: {fmtMonto(v)}
                                  </p>
                                );
                              })}
                              <p className="tabular-nums border-t pt-1 mt-1 font-medium">
                                Total: {d.consolidado ? fmtMonto(d.consolidado) : '-'}
                              </p>
                            </>
                          ) : (
                            <p className="tabular-nums">
                              {fmtMonto(
                                (d as unknown as Record<string, number>)[
                                  `u_${vista}`
                                ] ?? 0,
                              )}
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  {vista === 'consolidado' ? (
                    unidades.map((u, i) => (
                      <Line
                        key={u.id}
                        type="monotone"
                        dataKey={`u_${u.id}`}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: COLORS[i % COLORS.length], strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        name={u.nombre}
                        connectNulls
                      />
                    ))
                  ) : (
                    <Line
                      type="monotone"
                      dataKey={`u_${vista}`}
                      stroke={
                        COLORS[
                          unidades.findIndex((u) => u.id === vista) % COLORS.length
                        ]
                      }
                      strokeWidth={2.5}
                      dot={{
                        r: 2.5,
                        fill:
                          COLORS[
                            unidades.findIndex((u) => u.id === vista) % COLORS.length
                          ],
                        strokeWidth: 0,
                      }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toolbar tabla */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={exportarCSV}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Exportar CSV
        </Button>
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-1.5" />
          Nueva facturacion
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
                Unidad
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Empresa
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Monto
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Tipo
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {query
                    ? 'Sin coincidencias para tu busqueda'
                    : 'Sin facturacion en el rango'}
                </td>
              </tr>
            ) : (
              itemsFiltrados.map((it) => (
                <tr key={it.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-xs tabular-nums">
                    {fmtFechaAR(it.fecha)}
                  </td>
                  <td className="px-4 py-2.5">
                    {unidadesMap.get(it.unidadNegocioId) ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {it.empresaId ? empresasMap.get(it.empresaId) ?? '-' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-success">
                    {fmtMonto(it.monto)}
                  </td>
                  <td className="px-4 py-2.5">
                    {it.esEventoPuntual ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-warning/10 text-warning border-warning/30"
                      >
                        evento puntual
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        normal
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
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
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>
                {editando ? 'Editar facturacion' : 'Nueva facturacion'}
              </DialogTitle>
              <DialogDescription>
                Si la combinacion (fecha + unidad + empresa) ya existe se reemplaza.
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
                <Label>Unidad de negocio *</Label>
                <Controller
                  name="unidadNegocioId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={String(field.value || '')}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir unidad" />
                      </SelectTrigger>
                      <SelectContent>
                        {unidades.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.unidadNegocioId && (
                  <p className="text-xs text-danger">{errors.unidadNegocioId.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Empresa (opcional)</Label>
                <Controller
                  name="empresaId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : 'none'}
                      onValueChange={(v) =>
                        field.onChange(v === 'none' ? undefined : Number(v))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin empresa" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin especificar</SelectItem>
                        {empresas.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {e.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <Controller
                name="esEventoPuntual"
                control={control}
                render={({ field }) => (
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.value ?? false}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Es evento puntual</span>
                      <span className="block text-xs text-muted-foreground">
                        Black Friday, cancelacion, evento atipico. Se excluye del calculo de
                        promedios.
                      </span>
                    </span>
                  </label>
                )}
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
              <Button type="submit" disabled={pendingForm}>
                {pendingForm
                  ? 'Guardando...'
                  : editando
                    ? 'Guardar cambios'
                    : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
