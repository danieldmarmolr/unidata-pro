'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  Clock,
  Handshake,
  Minimize2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useRouter } from 'next/navigation';
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
import { fmtFechaAR, fmtMonto } from '../../(app)/erogaciones/utils';
import { cn } from '@/lib/utils';

type Data = {
  saldoInicial: number;
  tieneSaldoInicial: boolean;
  resumenProy: {
    saldoInicial: number;
    saldoFinal: number;
    cambioTotal: number;
    diasEstrenimiento: number;
    primerDiaEstrenimiento: { fechaISO: string; saldo: number } | null;
    peorSaldo: { fechaISO: string; saldo: number };
    mejorSaldo: { fechaISO: string; saldo: number };
  };
  diasProyectados: Array<{ fechaISO: string; saldo: number; esEstrenimiento: boolean }>;
  pendienteTotal: number;
  atrasadasMonto: number;
  atrasadasCantidad: number;
  criticosProximos: Array<{
    id: number;
    fechaPago: string;
    descripcion: string;
    monto: string;
    proveedorNombre: string | null;
  }>;
  acuerdosVencidos: Array<{
    id: number;
    proveedorNombre: string;
    compromiso: string;
    fechaCompromiso: string | null;
  }>;
  fecha: string;
};

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export function PresentacionClient({ data }: { data: Data }) {
  const router = useRouter();

  useHotkeys('esc', () => router.push('/'), { enableOnFormTags: true });

  const chartData = useMemo(
    () =>
      data.diasProyectados.map((d) => ({
        ...d,
        fechaCorta: format(parseISO(d.fechaISO), 'd MMM', { locale: es }),
      })),
    [data.diasProyectados],
  );

  const hayAtasco = data.resumenProy.diasEstrenimiento > 0;
  const hayAlerta = hayAtasco || data.atrasadasCantidad > 0 || data.acuerdosVencidos.length > 0;

  return (
    <div className="min-h-screen p-10 lg:p-14">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Flujo de fondos · Modo presentacion
          </p>
          <h1 className="text-5xl font-semibold tracking-tight capitalize">
            {data.fecha}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground hidden sm:block">
            Pulsa <kbd className="px-2 py-1 rounded border bg-muted text-foreground">Esc</kbd>{' '}
            para salir
          </p>
          <Link
            href="/"
            className="h-10 w-10 inline-flex items-center justify-center rounded-md border hover:bg-muted transition-colors"
            aria-label="Salir del modo presentacion"
          >
            <Minimize2 className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Alertas top si hay */}
      {hayAlerta && (
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-3 mb-8">
          {hayAtasco && data.resumenProy.primerDiaEstrenimiento && (
            <div className="rounded-xl border-2 border-danger/50 bg-danger/5 p-5">
              <p className="text-xs uppercase tracking-widest text-danger font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Atasco previsto
              </p>
              <p className="text-2xl font-bold mt-2 capitalize">
                {format(
                  parseISO(data.resumenProy.primerDiaEstrenimiento.fechaISO),
                  "EEE d 'de' MMM",
                  { locale: es },
                )}
              </p>
              <p className="text-3xl font-bold tabular-nums text-danger mt-1">
                {fmtMonto(data.resumenProy.primerDiaEstrenimiento.saldo)}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {data.resumenProy.diasEstrenimiento} dias en rojo en los proximos 30
              </p>
            </div>
          )}
          {data.atrasadasCantidad > 0 && (
            <div className="rounded-xl border-2 border-danger/50 bg-danger/5 p-5">
              <p className="text-xs uppercase tracking-widest text-danger font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" /> Pagos atrasados
              </p>
              <p className="text-3xl font-bold tabular-nums text-danger mt-2">
                {fmtMonto(data.atrasadasMonto)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {data.atrasadasCantidad}{' '}
                {data.atrasadasCantidad === 1 ? 'pago vencido' : 'pagos vencidos'}
              </p>
            </div>
          )}
          {data.acuerdosVencidos.length > 0 && (
            <div className="rounded-xl border-2 border-warning/50 bg-warning/5 p-5">
              <p className="text-xs uppercase tracking-widest text-warning font-medium flex items-center gap-2">
                <Handshake className="h-4 w-4" /> Promesas vencidas
              </p>
              <p className="text-3xl font-bold tabular-nums text-warning mt-2">
                {data.acuerdosVencidos.length}
              </p>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                Mas reciente: {data.acuerdosVencidos[0].proveedorNombre}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Stats principales */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="rounded-xl border bg-card p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5" /> Saldo actual
          </p>
          <p className="text-4xl font-bold tabular-nums mt-3">
            {data.tieneSaldoInicial ? fmtMonto(data.saldoInicial) : '—'}
          </p>
          {!data.tieneSaldoInicial && (
            <p className="text-xs text-muted-foreground mt-1">Sin saldo cargado</p>
          )}
        </div>
        <div
          className={cn(
            'rounded-xl border bg-card p-6',
            data.resumenProy.saldoFinal < 0 && 'border-danger/40 bg-danger/5',
            data.resumenProy.saldoFinal > data.saldoInicial && 'border-success/40 bg-success/5',
          )}
        >
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium flex items-center gap-2">
            {data.resumenProy.cambioTotal >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-success" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-danger" />
            )}
            Proyectado a 30 dias
          </p>
          <p
            className={cn(
              'text-4xl font-bold tabular-nums mt-3',
              data.resumenProy.saldoFinal < 0 && 'text-danger',
            )}
          >
            {data.tieneSaldoInicial ? fmtMonto(data.resumenProy.saldoFinal) : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {data.resumenProy.cambioTotal >= 0 ? '+' : ''}
            {data.tieneSaldoInicial ? fmtMonto(data.resumenProy.cambioTotal) : '—'} vs hoy
          </p>
        </div>
        <div className="rounded-xl border bg-card p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            Pendiente total
          </p>
          <p className="text-4xl font-bold tabular-nums mt-3">
            {fmtMonto(data.pendienteTotal)}
          </p>
        </div>
        <div
          className={cn(
            'rounded-xl border bg-card p-6',
            data.resumenProy.peorSaldo.saldo < 0 && 'border-danger/40 bg-danger/5',
          )}
        >
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium flex items-center gap-2">
            <TrendingDown className="h-3.5 w-3.5" /> Peor momento (30d)
          </p>
          <p
            className={cn(
              'text-4xl font-bold tabular-nums mt-3',
              data.resumenProy.peorSaldo.saldo < 0 && 'text-danger',
            )}
          >
            {data.tieneSaldoInicial ? fmtMonto(data.resumenProy.peorSaldo.saldo) : '—'}
          </p>
          {data.tieneSaldoInicial && data.resumenProy.peorSaldo.fechaISO && (
            <p className="text-xs text-muted-foreground mt-1">
              {format(parseISO(data.resumenProy.peorSaldo.fechaISO), 'd MMM', { locale: es })}
            </p>
          )}
        </div>
      </div>

      {/* Grafico saldo proyectado */}
      {data.tieneSaldoInicial && data.diasProyectados.length > 0 && (
        <div className="rounded-xl border bg-card p-6 mb-8">
          <p className="text-sm font-medium mb-4 uppercase tracking-widest text-muted-foreground">
            Curva de saldo proyectado (30 dias)
          </p>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradPres" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="fechaCorta"
                  fontSize={12}
                  tick={{ fill: 'oklch(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'oklch(var(--border))' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  fontSize={12}
                  tick={{ fill: 'oklch(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtCorto}
                  width={70}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: 'oklch(var(--popover))',
                    border: '1px solid oklch(var(--border))',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v) => fmtMonto(Number(v))}
                />
                <ReferenceLine
                  y={0}
                  stroke="oklch(var(--danger))"
                  strokeDasharray="4 4"
                />
                <Area
                  type="monotone"
                  dataKey="saldo"
                  stroke="oklch(var(--primary))"
                  strokeWidth={3}
                  fill="url(#gradPres)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Pagos críticos próximos */}
      {data.criticosProximos.length > 0 && (
        <div className="rounded-xl border bg-card p-6 mb-8">
          <p className="text-sm font-medium mb-4 uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            Pagos criticos en los proximos 7 dias
          </p>
          <div className="space-y-2">
            {data.criticosProximos.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card"
              >
                <div className="min-w-0">
                  <p className="font-medium text-base truncate">{e.descripcion}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtFechaAR(e.fechaPago)}
                    {e.proveedorNombre && ` · ${e.proveedorNombre}`}
                  </p>
                </div>
                <p className="text-xl font-bold tabular-nums shrink-0">
                  {fmtMonto(e.monto)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground mt-12">
        Modo presentacion · Solo lectura · Para editar volve al{' '}
        <Link href="/" className="text-primary hover:underline">
          tablero principal
        </Link>
      </p>
    </div>
  );
}
