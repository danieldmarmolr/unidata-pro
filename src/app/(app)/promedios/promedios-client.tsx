'use client';

import { AlertTriangle, ChevronDown, ChevronRight, Info, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fmtMonto, fmtFechaAR } from '../erogaciones/utils';
import type { PromediosUnidad, DowIndex } from './calcular';
import { DOW_LABELS_LONG } from './calcular';
import {
  DECAYS_PRESETS,
  VENTANAS_VALIDAS,
  type FiltrosPromedios,
} from './schema';

const DOWS: DowIndex[] = [0, 1, 2, 3, 4, 5, 6];

type Unidad = { id: number; nombre: string; activa: boolean };
type EventoExcluido = {
  id: number;
  fecha: string;
  monto: string;
  unidadNegocioId: number;
};

type Props = {
  unidades: Unidad[];
  promedios: PromediosUnidad[];
  filtros: FiltrosPromedios;
  totalFilasFacturacion: number;
  eventosExcluidos: EventoExcluido[];
  referenciaISO: string;
};

function confianzaColor(desvioPct: number, n: number): string {
  if (n === 0) return 'bg-muted text-muted-foreground border-border';
  if (n < 3) return 'bg-warning/10 text-warning border-warning/30';
  if (desvioPct < 20) return 'bg-success/10 text-success border-success/30';
  if (desvioPct < 40) return 'bg-info/10 text-info border-info/30';
  return 'bg-warning/10 text-warning border-warning/30';
}

export function PromediosClient({
  unidades,
  promedios,
  filtros,
  totalFilasFacturacion,
  eventosExcluidos,
  referenciaISO,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [modo, setModo] = useState<'ponderado' | 'simple'>('ponderado');
  const [mostrarEventos, setMostrarEventos] = useState(false);

  function actualizarFiltro(key: 'ventana' | 'decay', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    startTransition(() => {
      router.replace(`/promedios?${params.toString()}`);
    });
  }

  const totalFilasUsadas = useMemo(
    () => promedios.reduce((a, p) => a + p.filasUsadas, 0),
    [promedios],
  );
  const totalFilasEventos = useMemo(
    () => promedios.reduce((a, p) => a + p.filasExcluidasEventoPuntual, 0),
    [promedios],
  );
  const totalSemanalGrupo = useMemo(
    () =>
      promedios.reduce(
        (a, p) =>
          a + (modo === 'ponderado' ? p.totalSemanalPonderado : p.totalSemanalSimple),
        0,
      ),
    [promedios, modo],
  );
  const totalMensualGrupo = totalSemanalGrupo * (52 / 12);

  if (totalFilasFacturacion === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <TrendingUp className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-medium">Sin datos de facturacion todavia</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Necesitas cargar facturacion diaria (importando el Excel o manualmente) para
              que el motor calcule los promedios ponderados por dia de semana.
            </p>
          </div>
          <div className="flex justify-center gap-2 pt-2">
            <Link
              href="/unidades-negocio"
              className="text-sm text-primary hover:underline"
            >
              Configurar unidades de negocio
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (unidades.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
          <p className="text-sm">
            No hay unidades de negocio activas.{' '}
            <Link href="/unidades-negocio" className="text-primary hover:underline">
              Crear o activar al menos una
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Semanal proyectado
            </p>
            <p className="text-xl font-semibold mt-1">{fmtMonto(totalSemanalGrupo)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              suma de las {unidades.length} unidades
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Mensual proyectado
            </p>
            <p className="text-xl font-semibold mt-1">{fmtMonto(totalMensualGrupo)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              extrapolacion semanal x 52/12
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Datos usados
            </p>
            <p className="text-xl font-semibold mt-1">{totalFilasUsadas}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              filas dentro de la ventana
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Eventos excluidos
            </p>
            <p className="text-xl font-semibold mt-1">{totalFilasEventos}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              marcados como evento puntual
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-4 p-4 rounded-lg border bg-card">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Ventana
          </label>
          <div className="flex rounded-md border overflow-hidden">
            {VENTANAS_VALIDAS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => actualizarFiltro('ventana', String(v))}
                disabled={isPending}
                className={cn(
                  'px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors',
                  filtros.ventana === v
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {v}s
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Ponderacion (decay)
          </label>
          <Select
            value={String(filtros.decay)}
            onValueChange={(v) => v && actualizarFiltro('decay', String(v))}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECAYS_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={String(preset.value)}>
                  <div className="flex flex-col">
                    <span>
                      {preset.label}{' '}
                      <span className="text-muted-foreground text-xs">
                        ({preset.value})
                      </span>
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Mostrar
          </label>
          <div className="flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setModo('ponderado')}
              className={cn(
                'px-3 py-1.5 text-sm border-r transition-colors',
                modo === 'ponderado'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              Ponderado
            </button>
            <button
              type="button"
              onClick={() => setModo('simple')}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                modo === 'simple'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              Simple
            </button>
          </div>
        </div>

        <div className="ml-auto text-xs text-muted-foreground space-y-0.5 text-right">
          <p>
            Referencia: <span className="font-medium">{fmtFechaAR(referenciaISO)}</span>
          </p>
          <p>
            Ventana = ultimas <span className="font-medium">{filtros.ventana}</span>{' '}
            semanas
          </p>
        </div>
      </div>

      {/* Tabla matriz */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground sticky left-0 bg-muted/50 z-10">
                  Dia
                </th>
                {unidades.map((u) => (
                  <th
                    key={u.id}
                    className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {u.nombre}
                  </th>
                ))}
                <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted-foreground bg-muted">
                  Total dia
                </th>
              </tr>
            </thead>
            <tbody>
              {DOWS.map((dow) => {
                const totalDia = promedios.reduce(
                  (a, p) =>
                    a + (modo === 'ponderado' ? p.porDow[dow].ponderado : p.porDow[dow].simple),
                  0,
                );
                return (
                  <tr key={dow} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium sticky left-0 bg-background z-10">
                      <span className="block">{DOW_LABELS_LONG[dow]}</span>
                    </td>
                    {unidades.map((u) => {
                      const prom = promedios.find((p) => p.unidadNegocioId === u.id);
                      const stat = prom?.porDow[dow];
                      if (!stat || stat.n === 0) {
                        return (
                          <td
                            key={u.id}
                            className="px-4 py-3 text-right text-muted-foreground/60 italic text-xs"
                          >
                            sin datos
                          </td>
                        );
                      }
                      const valor =
                        modo === 'ponderado' ? stat.ponderado : stat.simple;
                      return (
                        <td key={u.id} className="px-4 py-3 text-right">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div className="inline-flex flex-col items-end gap-0.5 cursor-help">
                                  <span className="font-medium tabular-nums">
                                    {fmtMonto(valor)}
                                  </span>
                                  <span
                                    className={cn(
                                      'text-[10px] px-1.5 py-0.5 rounded border',
                                      confianzaColor(stat.desvioPct, stat.n),
                                    )}
                                  >
                                    n={stat.n} · {stat.desvioPct.toFixed(0)}%
                                  </span>
                                </div>
                              }
                            />
                            <TooltipContent>
                              <div className="text-xs space-y-1">
                                <p className="font-medium">
                                  {u.nombre} - {DOW_LABELS_LONG[dow]}
                                </p>
                                <p>Ponderado: {fmtMonto(stat.ponderado)}</p>
                                <p>Simple: {fmtMonto(stat.simple)}</p>
                                <p>Datapoints: {stat.n}</p>
                                <p>Desvio relativo: {stat.desvioPct.toFixed(1)}%</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums bg-muted/30">
                      {fmtMonto(totalDia)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 bg-muted/50 font-semibold">
                <td className="px-4 py-3 sticky left-0 bg-muted/50 z-10">
                  Total semanal
                </td>
                {unidades.map((u) => {
                  const prom = promedios.find((p) => p.unidadNegocioId === u.id);
                  const total = prom
                    ? modo === 'ponderado'
                      ? prom.totalSemanalPonderado
                      : prom.totalSemanalSimple
                    : 0;
                  return (
                    <td key={u.id} className="px-4 py-3 text-right tabular-nums">
                      {fmtMonto(total)}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right tabular-nums bg-muted">
                  {fmtMonto(totalSemanalGrupo)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Leyenda de confianza */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Confianza por celda:
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border bg-success/10 border-success/30" />
          Estable (&lt;20% desvio)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border bg-info/10 border-info/30" />
          Normal (20-40%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border bg-warning/10 border-warning/30" />
          Volatil o pocos datos
        </span>
      </div>

      {/* Eventos puntuales excluidos */}
      {eventosExcluidos.length > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setMostrarEventos((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-2 text-sm hover:bg-muted/30 transition-colors"
          >
            {mostrarEventos ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="font-medium">
              {eventosExcluidos.length} eventos puntuales excluidos del calculo
            </span>
            <Badge variant="secondary" className="ml-auto">
              dentro de la ventana
            </Badge>
          </button>
          {mostrarEventos && (
            <div className="border-t">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Fecha
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Unidad
                    </th>
                    <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Monto
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eventosExcluidos.map((ev) => {
                    const u = unidades.find((x) => x.id === ev.unidadNegocioId);
                    return (
                      <tr key={ev.id} className="border-t">
                        <td className="px-4 py-2">{fmtFechaAR(ev.fecha)}</td>
                        <td className="px-4 py-2">{u?.nombre ?? `#${ev.unidadNegocioId}`}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtMonto(ev.monto)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Explicacion del metodo */}
      <Card>
        <CardContent className="p-4 text-sm space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground flex items-center gap-2">
            <Info className="h-4 w-4" />
            Como se calcula
          </p>
          <p>
            <strong className="text-foreground">Promedio ponderado:</strong> para cada
            dia de la semana, tomamos todos los datapoints dentro de la ventana y los
            promediamos dandole mas peso a las semanas recientes (peso = decay^semanasAtras).
            Default decay = 0.85 (la semana actual pesa 1, la pasada 0.85, hace 2 semanas 0.72, etc.).
          </p>
          <p>
            <strong className="text-foreground">Por que excluimos eventos puntuales:</strong>{' '}
            los dias marcados como evento puntual (Black Friday, festivos atipicos,
            cancelaciones masivas) tienen un comportamiento que no se repite todas las
            semanas. Si los incluyeramos, contaminarian el promedio del dia de semana al que
            cayeron. Para marcarlos, edita la facturacion diaria y activa el flag
            &quot;evento puntual&quot;.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
