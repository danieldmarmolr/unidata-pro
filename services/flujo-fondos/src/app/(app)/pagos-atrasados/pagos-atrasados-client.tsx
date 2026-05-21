'use client';

import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  aplicarTentativas,
  calcularSugerencias,
  cambiarPrioridad,
  cancelarTentativas,
  confirmarTentativas,
} from './actions';
import { PRIORIDAD_LABELS, type PrioridadAtraso } from './schema';

export type PagoAtrasadoRow = {
  id: number;
  fechaPago: string;
  fechaSugeridaTentativa: string | null;
  descripcion: string;
  monto: string;
  empresaNombre: string;
  bancoNombre: string;
  proveedorNombre: string | null;
  estado: string;
  prioridadAtraso: PrioridadAtraso;
  esCritico: boolean;
  diasAtraso: number;
};

type SugerenciaMap = Map<number, string | null>;

export function PagosAtrasadosClient({
  rows,
  colchonDefault,
  hoyISO,
}: {
  rows: PagoAtrasadoRow[];
  colchonDefault: number;
  hoyISO: string;
}) {
  const [colchonStr, setColchonStr] = useState(String(colchonDefault));
  const [sugerencias, setSugerencias] = useState<SugerenciaMap>(new Map());
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [calculando, setCalculando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [filtroPrioridad, setFiltroPrioridad] = useState<
    'todas' | PrioridadAtraso
  >('todas');

  // IDs sin tentativa puesta (los candidatos para sugerir).
  const idsSinTentativa = useMemo(
    () => rows.filter((r) => r.fechaSugeridaTentativa === null).map((r) => r.id),
    [rows],
  );

  const colchon = useMemo(() => {
    const n = Number(colchonStr.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : colchonDefault;
  }, [colchonStr, colchonDefault]);

  const recalcular = useCallback(async () => {
    if (idsSinTentativa.length === 0) {
      setSugerencias(new Map());
      return;
    }
    setCalculando(true);
    try {
      const res = await calcularSugerencias(idsSinTentativa, colchon);
      if (res.ok) {
        const map = new Map<number, string | null>();
        for (const s of res.sugerencias) map.set(s.id, s.fechaSugerida);
        setSugerencias(map);
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(
        `Error calculando sugerencias: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setCalculando(false);
    }
  }, [idsSinTentativa, colchon]);

  // Calcular sugerencias en cuanto carga la pagina o cambia la lista de
  // candidatos (porque ya aplicamos tentativas o las cancelamos).
  useEffect(() => {
    void recalcular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsSinTentativa.length]);

  const filasFiltradas = useMemo(() => {
    return rows.filter((r) =>
      filtroPrioridad === 'todas' ? true : r.prioridadAtraso === filtroPrioridad,
    );
  }, [rows, filtroPrioridad]);

  // Orden visual: tentativas primero, luego con sugerencia, luego sin
  // viabilidad. Dentro de cada grupo, prioridad normal antes que laxo, y dias
  // atraso DESC.
  const filasOrdenadas = useMemo(() => {
    function grupo(r: PagoAtrasadoRow): number {
      if (r.fechaSugeridaTentativa !== null) return 0;
      const sug = sugerencias.get(r.id);
      if (sug === null || sug === undefined) return 2;
      return 1;
    }
    return [...filasFiltradas].sort((a, b) => {
      const gA = grupo(a);
      const gB = grupo(b);
      if (gA !== gB) return gA - gB;
      if (a.prioridadAtraso !== b.prioridadAtraso)
        return a.prioridadAtraso === 'normal' ? -1 : 1;
      return b.diasAtraso - a.diasAtraso;
    });
  }, [filasFiltradas, sugerencias]);

  const conTentativa = useMemo(
    () => rows.filter((r) => r.fechaSugeridaTentativa !== null),
    [rows],
  );
  const sinViabilidad = useMemo(
    () =>
      rows.filter(
        (r) => r.fechaSugeridaTentativa === null && sugerencias.get(r.id) === null,
      ),
    [rows, sugerencias],
  );
  const totalAtrasados = rows.filter((r) => r.fechaPago < hoyISO).length;

  const visiblesIds = useMemo(
    () => filasOrdenadas.map((r) => r.id),
    [filasOrdenadas],
  );

  function toggleSeleccion(id: number) {
    const next = new Set(seleccionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSeleccionados(next);
  }

  function seleccionarTodasVisibles() {
    const allSelected = visiblesIds.every((id) => seleccionados.has(id));
    if (allSelected) {
      const next = new Set(seleccionados);
      for (const id of visiblesIds) next.delete(id);
      setSeleccionados(next);
    } else {
      setSeleccionados(new Set([...seleccionados, ...visiblesIds]));
    }
  }

  function onCambiarPrioridad(id: number, prio: PrioridadAtraso) {
    startTransition(async () => {
      const res = await cambiarPrioridad(id, prio);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // El cambio de prioridad puede afectar el orden de sugerencias —
      // recalcular.
      void recalcular();
    });
  }

  function onColocarSeleccionadas() {
    const pares = Array.from(seleccionados)
      .map((id) => ({ id, fechaSugerida: sugerencias.get(id) ?? null }))
      .filter(
        (p): p is { id: number; fechaSugerida: string } =>
          p.fechaSugerida !== null,
      );

    if (pares.length === 0) {
      toast.error('No hay seleccionadas con sugerencia viable');
      return;
    }

    startTransition(async () => {
      const res = await aplicarTentativas(pares);
      if (res.ok) {
        toast.success(`${pares.length} tentativas aplicadas`);
        setSeleccionados(new Set());
      } else {
        toast.error(res.error);
      }
    });
  }

  function onConfirmar(ids: number[]) {
    startTransition(async () => {
      const res = await confirmarTentativas(ids);
      if (res.ok) {
        toast.success('Tentativas confirmadas');
        setSeleccionados(new Set());
      } else {
        toast.error(res.error);
      }
    });
  }

  function onCancelar(ids: number[]) {
    startTransition(async () => {
      const res = await cancelarTentativas(ids);
      if (res.ok) {
        toast.success('Tentativas canceladas');
        setSeleccionados(new Set());
      } else {
        toast.error(res.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Check className="h-10 w-10 mx-auto text-success mb-2" />
          <p className="text-sm font-medium">No tenés pagos atrasados.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cuando una erogación pendiente vence sin pagarse, aparece acá.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Atrasados
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {totalAtrasados}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Con tentativa
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1 text-info">
              {conTentativa.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Sin viabilidad
            </p>
            <p
              className={cn(
                'text-2xl font-semibold tabular-nums mt-1',
                sinViabilidad.length > 0 && 'text-danger',
              )}
            >
              {sinViabilidad.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <label
              htmlFor="colchon"
              className="text-xs text-muted-foreground uppercase tracking-wide block"
            >
              Colchón mínimo
            </label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                id="colchon"
                inputMode="numeric"
                value={colchonStr}
                onChange={(e) => setColchonStr(e.target.value)}
                onBlur={() => void recalcular()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 text-sm font-medium tabular-nums"
                aria-label="Colchón mínimo en pesos"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void recalcular()}
                disabled={calculando}
                aria-label="Recalcular sugerencias"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', calculando && 'animate-spin')}
                />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Prioridad:
            </span>
            <select
              value={filtroPrioridad}
              onChange={(e) =>
                setFiltroPrioridad(
                  e.target.value as 'todas' | PrioridadAtraso,
                )
              }
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'appearance-none pr-7 cursor-pointer',
              )}
              aria-label="Filtrar por prioridad"
            >
              <option value="todas">Todas</option>
              <option value="normal">Solo normales</option>
              <option value="laxo">Solo laxos</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={onColocarSeleccionadas}
              disabled={pending || seleccionados.size === 0}
            >
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              Colocar seleccionadas en fecha sugerida ({seleccionados.size})
            </Button>
            {conTentativa.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onConfirmar([])}
                  disabled={pending}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Confirmar todas ({conTentativa.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCancelar([])}
                  disabled={pending}
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Cancelar todas
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las visibles"
                    checked={
                      visiblesIds.length > 0 &&
                      visiblesIds.every((id) => seleccionados.has(id))
                    }
                    onChange={seleccionarTodasVisibles}
                  />
                </th>
                <th className="px-3 py-2">Días</th>
                <th className="px-3 py-2">Fecha original</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Banco</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Prioridad</th>
                <th className="px-3 py-2">Fecha sugerida</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filasOrdenadas.map((r) => {
                const tieneTentativa = r.fechaSugeridaTentativa !== null;
                const sug = sugerencias.get(r.id);
                const sinSugerencia = !tieneTentativa && sug === null;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-t hover:bg-muted/20',
                      tieneTentativa && 'bg-info/5',
                      sinSugerencia && 'bg-danger/5',
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${r.descripcion}`}
                        checked={seleccionados.has(r.id)}
                        onChange={() => toggleSeleccion(r.id)}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.diasAtraso > 0 ? (
                        <span
                          className={cn(
                            'text-xs font-medium',
                            r.diasAtraso > 30 && 'text-danger',
                            r.diasAtraso > 7 &&
                              r.diasAtraso <= 30 &&
                              'text-warning',
                          )}
                        >
                          {r.diasAtraso}d
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap text-xs">
                      {fmtFechaAR(r.fechaPago)}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.empresaNombre}</td>
                    <td className="px-3 py-2 text-xs">{r.bancoNombre}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate max-w-[260px]">
                          {r.descripcion}
                        </span>
                        {r.esCritico && (
                          <Badge
                            variant="outline"
                            className="text-[9px] bg-danger/10 border-danger/30 text-danger"
                          >
                            crítico
                          </Badge>
                        )}
                      </div>
                      {r.proveedorNombre && (
                        <p className="text-[10px] text-muted-foreground truncate max-w-[260px]">
                          {r.proveedorNombre}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {fmtMonto(r.monto)}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.prioridadAtraso}
                        onChange={(e) =>
                          onCambiarPrioridad(
                            r.id,
                            e.target.value as PrioridadAtraso,
                          )
                        }
                        disabled={pending || tieneTentativa}
                        className={cn(
                          buttonVariants({
                            variant:
                              r.prioridadAtraso === 'normal'
                                ? 'default'
                                : 'outline',
                            size: 'sm',
                          }),
                          'appearance-none pr-7 cursor-pointer text-xs',
                          tieneTentativa && 'opacity-60 cursor-not-allowed',
                        )}
                        aria-label="Cambiar prioridad"
                      >
                        <option value="normal">{PRIORIDAD_LABELS.normal}</option>
                        <option value="laxo">{PRIORIDAD_LABELS.laxo}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap text-xs">
                      {tieneTentativa ? (
                        <Badge
                          variant="outline"
                          className="bg-info/10 border-info/30 text-info"
                        >
                          Tentativa: {fmtFechaAR(r.fechaSugeridaTentativa!)}
                        </Badge>
                      ) : sug === null ? (
                        <Badge
                          variant="outline"
                          className="bg-danger/10 border-danger/30 text-danger"
                        >
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Sin viabilidad
                        </Badge>
                      ) : sug ? (
                        <span className="text-success">{fmtFechaAR(sug)}</span>
                      ) : (
                        <span className="text-muted-foreground">…</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {tieneTentativa ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onConfirmar([r.id])}
                            disabled={pending}
                            aria-label="Confirmar tentativa"
                            title="Confirmar tentativa"
                            className="h-7 w-7 p-0 text-success"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onCancelar([r.id])}
                            disabled={pending}
                            aria-label="Cancelar tentativa"
                            title="Cancelar tentativa"
                            className="h-7 w-7 p-0 text-muted-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filasOrdenadas.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No hay filas con ese filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Actualizando…
        </div>
      )}

      {conTentativa.length > 0 && (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              Tenés {conTentativa.length} tentativa(s) activa(s).
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Antes de confirmar, revisá cómo impactan en{' '}
              <Link
                href="/proyeccion"
                className="text-primary hover:underline"
              >
                Proyección de saldo
              </Link>{' '}
              y{' '}
              <Link
                href="/calendario"
                className="text-primary hover:underline"
              >
                Calendario de caja
              </Link>
              . Las tentativas se ven en azul punteado.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
