'use client';

import { addMonths, format, parseISO, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Flame,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { fmtMonto } from '../erogaciones/utils';
import { ESTADO_LABELS, type EstadoErogacion } from '../erogaciones/schema';
import { ESTADO_PILL_CLASS } from '../erogaciones/utils';
import type { DiaCalendario, ResumenMes } from './calcular';

type Empresa = { id: number; nombre: string };
type Unidad = { id: number; nombre: string };

type Props = {
  dias: DiaCalendario[];
  resumen: ResumenMes;
  mesActualISO: string; // YYYY-MM
  empresas: Empresa[];
  unidades: Unidad[];
  filtros: { mes?: string; empresa?: number };
  saldoPorFecha: Record<string, number>;
  saldoInicial: number;
  saldoDisponible: boolean;
};

const DOW_HEADER = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

function intensidadColor(
  neto: number,
  maxAbs: number,
  esMesActual: boolean,
): string {
  if (!esMesActual) return 'bg-muted/20 text-muted-foreground/60';
  if (maxAbs === 0 || neto === 0) return 'bg-card';
  const pct = Math.min(Math.abs(neto) / maxAbs, 1);
  if (neto > 0) {
    if (pct > 0.6) return 'bg-success/25';
    if (pct > 0.3) return 'bg-success/15';
    return 'bg-success/5';
  }
  if (pct > 0.6) return 'bg-danger/25';
  if (pct > 0.3) return 'bg-danger/15';
  return 'bg-danger/5';
}

export function CalendarioClient({
  dias,
  resumen,
  mesActualISO,
  empresas,
  unidades,
  filtros,
  saldoPorFecha,
  saldoDisponible,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [diaSeleccionado, setDiaSeleccionado] = useState<DiaCalendario | null>(null);

  const mesActualDate = parseISO(`${mesActualISO}-01`);
  const mesLabel = format(mesActualDate, "MMMM 'de' yyyy", { locale: es });

  const maxAbs = useMemo(() => {
    let m = 0;
    for (const d of dias) {
      if (!d.esMesActual) continue;
      const abs = Math.abs(d.neto);
      if (abs > m) m = abs;
    }
    return m;
  }, [dias]);

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    });
    startTransition(() => {
      router.replace(`/calendario?${params.toString()}`);
    });
  }

  function irMes(delta: number) {
    const nuevo = delta < 0 ? subMonths(mesActualDate, -delta) : addMonths(mesActualDate, delta);
    setQuery({ mes: format(nuevo, 'yyyy-MM') });
  }

  function irHoy() {
    setQuery({ mes: null });
  }

  // Agrupar dias en semanas (chunks de 7)
  const semanas: DiaCalendario[][] = [];
  for (let i = 0; i < dias.length; i += 7) {
    semanas.push(dias.slice(i, i + 7));
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Ingresos proyectados
            </p>
            <p className="text-xl font-semibold mt-1 tabular-nums">
              {fmtMonto(resumen.ingresoTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">total del mes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3" /> Egresos comprometidos
            </p>
            <p className="text-xl font-semibold mt-1 tabular-nums">
              {fmtMonto(resumen.egresoTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              erogaciones del mes (activas)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Neto
            </p>
            <p
              className={cn(
                'text-xl font-semibold mt-1 tabular-nums',
                resumen.netoTotal < 0 && 'text-danger',
                resumen.netoTotal > 0 && 'text-success',
              )}
            >
              {fmtMonto(resumen.netoTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              ingresos - egresos
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            resumen.diasNegativos > 0 && 'border-warning/40 bg-warning/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> Dias en rojo
            </p>
            <p
              className={cn(
                'text-xl font-semibold mt-1 tabular-nums',
                resumen.diasNegativos > 0 && 'text-warning',
              )}
            >
              {resumen.diasNegativos}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {resumen.peorDia
                ? `peor: ${format(parseISO(resumen.peorDia.fechaISO), 'd MMM', { locale: es })} (${fmtMonto(resumen.peorDia.neto)})`
                : 'sin dias negativos'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => irMes(-1)}
            disabled={isPending}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border hover:bg-muted transition-colors"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => irMes(1)}
            disabled={isPending}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border hover:bg-muted transition-colors"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={irHoy}
            disabled={isPending}
            className="ml-1 h-8 px-3 inline-flex items-center justify-center rounded-md border hover:bg-muted transition-colors text-sm"
          >
            Hoy
          </button>
        </div>
        <h2 className="text-base font-semibold capitalize">{mesLabel}</h2>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtrar por empresa:</span>
          <Select
            value={filtros.empresa ? String(filtros.empresa) : 'todas'}
            onValueChange={(v) =>
              v && setQuery({ empresa: v === 'todas' ? null : String(v) })
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las empresas</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grilla calendario */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {DOW_HEADER.map((d) => (
            <div
              key={d}
              className="text-center py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="divide-y">
          {semanas.map((semana, i) => (
            <div key={i} className="grid grid-cols-7 divide-x">
              {semana.map((dia) => {
                const fondoClase = intensidadColor(
                  dia.neto,
                  maxAbs,
                  dia.esMesActual,
                );
                const tieneCritico = dia.erogaciones.some((e) => e.esCritico);
                const tieneTentativa = dia.erogaciones.some((e) => e.esTentativa);
                const esPeor =
                  resumen.peorDia?.fechaISO === dia.fechaISO &&
                  dia.neto < 0 &&
                  dia.esMesActual;
                return (
                  <button
                    type="button"
                    key={dia.fechaISO}
                    onClick={() => setDiaSeleccionado(dia)}
                    className={cn(
                      'min-h-[100px] p-2 text-left flex flex-col gap-1 transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset relative',
                      fondoClase,
                      dia.esHoy && 'ring-2 ring-primary ring-inset',
                      esPeor && 'ring-2 ring-danger ring-inset',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          !dia.esMesActual && 'text-muted-foreground/50',
                          dia.esHoy && 'text-primary',
                        )}
                      >
                        {dia.dia}
                      </span>
                      <div className="flex items-center gap-1">
                        {tieneTentativa && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-info ring-1 ring-info/40"
                            aria-label="contiene pagos en fecha tentativa"
                            title="contiene pagos en fecha tentativa"
                          />
                        )}
                        {tieneCritico && (
                          <Flame
                            className="h-3.5 w-3.5 text-danger"
                            aria-label="contiene erogaciones criticas"
                          />
                        )}
                      </div>
                    </div>

                    {dia.esMesActual && (dia.ingresoTotal > 0 || dia.cantidadErogaciones > 0) && (
                      <div className="space-y-0.5 mt-auto">
                        {dia.ingresoTotal > 0 && (
                          <p className="text-[10px] text-success tabular-nums truncate flex items-center gap-1">
                            + {fmtMonto(dia.ingresoTotal)}
                            {dia.ingresoPuntual > 0 && (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-info shrink-0"
                                aria-label="incluye ingreso puntual"
                                title={`incluye ${fmtMonto(dia.ingresoPuntual)} de ingreso puntual`}
                              />
                            )}
                          </p>
                        )}
                        {dia.egresoComprometido > 0 && (
                          <p className="text-[10px] text-danger tabular-nums truncate">
                            - {fmtMonto(dia.egresoComprometido)}
                          </p>
                        )}
                        <p
                          className={cn(
                            'text-xs font-semibold tabular-nums truncate',
                            dia.neto > 0 && 'text-success',
                            dia.neto < 0 && 'text-danger',
                          )}
                        >
                          {fmtMonto(dia.neto)}
                        </p>
                        {(dia.cantidadErogaciones > 0 ||
                          dia.cantidadIngresosPuntuales > 0) && (
                          <p className="text-[10px] text-muted-foreground">
                            {dia.cantidadErogaciones > 0 && (
                              <>
                                {dia.cantidadErogaciones}{' '}
                                {dia.cantidadErogaciones === 1 ? 'pago' : 'pagos'}
                              </>
                            )}
                            {dia.cantidadIngresosPuntuales > 0 && (
                              <>
                                {dia.cantidadErogaciones > 0 && ', '}
                                {dia.cantidadIngresosPuntuales}{' '}
                                {dia.cantidadIngresosPuntuales === 1
                                  ? 'ingreso'
                                  : 'ingresos'}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-success/25" /> Flujo positivo fuerte
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-success/10" /> Positivo leve
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-card border" /> Sin movimiento
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-danger/10" /> Negativo leve
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-danger/25" /> Flujo negativo fuerte
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Flame className="h-3 w-3 text-danger" /> contiene erogacion critica
        </span>
      </div>

      {/* Sheet detalle del dia */}
      <Sheet
        open={diaSeleccionado !== null}
        onOpenChange={(open) => !open && setDiaSeleccionado(null)}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {diaSeleccionado && (
            <DiaDetalle
              dia={diaSeleccionado}
              empresas={empresas}
              unidades={unidades}
              saldoCierre={saldoPorFecha[diaSeleccionado.fechaISO]}
              saldoDisponible={saldoDisponible}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DiaDetalle({
  dia,
  empresas,
  unidades,
  saldoCierre,
  saldoDisponible,
}: {
  dia: DiaCalendario;
  empresas: Empresa[];
  unidades: Unidad[];
  saldoCierre: number | undefined;
  saldoDisponible: boolean;
}) {
  const fecha = parseISO(dia.fechaISO);
  const titulo = format(fecha, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
  const mostrarSaldo = saldoDisponible && saldoCierre !== undefined;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="capitalize">{titulo}</SheetTitle>
        <SheetDescription>
          Flujo neto:{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              dia.neto > 0 && 'text-success',
              dia.neto < 0 && 'text-danger',
            )}
          >
            {fmtMonto(dia.neto)}
          </span>
        </SheetDescription>
      </SheetHeader>

      {mostrarSaldo && (
        <div className="px-4 mt-2 mb-2">
          <div
            className={cn(
              'rounded-md border p-3 flex items-center justify-between',
              saldoCierre! < 0 ? 'border-danger/40 bg-danger/5' : 'border-info/30 bg-info/5',
            )}
          >
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Saldo proyectado al cierre
              </p>
              <p
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  saldoCierre! < 0 && 'text-danger',
                )}
              >
                {fmtMonto(saldoCierre!)}
              </p>
            </div>
            <Link
              href="/proyeccion"
              className="text-xs text-primary hover:underline"
            >
              Ver curva
            </Link>
          </div>
        </div>
      )}

      <div className="px-4 pb-6 space-y-6">
        {/* Ingresos proyectados */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-success" />
              Ingresos proyectados
            </h3>
            <span className="text-sm font-semibold text-success tabular-nums">
              {fmtMonto(dia.ingresoProyectado)}
            </span>
          </div>
          {dia.ingresosPorUnidad.filter((x) => x.monto > 0).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin proyeccion para este dia (sin datos historicos suficientes para el dia de
              semana).
            </p>
          ) : (
            <div className="space-y-1.5">
              {dia.ingresosPorUnidad
                .filter((x) => x.monto > 0)
                .map((x) => {
                  const u = unidades.find((y) => y.id === x.unidadNegocioId);
                  return (
                    <div
                      key={x.unidadNegocioId}
                      className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0"
                    >
                      <span className="text-muted-foreground">
                        {u?.nombre ?? `Unidad ${x.unidadNegocioId}`}
                      </span>
                      <span className="tabular-nums">{fmtMonto(x.monto)}</span>
                    </div>
                  );
                })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            Estimado segun promedio ponderado del dia de semana.
          </p>
        </section>

        {/* Ingresos puntuales */}
        {dia.ingresosPuntuales.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <ArrowDownToLine className="h-3.5 w-3.5 text-info" />
                Ingresos puntuales
              </h3>
              <span className="text-sm font-semibold text-info tabular-nums">
                {fmtMonto(dia.ingresoPuntual)}
              </span>
            </div>
            <div className="space-y-2">
              {dia.ingresosPuntuales.map((ip) => (
                <div
                  key={ip.id}
                  className="p-2.5 rounded-md border bg-info/5 border-info/30 space-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium line-clamp-1 flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-info shrink-0" />
                      {ip.descripcion}
                    </p>
                    <span className="text-sm tabular-nums text-info font-medium">
                      +{fmtMonto(ip.monto)}
                    </span>
                  </div>
                  {ip.categoria && (
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {ip.categoria.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 italic">
              Cobros de cheques, prestamos, devoluciones u otros ingresos extraordinarios.
            </p>
          </section>
        )}

        {/* Egresos comprometidos */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-danger" />
              Egresos comprometidos
            </h3>
            <span className="text-sm font-semibold text-danger tabular-nums">
              {fmtMonto(dia.egresoComprometido)}
            </span>
          </div>
          {dia.erogaciones.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin erogaciones cargadas.</p>
          ) : (
            <div className="space-y-2">
              {dia.erogaciones.map((er) => {
                const emp = empresas.find((e) => e.id === er.empresaId);
                return (
                  <Link
                    key={er.id}
                    href={`/erogaciones?q=${encodeURIComponent(er.descripcion)}`}
                    className="block p-2.5 rounded-md border hover:bg-muted/30 transition-colors space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium line-clamp-1 flex items-center gap-1.5">
                        {er.esCritico && (
                          <Flame className="h-3 w-3 text-danger shrink-0" />
                        )}
                        {er.descripcion}
                      </p>
                      <span className="text-sm tabular-nums shrink-0">
                        {fmtMonto(er.monto)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          ESTADO_PILL_CLASS[er.estado as EstadoErogacion],
                        )}
                      >
                        {ESTADO_LABELS[er.estado as EstadoErogacion] ?? er.estado}
                      </Badge>
                      {er.esTentativa && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-info/10 border-info/30 text-info border-dashed"
                          title={`Fecha original: ${er.fechaPagoOriginal}`}
                        >
                          Tentativa
                        </Badge>
                      )}
                      {emp && (
                        <span className="text-muted-foreground truncate">
                          {emp.nombre}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <Link
          href={`/erogaciones?desde=${dia.fechaISO}&hasta=${dia.fechaISO}`}
          className="block text-center text-sm text-primary hover:underline"
        >
          Ver erogaciones de este dia en el Inbox →
        </Link>
      </div>
    </>
  );
}
