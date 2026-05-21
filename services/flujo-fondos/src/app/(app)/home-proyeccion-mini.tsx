'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtMonto } from './erogaciones/utils';

type DiaProyeccion = {
  fechaISO: string;
  saldo: number;
  esEstrenimiento: boolean;
};

type Props = {
  dias: DiaProyeccion[];
  saldoInicial: number;
  saldoFinal: number;
  diasEstrenimiento: number;
  primerDiaCritico: { fechaISO: string; saldo: number } | null;
  tieneSaldoInicial: boolean;
};

export function HomeProyeccionMini({
  dias,
  saldoInicial,
  saldoFinal,
  diasEstrenimiento,
  primerDiaCritico,
  tieneSaldoInicial,
}: Props) {
  if (!tieneSaldoInicial) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Proyeccion 30 dias</CardTitle>
          </div>
          <CardDescription>Cargá un saldo inicial para empezar</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <p className="text-muted-foreground">
            Sin saldo inicial no podemos proyectar.
          </p>
          <Link
            href="/saldos"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Cargar saldo de hoy
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const hayAtasco = diasEstrenimiento > 0;
  const cambio = saldoFinal - saldoInicial;

  const chartData = dias.map((d) => ({
    fecha: d.fechaISO,
    saldo: d.saldo,
    esCritico: d.esEstrenimiento,
  }));

  return (
    <Card
      className={cn(
        hayAtasco ? 'border-danger/40 bg-danger/5' : 'border-success/30',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hayAtasco ? (
              <TrendingDown className="h-4 w-4 text-danger" />
            ) : (
              <TrendingUp className="h-4 w-4 text-success" />
            )}
            <CardTitle className="text-base">
              {hayAtasco ? 'Atasco previsto' : 'Proyeccion 30 dias'}
            </CardTitle>
          </div>
          <Link
            href="/proyeccion"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Ver detalle
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Hoy
            </p>
            <p className="text-base font-semibold tabular-nums">
              {fmtMonto(saldoInicial)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              En 30 dias
            </p>
            <p
              className={cn(
                'text-base font-semibold tabular-nums',
                saldoFinal < 0 && 'text-danger',
                saldoFinal >= 0 && cambio > 0 && 'text-success',
              )}
            >
              {fmtMonto(saldoFinal)}
            </p>
          </div>
        </div>

        <div className="h-[80px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradMini" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={
                      hayAtasco ? 'oklch(var(--danger))' : 'oklch(var(--success))'
                    }
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={
                      hayAtasco ? 'oklch(var(--danger))' : 'oklch(var(--success))'
                    }
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <ReferenceLine y={0} stroke="oklch(var(--danger))" strokeDasharray="2 2" strokeWidth={1} />
              <RechartsTooltip content={<MiniTooltip />} />
              <Area
                type="monotone"
                dataKey="saldo"
                stroke={hayAtasco ? 'oklch(var(--danger))' : 'oklch(var(--success))'}
                strokeWidth={1.8}
                fill="url(#gradMini)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {hayAtasco && primerDiaCritico && (
          <div className="rounded-md bg-card border border-danger/30 p-2.5 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">
                Primer atasco:{' '}
                <span className="capitalize">
                  {format(parseISO(primerDiaCritico.fechaISO), "EEE d MMM", {
                    locale: es,
                  })}
                </span>
              </p>
              <p className="text-danger tabular-nums mt-0.5">
                {fmtMonto(primerDiaCritico.saldo)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type MiniTooltipPayload = {
  payload: { fecha: string; saldo: number };
};

function MiniTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: MiniTooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-[11px] shadow-md">
      <p className="capitalize">
        {format(parseISO(d.fecha), 'EEE d MMM', { locale: es })}
      </p>
      <p
        className={cn(
          'tabular-nums font-medium',
          d.saldo < 0 && 'text-danger',
          d.saldo >= 0 && 'text-success',
        )}
      >
        {fmtMonto(d.saldo)}
      </p>
    </div>
  );
}
