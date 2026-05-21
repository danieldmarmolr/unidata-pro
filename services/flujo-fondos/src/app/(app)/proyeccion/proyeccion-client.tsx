'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Download,
  Info,
  Pencil,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fmtMonto, fmtFechaAR } from '../erogaciones/utils';
import type { DiaProyectado, ResumenProyeccion } from './calcular';
import { HORIZONTES_VALIDOS, type ProyeccionFiltros } from './schema';

type Props = {
  dias: DiaProyectado[];
  resumen: ResumenProyeccion;
  saldoAuto: number;
  porBanco: { bancoId: number; bancoNombre: string; saldo: number; fecha: string }[];
  unidadesCount: number;
  erogacionesCount: number;
  filtros: ProyeccionFiltros;
  hoyISO: string;
  finISO: string;
  finLabel: string;
};

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function descargarProyeccionCSV(
  dias: DiaProyectado[],
  saldoInicial: number,
  hoyISO: string,
) {
  const headers = [
    'Fecha',
    'Dia de la semana',
    'Saldo apertura',
    'Ingreso proyectado total',
    'Ingreso puntual',
    'Egreso comprometido',
    'Cant. erogaciones',
    'Cant. ingresos puntuales',
    'Saldo cierre',
    'Estado (bajo umbral)',
  ];
  const lines = [headers.map(escapeCSV).join(',')];
  // Fila previa de "saldo inicial" para que el CSV cierre el contexto
  lines.push(
    [
      hoyISO,
      'Saldo inicial',
      '',
      '',
      '',
      '',
      '',
      '',
      saldoInicial.toFixed(2),
      '',
    ]
      .map(escapeCSV)
      .join(','),
  );
  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  for (const d of dias) {
    const fecha = parseISO(d.fechaISO);
    const dow = diasSemana[fecha.getDay()];
    lines.push(
      [
        d.fechaISO,
        dow,
        d.saldoApertura.toFixed(2),
        d.ingresoProyectado.toFixed(2),
        d.ingresoPuntual.toFixed(2),
        d.egresoComprometido.toFixed(2),
        d.cantidadErogaciones,
        d.cantidadIngresosPuntuales,
        d.saldoAperturaCierre.toFixed(2),
        d.esEstrenimiento ? 'bajo umbral' : 'ok',
      ]
        .map(escapeCSV)
        .join(','),
    );
  }
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `proyeccion-${hoyISO}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ProyeccionClient({
  dias,
  resumen,
  saldoAuto,
  porBanco,
  unidadesCount,
  erogacionesCount,
  filtros,
  hoyISO,
  finLabel,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [editandoSaldo, setEditandoSaldo] = useState(false);
  const [editandoUmbral, setEditandoUmbral] = useState(false);
  const [saldoDraft, setSaldoDraft] = useState(
    filtros.saldoManual !== undefined ? String(filtros.saldoManual) : '',
  );
  const [umbralDraft, setUmbralDraft] = useState(String(filtros.umbral));

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    });
    startTransition(() => {
      router.replace(`/proyeccion?${params.toString()}`);
    });
  }

  function aplicarSaldoManual() {
    const n = Number(saldoDraft);
    if (!Number.isFinite(n)) return;
    setEditandoSaldo(false);
    setQuery({ saldoManual: String(n) });
  }

  function limpiarSaldoManual() {
    setEditandoSaldo(false);
    setSaldoDraft('');
    setQuery({ saldoManual: null });
  }

  function aplicarUmbral() {
    const n = Number(umbralDraft);
    if (!Number.isFinite(n)) return;
    setEditandoUmbral(false);
    setQuery({ umbral: String(n) });
  }

  const chartData = useMemo(
    () =>
      dias.map((d) => ({
        fecha: d.fechaISO,
        fechaCorta: format(parseISO(d.fechaISO), 'd MMM', { locale: es }),
        saldo: d.saldoAperturaCierre,
        ingreso: d.ingresoProyectado,
        egreso: d.egresoComprometido,
        esEstrenimiento: d.esEstrenimiento,
      })),
    [dias],
  );

  if (porBanco.length === 0 && filtros.saldoManual === undefined) {
    return (
      <div className="space-y-4">
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">No hay saldo inicial registrado</p>
                <p className="text-sm text-muted-foreground">
                  Para proyectar el saldo necesitamos un punto de partida. Cargá un saldo
                  inicial por banco (lo recomendado) o ingresá un saldo manual aca abajo
                  para empezar a ver la proyeccion.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Input
                type="number"
                placeholder="Saldo inicial manual (ARS)"
                value={saldoDraft}
                onChange={(e) => setSaldoDraft(e.target.value)}
                className="max-w-xs"
              />
              <button
                type="button"
                onClick={aplicarSaldoManual}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
              >
                Usar este saldo
              </button>
              <Link
                href="/saldos"
                className="text-sm text-primary hover:underline ml-2"
              >
                o cargar saldos por banco →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alerta de estreñimiento */}
      {resumen.primerDiaEstrenimiento && (
        <Card className="border-danger/40 bg-danger/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-danger">
                Estrenimiento del flujo detectado
              </p>
              <p className="text-sm mt-0.5">
                Primer dia critico:{' '}
                <span className="font-semibold capitalize">
                  {format(parseISO(resumen.primerDiaEstrenimiento.fechaISO), "EEEE d 'de' MMMM", { locale: es })}
                </span>{' '}
                con saldo proyectado de{' '}
                <span className="font-semibold tabular-nums">
                  {fmtMonto(resumen.primerDiaEstrenimiento.saldo)}
                </span>
                . En total hay{' '}
                <span className="font-semibold">{resumen.diasEstrenimiento}</span>{' '}
                {resumen.diasEstrenimiento === 1 ? 'dia' : 'dias'} bajo el umbral en el
                horizonte.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Saldo inicial
            </p>
            <p className="text-xl font-semibold mt-1 tabular-nums">
              {fmtMonto(resumen.saldoInicial)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {filtros.saldoManual !== undefined
                ? 'manual'
                : `auto (${porBanco.length} ${porBanco.length === 1 ? 'banco' : 'bancos'})`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Saldo proyectado al {finLabel}
            </p>
            <p
              className={cn(
                'text-xl font-semibold mt-1 tabular-nums',
                resumen.saldoFinal < filtros.umbral && 'text-danger',
                resumen.saldoFinal >= filtros.umbral &&
                  resumen.saldoFinal > resumen.saldoInicial &&
                  'text-success',
              )}
            >
              {fmtMonto(resumen.saldoFinal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
              {resumen.cambioTotal >= 0 ? (
                <ArrowUpCircle className="h-3 w-3 text-success" />
              ) : (
                <ArrowDownCircle className="h-3 w-3 text-danger" />
              )}
              {fmtMonto(resumen.cambioTotal)} vs inicial
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            resumen.peorSaldo.saldo < filtros.umbral && 'border-danger/40 bg-danger/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3" /> Peor momento
            </p>
            <p
              className={cn(
                'text-xl font-semibold mt-1 tabular-nums',
                resumen.peorSaldo.saldo < filtros.umbral && 'text-danger',
              )}
            >
              {fmtMonto(resumen.peorSaldo.saldo)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {resumen.peorSaldo.fechaISO
                ? format(parseISO(resumen.peorSaldo.fechaISO), 'd MMM', { locale: es })
                : ''}
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            resumen.diasEstrenimiento > 0 && 'border-warning/40 bg-warning/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> Dias en rojo
            </p>
            <p
              className={cn(
                'text-xl font-semibold mt-1 tabular-nums',
                resumen.diasEstrenimiento > 0 && 'text-warning',
              )}
            >
              {resumen.diasEstrenimiento}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              umbral: {fmtMonto(filtros.umbral)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-4 p-4 rounded-lg border bg-card">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Horizonte
          </label>
          <div className="flex rounded-md border overflow-hidden">
            {HORIZONTES_VALIDOS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setQuery({ horizonte: String(h) })}
                disabled={isPending}
                className={cn(
                  'px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors',
                  filtros.horizonte === h
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Umbral de estrenimiento
          </label>
          {editandoUmbral ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                value={umbralDraft}
                onChange={(e) => setUmbralDraft(e.target.value)}
                className="w-32 h-8"
                autoFocus
              />
              <button
                type="button"
                onClick={aplicarUmbral}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs"
              >
                Aplicar
              </button>
              <button
                type="button"
                onClick={() => {
                  setUmbralDraft(String(filtros.umbral));
                  setEditandoUmbral(false);
                }}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditandoUmbral(true)}
              className="h-8 px-3 inline-flex items-center gap-2 rounded-md border hover:bg-muted text-sm tabular-nums"
            >
              {fmtMonto(filtros.umbral)}
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Saldo inicial
          </label>
          {editandoSaldo ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                value={saldoDraft}
                onChange={(e) => setSaldoDraft(e.target.value)}
                placeholder={String(saldoAuto)}
                className="w-40 h-8"
                autoFocus
              />
              <button
                type="button"
                onClick={aplicarSaldoManual}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs"
              >
                Aplicar
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaldoDraft('');
                  setEditandoSaldo(false);
                }}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditandoSaldo(true)}
                className="h-8 px-3 inline-flex items-center gap-2 rounded-md border hover:bg-muted text-sm tabular-nums"
              >
                {fmtMonto(resumen.saldoInicial)}
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
              {filtros.saldoManual !== undefined && (
                <button
                  type="button"
                  onClick={limpiarSaldoManual}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  volver al automatico
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto text-xs text-muted-foreground space-y-0.5 text-right">
          <p>
            Datos: <span className="font-medium">{unidadesCount}</span> unidades,{' '}
            <span className="font-medium">{erogacionesCount}</span> erogaciones en el
            horizonte
          </p>
          <p>
            Desde {fmtFechaAR(hoyISO)} hasta {finLabel}
          </p>
        </div>
      </div>

      {/* Gráfico */}
      <Card>
        <CardContent className="p-4">
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradPositivo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(var(--success))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="oklch(var(--success))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="fechaCorta"
                  fontSize={11}
                  tick={{ fill: 'oklch(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'oklch(var(--border))' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: 'oklch(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtCorto}
                  width={60}
                />
                <RechartsTooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: 'oklch(var(--primary))', strokeDasharray: '3 3' }}
                />
                <ReferenceLine
                  y={filtros.umbral}
                  stroke="oklch(var(--danger))"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Umbral ${fmtCorto(filtros.umbral)}`,
                    position: 'insideBottomRight',
                    fontSize: 10,
                    fill: 'oklch(var(--danger))',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="saldo"
                  stroke="oklch(var(--primary))"
                  strokeWidth={2}
                  fill="url(#gradPositivo)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Detalle de bancos */}
      {porBanco.length > 0 && filtros.saldoManual === undefined && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Composicion del saldo inicial
            </p>
            <div className="space-y-1.5">
              {porBanco.map((b) => (
                <div
                  key={b.bancoId}
                  className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0"
                >
                  <div>
                    <span className="font-medium">{b.bancoNombre}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      al {fmtFechaAR(b.fecha)}
                    </span>
                  </div>
                  <span className="tabular-nums">{fmtMonto(b.saldo)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla detalle */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Detalle dia por dia</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              descargarProyeccionCSV(dias, resumen.saldoInicial, hoyISO)
            }
            aria-label="Descargar detalle de la proyeccion como CSV"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Descargar CSV
          </Button>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Fecha
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Ingresos
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Egresos
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Saldo al cierre
                </th>
                <th className="text-center px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr
                  key={d.fechaISO}
                  className={cn(
                    'border-t',
                    d.esEstrenimiento && 'bg-danger/5',
                  )}
                >
                  <td className="px-4 py-2">
                    <span className="capitalize">
                      {format(parseISO(d.fechaISO), 'EEE d MMM', { locale: es })}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {d.ingresoProyectado > 0 ? (
                      <span className="text-success">+{fmtMonto(d.ingresoProyectado)}</span>
                    ) : (
                      <span className="text-muted-foreground/50">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {d.egresoComprometido > 0 ? (
                      <span className="text-danger">
                        -{fmtMonto(d.egresoComprometido)}
                        {d.cantidadErogaciones > 0 && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({d.cantidadErogaciones})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">-</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right tabular-nums font-medium',
                      d.esEstrenimiento && 'text-danger',
                    )}
                  >
                    {fmtMonto(d.saldoAperturaCierre)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {d.esEstrenimiento ? (
                      <Badge variant="outline" className="bg-danger/10 text-danger border-danger/30 text-[10px]">
                        bajo umbral
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">ok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Notas */}
      <Card>
        <CardContent className="p-4 text-sm space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground flex items-center gap-2">
            <Info className="h-4 w-4" />
            Cómo se calcula
          </p>
          <p>
            <strong className="text-foreground">Saldo inicial:</strong> ultimo registro
            de cada banco en saldos_iniciales con fecha ≤ hoy, sumados. Si pones un saldo
            manual, eso sobrescribe el calculado.
          </p>
          <p>
            <strong className="text-foreground">Ingresos proyectados:</strong> aplicacion
            del promedio ponderado por dia de semana de cada unidad de negocio. Si no hay
            datos historicos suficientes, el dia proyecta 0.
          </p>
          <p>
            <strong className="text-foreground">Egresos comprometidos:</strong>{' '}
            erogaciones del horizonte excluyendo canceladas y rechazadas.
          </p>
          <p>
            <strong className="text-foreground">Estrenimiento:</strong> dia donde el
            saldo al cierre cae bajo el umbral configurado. Default = 0 (saldo
            negativo).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type TooltipPayload = {
  payload: {
    fecha: string;
    fechaCorta: string;
    saldo: number;
    ingreso: number;
    egreso: number;
    esEstrenimiento: boolean;
  };
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-1">
      <p className="font-medium capitalize">
        {format(parseISO(d.fecha), "EEEE d 'de' MMMM", { locale: es })}
      </p>
      <div className="space-y-0.5">
        {d.ingreso > 0 && (
          <p className="text-success tabular-nums">+ {fmtMonto(d.ingreso)}</p>
        )}
        {d.egreso > 0 && (
          <p className="text-danger tabular-nums">- {fmtMonto(d.egreso)}</p>
        )}
        <p
          className={cn(
            'font-semibold tabular-nums pt-1 border-t',
            d.esEstrenimiento && 'text-danger',
          )}
        >
          Saldo: {fmtMonto(d.saldo)}
        </p>
      </div>
    </div>
  );
}
