'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Activity, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtMonto } from './erogaciones/utils';

type DiaFacturacion = {
  fecha: string;
  // Por unidad: real (si existe) o null, proyectado (si aplica) o null
  porUnidad: Record<number, { real: number | null; proyectado: number | null }>;
};

type Props = {
  unidades: { id: number; nombre: string }[];
  serie: DiaFacturacion[];
  ultimaFechaRealConsolidada: string | null;
  ultimaFechaRealPorUnidad: Record<number, string | null>;
};

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

type Vista = 'consolidado' | number; // number = unidadId

export function HomeFacturacionTrend({
  unidades,
  serie,
  ultimaFechaRealConsolidada,
  ultimaFechaRealPorUnidad,
}: Props) {
  const [vista, setVista] = useState<Vista>('consolidado');

  const chartData = useMemo(() => {
    return serie.map((d) => {
      let real: number | null = null;
      let proyectado: number | null = null;
      if (vista === 'consolidado') {
        // Suma de todas las unidades. Si TODAS las unidades tienen real para
        // ese dia, esto es real. Si hay alguna proyectada, sumamos como
        // proyectada para que no haya doble suma en el grafico.
        let sumReal = 0;
        let sumProy = 0;
        let hayReal = false;
        let hayProy = false;
        for (const u of unidades) {
          const pu = d.porUnidad[u.id];
          if (!pu) continue;
          if (pu.real !== null) {
            sumReal += pu.real;
            hayReal = true;
          }
          if (pu.proyectado !== null) {
            sumProy += pu.proyectado;
            hayProy = true;
          }
        }
        // Si hay reales en alguna unidad y proyectados en otras, las sumamos
        // ambas en "real" (el dia se cuenta como historico)
        if (hayReal && !hayProy) {
          real = sumReal;
        } else if (!hayReal && hayProy) {
          proyectado = sumProy;
        } else if (hayReal && hayProy) {
          real = sumReal + sumProy;
        }
      } else {
        const pu = d.porUnidad[vista];
        if (pu) {
          real = pu.real;
          proyectado = pu.proyectado;
        }
      }
      return {
        fecha: d.fecha,
        fechaCorta: format(parseISO(d.fecha), 'd MMM', { locale: es }),
        real,
        proyectado,
      };
    });
  }, [serie, vista, unidades]);

  const ultimaFechaReal =
    vista === 'consolidado'
      ? ultimaFechaRealConsolidada
      : ultimaFechaRealPorUnidad[vista] ?? null;

  const ultimaFechaRealCorta = ultimaFechaReal
    ? format(parseISO(ultimaFechaReal), 'd MMM', { locale: es })
    : null;

  const hayBache = useMemo(() => {
    if (!ultimaFechaReal) return false;
    const ultima = parseISO(ultimaFechaReal);
    const hoy = new Date();
    return ultima.getTime() < hoy.getTime() - 24 * 60 * 60 * 1000;
  }, [ultimaFechaReal]);

  const totalReal = chartData.reduce((a, d) => a + (d.real ?? 0), 0);
  const totalProyectado = chartData.reduce((a, d) => a + (d.proyectado ?? 0), 0);

  const tieneData = chartData.some((d) => d.real !== null || d.proyectado !== null);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2.5">
            <Activity className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">Facturacion diaria</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Datos reales cargados vs proyeccion para los dias sin dato
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setVista('consolidado')}
              className={cn(
                'h-7 px-2.5 text-xs rounded-md border transition-colors',
                vista === 'consolidado'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-muted',
              )}
            >
              Consolidado
            </button>
            {unidades.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setVista(u.id)}
                className={cn(
                  'h-7 px-2.5 text-xs rounded-md border transition-colors',
                  vista === u.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:bg-muted',
                )}
              >
                {u.nombre}
              </button>
            ))}
          </div>
        </div>

        {!tieneData ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <p>Aun no hay facturacion cargada.</p>
            <p className="text-xs mt-1">
              Carga datos en /facturacion o desde /importar.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border bg-card p-2.5">
                <p className="text-muted-foreground">Real (60d)</p>
                <p className="text-base font-semibold tabular-nums text-success mt-0.5">
                  {fmtMonto(totalReal)}
                </p>
              </div>
              <div className="rounded-md border bg-card p-2.5">
                <p className="text-muted-foreground">Proyectado (bache)</p>
                <p
                  className={cn(
                    'text-base font-semibold tabular-nums mt-0.5',
                    hayBache ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {fmtMonto(totalProyectado)}
                </p>
              </div>
              <div className="rounded-md border bg-card p-2.5">
                <p className="text-muted-foreground">Ultimo real</p>
                <p
                  className={cn(
                    'text-base font-semibold tabular-nums mt-0.5 capitalize',
                    hayBache ? 'text-warning' : 'text-foreground',
                  )}
                >
                  {ultimaFechaRealCorta ?? '-'}
                </p>
              </div>
            </div>

            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    opacity={0.6}
                  />
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
                    width={55}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  {ultimaFechaReal && hayBache && (
                    <ReferenceArea
                      x1={ultimaFechaRealCorta!}
                      x2={chartData[chartData.length - 1]?.fechaCorta}
                      fill="#f59e0b"
                      fillOpacity={0.08}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="real"
                    stroke="#16a34a"
                    strokeWidth={2.5}
                    dot={{ r: 2.5, fill: '#16a34a', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    name="Real"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="proyectado"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={{ r: 2.5, fill: '#f59e0b', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    name="Proyectado"
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-3.5 rounded-full"
                    style={{ backgroundColor: '#16a34a' }}
                  />
                  Real
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-3.5 rounded-full"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, #f59e0b 50%, transparent 50%)',
                      backgroundSize: '6px 100%',
                    }}
                  />
                  Proyectado
                </span>
              </div>
              {hayBache && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <Info className="h-3 w-3" />
                  Bache: cargá facturacion mas reciente para que sea todo real
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type TooltipPayload = {
  payload: {
    fecha: string;
    fechaCorta: string;
    real: number | null;
    proyectado: number | null;
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
      {d.real !== null && (
        <p className="text-success tabular-nums">Real: {fmtMonto(d.real)}</p>
      )}
      {d.proyectado !== null && (
        <p className="text-warning tabular-nums">
          Proyectado: {fmtMonto(d.proyectado)}
        </p>
      )}
    </div>
  );
}
