'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ActivityIcon,
  AlertTriangle,
  Info,
  TargetIcon,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fmtMonto } from '../erogaciones/utils';
import {
  HORIZONTES_ATRAS,
  type PrecisionFiltros,
} from './schema';
import type { ComparacionDia, ResumenPrecision } from './calcular';

type Unidad = { id: number; nombre: string };

type Props = {
  comparaciones: ComparacionDia[];
  resumen: ResumenPrecision;
  serieDiaria: Array<{ fechaISO: string; real: number; proyectado: number }>;
  unidades: Unidad[];
  filtros: PrecisionFiltros;
  rangoLabel: string;
  totalFilasFacturacion: number;
};

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export function PrecisionClient({
  comparaciones,
  resumen,
  serieDiaria,
  unidades,
  filtros,
  rangoLabel,
  totalFilasFacturacion,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    });
    startTransition(() => {
      router.replace(`/precision?${params.toString()}`);
    });
  }

  const chartData = useMemo(
    () =>
      serieDiaria.map((d) => ({
        ...d,
        fechaCorta: format(parseISO(d.fechaISO), 'd MMM', { locale: es }),
      })),
    [serieDiaria],
  );

  if (totalFilasFacturacion === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <ActivityIcon className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">Sin datos de facturacion</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Para evaluar la precision del modelo necesitamos historial de
            facturacion real. Carga datos en facturacion_diaria (importador Excel
            o manual) y vuelve a esta pantalla.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (comparaciones.length === 0) {
    return (
      <div className="space-y-4">
        <Controles filtros={filtros} setQuery={setQuery} isPending={isPending} unidades={unidades} rangoLabel={rangoLabel} />
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <AlertTriangle className="h-10 w-10 mx-auto text-warning" />
            <p className="text-base font-medium">Sin comparaciones en el rango</p>
            <p className="text-sm text-muted-foreground">
              No hay datos reales en los ultimos {filtros.diasAtras} dias para esta
              configuracion.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Controles filtros={filtros} setQuery={setQuery} isPending={isPending} unidades={unidades} rangoLabel={rangoLabel} />

      {/* Stats strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card
          className={cn(
            resumen.mape < 15 && 'border-success/30 bg-success/5',
            resumen.mape >= 30 && 'border-danger/30 bg-danger/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TargetIcon className="h-3 w-3" /> MAPE
            </p>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums mt-1',
                resumen.mape < 15 && 'text-success',
                resumen.mape >= 30 && 'text-danger',
              )}
            >
              {resumen.mape.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Error relativo promedio absoluto
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              MAE
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmtMonto(resumen.mae)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Error absoluto promedio por dia-unidad
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              {resumen.bias > 0 ? (
                <TrendingUp className="h-3 w-3 text-info" />
              ) : (
                <TrendingDown className="h-3 w-3 text-info" />
              )}
              Sesgo
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmtMonto(resumen.bias)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {resumen.bias > 0
                ? 'Subestimamos en promedio'
                : resumen.bias < 0
                  ? 'Sobreestimamos en promedio'
                  : 'Balanceado'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Cobertura ±25%
            </p>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums mt-1',
                resumen.cobertura >= 80 && 'text-success',
                resumen.cobertura < 50 && 'text-warning',
              )}
            >
              {resumen.cobertura.toFixed(0)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {resumen.comparados} dia-unidad comparados
              {resumen.excluidos > 0 && ` · ${resumen.excluidos} excluidos`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-3 flex items-center gap-2">
            <ActivityIcon className="h-4 w-4" />
            Real vs proyectado por dia
          </p>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
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
                <RechartsTooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  iconType="line"
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  name="Real"
                  stroke="oklch(var(--success))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="proyectado"
                  name="Proyectado"
                  stroke="oklch(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Tabla detalle */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <p className="text-sm font-medium">Detalle por dia-unidad</p>
          <p className="text-xs text-muted-foreground">
            {comparaciones.length} comparaciones
          </p>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Fecha
                </th>
                <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Unidad
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Real
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Proyectado
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Error
                </th>
                <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  Error %
                </th>
              </tr>
            </thead>
            <tbody>
              {comparaciones.map((c) => {
                const u = unidades.find((x) => x.id === c.unidadNegocioId);
                const malo = Math.abs(c.errorPct) > 25 && !c.excluido;
                return (
                  <tr
                    key={`${c.fechaISO}-${c.unidadNegocioId}`}
                    className={cn(
                      'border-t',
                      c.excluido && 'opacity-60',
                      malo && 'bg-warning/5',
                    )}
                  >
                    <td className="px-4 py-2 capitalize">
                      {format(parseISO(c.fechaISO), 'EEE d MMM', { locale: es })}
                    </td>
                    <td className="px-4 py-2 text-xs">{u?.nombre ?? `#${c.unidadNegocioId}`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtMonto(c.real)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {c.excluido ? '-' : fmtMonto(c.proyectado)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right tabular-nums',
                        !c.excluido && c.error > 0 && 'text-success',
                        !c.excluido && c.error < 0 && 'text-danger',
                      )}
                    >
                      {c.excluido ? (
                        <Badge variant="outline" className="text-[10px]">
                          evento puntual
                        </Badge>
                      ) : (
                        fmtMonto(c.error)
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right tabular-nums',
                        !c.excluido && Math.abs(c.errorPct) > 25 && 'text-warning font-medium',
                      )}
                    >
                      {c.excluido ? '-' : `${c.errorPct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Notas */}
      <Card>
        <CardContent className="p-4 text-sm space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground flex items-center gap-2">
            <Info className="h-4 w-4" />
            Como interpretarlo
          </p>
          <p>
            <strong className="text-foreground">MAPE</strong> = error % promedio
            (absoluto). Menor es mejor. {'<'}15% es excelente, {'<'}30% es aceptable,
            mas de eso indica que el modelo necesita mas datos o ajuste de
            ponderacion.
          </p>
          <p>
            <strong className="text-foreground">Sesgo (bias)</strong>: si es positivo,
            el modelo te subestima la facturacion (vas a ingresar mas de lo proyectado).
            Si es negativo, te sobreestima (cuidado: te puede llevar a comprometerte
            con pagos que no podes cubrir).
          </p>
          <p>
            <strong className="text-foreground">Cobertura ±25%</strong>: % de dias
            donde el real estuvo dentro de un 25% del proyectado. Es la metrica
            mas intuitiva: si esta arriba del 80%, podes confiar en la proyeccion
            para planeamiento operativo.
          </p>
          <p>
            <strong className="text-foreground">Como ajustar</strong>: si MAPE es
            alto, prueba a ajustar la <Link href="/promedios" className="text-primary hover:underline">ponderacion</Link>{' '}
            (decay mas agresivo si tu negocio cambia rapido) o la ventana (mas
            chica = mas reactivo, mas grande = mas estable).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Controles({
  filtros,
  setQuery,
  isPending,
  unidades,
  rangoLabel,
}: {
  filtros: PrecisionFiltros;
  setQuery: (u: Record<string, string | null>) => void;
  isPending: boolean;
  unidades: Unidad[];
  rangoLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 p-4 rounded-lg border bg-card">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Ventana de evaluacion
        </label>
        <div className="flex rounded-md border overflow-hidden">
          {HORIZONTES_ATRAS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setQuery({ diasAtras: String(d) })}
              disabled={isPending}
              className={cn(
                'px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors',
                filtros.diasAtras === d
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Unidad</label>
        <Select
          value={filtros.unidad ? String(filtros.unidad) : 'todas'}
          onValueChange={(v) =>
            v && setQuery({ unidad: v === 'todas' ? null : String(v) })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las unidades</SelectItem>
            {unidades.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto text-xs text-muted-foreground space-y-0.5 text-right">
        <p>
          Rango: <span className="font-medium">{rangoLabel}</span>
        </p>
        <p>
          Promedios con ventana {filtros.ventana}s · decay {filtros.decay}
        </p>
      </div>
    </div>
  );
}

type TooltipPayload = {
  payload: { fechaISO: string; real: number; proyectado: number };
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
  const error = d.real - d.proyectado;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-1">
      <p className="font-medium capitalize">
        {format(parseISO(d.fechaISO), "EEEE d 'de' MMMM", { locale: es })}
      </p>
      <div className="space-y-0.5">
        <p className="text-success tabular-nums">Real: {fmtMonto(d.real)}</p>
        <p className="text-primary tabular-nums">Proyectado: {fmtMonto(d.proyectado)}</p>
        <p
          className={cn(
            'tabular-nums pt-1 border-t font-medium',
            error > 0 ? 'text-success' : error < 0 ? 'text-danger' : '',
          )}
        >
          Error: {fmtMonto(error)}
        </p>
      </div>
    </div>
  );
}
