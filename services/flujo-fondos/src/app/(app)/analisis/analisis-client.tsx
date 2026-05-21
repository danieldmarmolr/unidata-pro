'use client';

import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, Info, PieChart as PieChartIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { fmtMonto } from '../erogaciones/utils';
import {
  PERIODOS,
  PERIODO_LABELS,
  type AnalisisFiltros,
} from './schema';

type Agrupacion = {
  total: string;
  cantidad: number;
};

type EmpresaRow = Agrupacion & { empresaId: number | null; empresaNombre: string | null };
type BancoRow = Agrupacion & { bancoId: number | null; bancoNombre: string | null };
type ProveedorRow = Agrupacion & {
  proveedorId: number | null;
  proveedorNombre: string | null;
};
type CategoriaRow = Agrupacion & { categoria: string | null };
type MesRow = { mes: string; total: string };

type Props = {
  filtros: AnalisisFiltros;
  porEmpresa: EmpresaRow[];
  porBanco: BancoRow[];
  porProveedor: ProveedorRow[];
  porCategoria: CategoriaRow[];
  porMes: MesRow[];
  totalGeneral: number;
  cantidadGeneral: number;
  rangoLabel: string;
};

const COLORS = [
  'oklch(0.55 0.18 250)', // info (azul)
  'oklch(0.55 0.16 152)', // success (verde)
  'oklch(0.72 0.16 80)', // warning (amarillo)
  'oklch(0.577 0.245 27.325)', // danger (rojo)
  'oklch(0.6 0.2 300)', // purpura
  'oklch(0.6 0.2 200)', // cyan
  'oklch(0.6 0.2 60)', // naranja
  'oklch(0.55 0.15 100)', // verde claro
];

function fmtCorto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export function AnalisisClient({
  filtros,
  porEmpresa,
  porBanco,
  porProveedor,
  porCategoria,
  porMes,
  totalGeneral,
  cantidadGeneral,
  rangoLabel,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null) params.delete(k);
      else params.set(k, v);
    });
    startTransition(() => {
      router.replace(`/analisis?${params.toString()}`);
    });
  }

  const empresaData = useMemo(
    () =>
      porEmpresa
        .filter((e) => Number(e.total) > 0)
        .map((e) => ({
          nombre: e.empresaNombre ?? 'Sin empresa',
          total: Number(e.total),
          cantidad: e.cantidad,
        }))
        .sort((a, b) => b.total - a.total),
    [porEmpresa],
  );

  const bancoData = useMemo(
    () =>
      porBanco
        .filter((e) => Number(e.total) > 0)
        .map((e) => ({
          nombre: e.bancoNombre ?? 'Sin banco',
          total: Number(e.total),
          cantidad: e.cantidad,
        }))
        .sort((a, b) => b.total - a.total),
    [porBanco],
  );

  const proveedorData = useMemo(
    () =>
      porProveedor
        .filter((e) => Number(e.total) > 0)
        .map((e) => ({
          nombre: e.proveedorNombre ?? 'Sin proveedor',
          proveedorId: e.proveedorId,
          total: Number(e.total),
          cantidad: e.cantidad,
        })),
    [porProveedor],
  );

  const categoriaData = useMemo(() => {
    const sinCategoria = porCategoria.find((c) => !c.categoria);
    const conCategoria = porCategoria.filter((c) => c.categoria);
    const data = conCategoria
      .map((c) => ({
        nombre: c.categoria!,
        total: Number(c.total),
        cantidad: c.cantidad,
      }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
    if (sinCategoria && Number(sinCategoria.total) > 0) {
      data.push({
        nombre: '(sin categoria)',
        total: Number(sinCategoria.total),
        cantidad: sinCategoria.cantidad,
      });
    }
    return data;
  }, [porCategoria]);

  const mesData = useMemo(
    () =>
      porMes.map((m) => ({
        mes: m.mes,
        mesCorto: format(parseISO(`${m.mes}-01`), 'MMM yy', { locale: es }),
        total: Number(m.total),
      })),
    [porMes],
  );

  if (totalGeneral === 0) {
    return (
      <div className="space-y-4">
        <Controles filtros={filtros} setQuery={setQuery} isPending={isPending} rangoLabel={rangoLabel} />
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-base font-medium">Sin erogaciones en el periodo</p>
            <p className="text-sm text-muted-foreground">
              Probá ampliar el rango o cambiar el filtro de estado.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Controles filtros={filtros} setQuery={setQuery} isPending={isPending} rangoLabel={rangoLabel} />

      {/* Stats globales */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total egresos
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmtMonto(totalGeneral)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Pagos
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {cantidadGeneral}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Ticket promedio
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmtMonto(cantidadGeneral > 0 ? totalGeneral / cantidadGeneral : 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Empresas activas
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {empresaData.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              con erogaciones en el periodo
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="empresa">
        <TabsList>
          <TabsTrigger value="empresa">Por empresa</TabsTrigger>
          <TabsTrigger value="banco">Por banco</TabsTrigger>
          <TabsTrigger value="proveedor">Top proveedores</TabsTrigger>
          <TabsTrigger value="categoria">Por categoria</TabsTrigger>
          <TabsTrigger value="mes">Serie temporal</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="mt-4">
          <DistribucionView
            data={empresaData}
            etiqueta="Empresa"
            totalGeneral={totalGeneral}
          />
        </TabsContent>

        <TabsContent value="banco" className="mt-4">
          <DistribucionView
            data={bancoData}
            etiqueta="Banco"
            totalGeneral={totalGeneral}
          />
        </TabsContent>

        <TabsContent value="proveedor" className="mt-4">
          <ProveedoresView data={proveedorData} totalGeneral={totalGeneral} />
        </TabsContent>

        <TabsContent value="categoria" className="mt-4">
          {categoriaData.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <p className="text-sm font-medium">Sin categorias asignadas</p>
                <p className="text-xs text-muted-foreground">
                  Asigná categorías al cargar erogaciones para verlas acá agrupadas.
                </p>
              </CardContent>
            </Card>
          ) : (
            <DistribucionView
              data={categoriaData}
              etiqueta="Categoria"
              totalGeneral={totalGeneral}
            />
          )}
        </TabsContent>

        <TabsContent value="mes" className="mt-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Egresos por mes
              </p>
              {mesData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  Sin datos para graficar.
                </p>
              ) : (
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={mesData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="oklch(var(--border))"
                        opacity={0.4}
                      />
                      <XAxis
                        dataKey="mesCorto"
                        fontSize={11}
                        tick={{ fill: 'oklch(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'oklch(var(--border))' }}
                        tickLine={false}
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
                        contentStyle={{
                          background: 'oklch(var(--popover))',
                          border: '1px solid oklch(var(--border))',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v) => fmtMonto(Number(v))}
                      />
                      <Bar dataKey="total" fill="oklch(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground flex items-start gap-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            El analisis incluye erogaciones con estado segun el filtro arriba.
            Cancelados y rechazados nunca se cuentan. Click en cualquier proveedor
            en la tab correspondiente para abrir su ficha completa.
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
  rangoLabel,
}: {
  filtros: AnalisisFiltros;
  setQuery: (u: Record<string, string | null>) => void;
  isPending: boolean;
  rangoLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 p-4 rounded-lg border bg-card">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Periodo
        </label>
        <div className="flex flex-wrap rounded-md border overflow-hidden">
          {PERIODOS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setQuery({ periodo: p })}
              disabled={isPending}
              className={cn(
                'px-3 py-1.5 text-xs border-r last:border-r-0 transition-colors whitespace-nowrap',
                filtros.periodo === p
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {PERIODO_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <div className="flex rounded-md border overflow-hidden">
          {(['todos', 'pagado', 'pendiente_curso'] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setQuery({ estado: e })}
              disabled={isPending}
              className={cn(
                'px-3 py-1.5 text-xs border-r last:border-r-0 transition-colors whitespace-nowrap',
                filtros.estado === e
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {e === 'todos'
                ? 'Todos'
                : e === 'pagado'
                  ? 'Solo pagados'
                  : 'Pendiente / En curso'}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto text-xs text-muted-foreground space-y-0.5 text-right">
        <p>{rangoLabel}</p>
      </div>
    </div>
  );
}

function DistribucionView({
  data,
  etiqueta,
  totalGeneral,
}: {
  data: Array<{ nombre: string; total: number; cantidad: number }>;
  etiqueta: string;
  totalGeneral: number;
}) {
  const pieData = data.slice(0, 6);
  const otros = data.slice(6).reduce((a, x) => a + x.total, 0);
  if (otros > 0) pieData.push({ nombre: 'Otros', total: otros, cantidad: 0 });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-medium mb-3 flex items-center gap-2">
            <PieChartIcon className="h-4 w-4" />
            Distribucion por {etiqueta.toLowerCase()}
          </p>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="total"
                  nameKey="nombre"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={40}
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{
                    background: 'oklch(var(--popover))',
                    border: '1px solid oklch(var(--border))',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v) => fmtMonto(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <p className="text-sm font-medium">{etiqueta}s ({data.length})</p>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {data.map((d, i) => {
              const pct = totalGeneral > 0 ? (d.total / totalGeneral) * 100 : 0;
              return (
                <div key={i} className="px-4 py-2.5 border-b last:border-b-0">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium truncate">{d.nombre}</span>
                    <span className="tabular-nums shrink-0 ml-2">
                      {fmtMonto(d.total)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {pct.toFixed(1)}% · {d.cantidad}{' '}
                      {d.cantidad === 1 ? 'pago' : 'pagos'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProveedoresView({
  data,
  totalGeneral,
}: {
  data: Array<{ nombre: string; proveedorId: number | null; total: number; cantidad: number }>;
  totalGeneral: number;
}) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <p className="text-sm font-medium">Sin erogaciones con proveedor asignado</p>
          <p className="text-xs text-muted-foreground">
            Asigná proveedores en las erogaciones para verlos acá agrupados.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b">
          <p className="text-sm font-medium">Top {data.length} proveedores</p>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {data.map((d, i) => {
            const pct = totalGeneral > 0 ? (d.total / totalGeneral) * 100 : 0;
            return (
              <div key={i} className="px-4 py-3 border-b last:border-b-0 hover:bg-muted/20">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      #{i + 1}
                    </Badge>
                    {d.proveedorId ? (
                      <Link
                        href={`/proveedores/${d.proveedorId}`}
                        className="font-medium hover:underline truncate"
                      >
                        {d.nombre}
                      </Link>
                    ) : (
                      <span className="font-medium truncate text-muted-foreground italic">
                        {d.nombre}
                      </span>
                    )}
                  </div>
                  <span className="tabular-nums shrink-0 ml-2 font-semibold">
                    {fmtMonto(d.total)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-info"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {pct.toFixed(1)}% · {d.cantidad}{' '}
                    {d.cantidad === 1 ? 'pago' : 'pagos'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
