'use client';

import { differenceInDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Handshake,
  Mail,
  Phone,
  Tag,
  User,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  ESTADO_LABELS as ESTADO_EROGACION_LABELS,
  type EstadoErogacion,
} from '../../erogaciones/schema';
import { ESTADO_PILL_CLASS, fmtFechaAR, fmtMonto } from '../../erogaciones/utils';
import {
  ESTADO_ACUERDO_LABELS,
  TIPO_ACUERDO_LABELS,
  type EstadoAcuerdo,
  type TipoAcuerdo,
} from '../../acuerdos/schema';
import { ESTADO_ACUERDO_PILL, TIPO_ACUERDO_PILL, diasHasta } from '../../acuerdos/utils';
import type { Acuerdo, Proveedor } from '@/db/schema';

type ErogFila = {
  id: number;
  fechaPago: string;
  fechaCarga: Date;
  descripcion: string;
  monto: string;
  moneda: string;
  estado: EstadoErogacion;
  esCritico: boolean;
  empresaId: number;
  empresaNombre: string | null;
  pagadoAt: Date | null;
};

type Props = {
  proveedor: Proveedor;
  erogaciones: ErogFila[];
  acuerdos: Acuerdo[];
  sumasPorEstado: { estado: EstadoErogacion; total: string; cantidad: number }[];
  acuerdosPorEstado: { estado: EstadoAcuerdo; n: number }[];
};

const PRIORIDAD_VARIANT: Record<
  Proveedor['prioridad'],
  'default' | 'secondary' | 'destructive'
> = {
  alta: 'destructive',
  media: 'default',
  baja: 'secondary',
};

const PRIORIDAD_LABEL: Record<Proveedor['prioridad'], string> = {
  alta: 'Prioridad alta',
  media: 'Prioridad media',
  baja: 'Prioridad baja',
};

export function ProveedorFichaClient({
  proveedor,
  erogaciones,
  acuerdos,
  sumasPorEstado,
  acuerdosPorEstado,
}: Props) {
  const [tab, setTab] = useState<'general' | 'erogaciones' | 'acuerdos'>('general');

  const stats = useMemo(() => {
    const total = (estado: EstadoErogacion) =>
      Number(sumasPorEstado.find((s) => s.estado === estado)?.total ?? '0');
    const cantidad = (estado: EstadoErogacion) =>
      sumasPorEstado.find((s) => s.estado === estado)?.cantidad ?? 0;

    const pagadoMonto = total('pagado');
    const pagadoCantidad = cantidad('pagado');
    const pendienteMonto = total('pendiente') + total('en_curso');
    const pendienteCantidad = cantidad('pendiente') + cantidad('en_curso');
    const pagoPromedio = pagadoCantidad > 0 ? pagadoMonto / pagadoCantidad : 0;

    // Lead time medio: dias entre fecha_carga y pagado_at (cuando hay ambas)
    const pagadas = erogaciones.filter((e) => e.estado === 'pagado' && e.pagadoAt);
    const leadTimes = pagadas
      .map((e) =>
        differenceInDays(e.pagadoAt as Date, new Date(e.fechaCarga)),
      )
      .filter((d) => d >= 0);
    const leadTimeMedio =
      leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;

    return {
      pagadoMonto,
      pagadoCantidad,
      pendienteMonto,
      pendienteCantidad,
      pagoPromedio,
      leadTimeMedio,
      ultimoPago: erogaciones.find((e) => e.estado === 'pagado'),
    };
  }, [sumasPorEstado, erogaciones]);

  const tasaCumplimiento = useMemo(() => {
    const cumplidos = acuerdosPorEstado.find((a) => a.estado === 'cumplido')?.n ?? 0;
    const incumplidos = acuerdosPorEstado.find((a) => a.estado === 'incumplido')?.n ?? 0;
    const resueltos = cumplidos + incumplidos;
    if (resueltos === 0) return null;
    return {
      pct: (cumplidos / resueltos) * 100,
      cumplidos,
      incumplidos,
      resueltos,
    };
  }, [acuerdosPorEstado]);

  const pendientesAcuerdos = acuerdosPorEstado.find((a) => a.estado === 'pendiente')?.n ?? 0;

  const contacto = (proveedor.contacto ?? {}) as {
    nombre?: string;
    email?: string;
    telefono?: string;
  };

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Breadcrumb + acciones */}
      <div className="flex items-center justify-between">
        <Link
          href="/proveedores"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Proveedores
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/acuerdos?proveedor=${proveedor.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Handshake className="h-3.5 w-3.5 mr-1.5" />
            Nuevo acuerdo
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{proveedor.nombre}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORIDAD_VARIANT[proveedor.prioridad]} className="text-xs">
              {PRIORIDAD_LABEL[proveedor.prioridad]}
            </Badge>
            {proveedor.cuit && (
              <Badge variant="outline" className="text-xs">
                CUIT {proveedor.cuit}
              </Badge>
            )}
            {proveedor.tags?.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                <Tag className="h-2.5 w-2.5 mr-1" />
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-success" /> Total pagado
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmtMonto(stats.pagadoMonto)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {stats.pagadoCantidad}{' '}
              {stats.pagadoCantidad === 1 ? 'pago' : 'pagos'} historicos
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            stats.pendienteMonto > 0 && 'border-warning/30 bg-warning/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-warning" /> Pendiente / En curso
            </p>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums mt-1',
                stats.pendienteMonto > 0 && 'text-warning',
              )}
            >
              {fmtMonto(stats.pendienteMonto)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {stats.pendienteCantidad}{' '}
              {stats.pendienteCantidad === 1 ? 'pago' : 'pagos'} sin completar
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Pago promedio
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmtMonto(stats.pagoPromedio)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {stats.leadTimeMedio !== null
                ? `Lead time medio: ${stats.leadTimeMedio.toFixed(0)}d`
                : 'Sin datos de lead time'}
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            tasaCumplimiento &&
              tasaCumplimiento.pct < 50 &&
              'border-danger/30 bg-danger/5',
            tasaCumplimiento &&
              tasaCumplimiento.pct >= 80 &&
              'border-success/30 bg-success/5',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Handshake className="h-3 w-3" /> Tasa de cumplimiento
            </p>
            {tasaCumplimiento ? (
              <>
                <p
                  className={cn(
                    'text-xl font-semibold tabular-nums mt-1',
                    tasaCumplimiento.pct < 50 && 'text-danger',
                    tasaCumplimiento.pct >= 80 && 'text-success',
                  )}
                >
                  {tasaCumplimiento.pct.toFixed(0)}%
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {tasaCumplimiento.cumplidos}/{tasaCumplimiento.resueltos} promesas cumplidas
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-semibold tabular-nums mt-1 text-muted-foreground/60">
                  -
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {pendientesAcuerdos > 0
                    ? `${pendientesAcuerdos} pendientes sin resolver`
                    : 'Sin promesas registradas'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="erogaciones">
            Erogaciones ({erogaciones.length})
          </TabsTrigger>
          <TabsTrigger value="acuerdos">
            Acuerdos ({acuerdos.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-medium">Contacto</p>
                {!contacto.nombre && !contacto.email && !contacto.telefono ? (
                  <p className="text-sm text-muted-foreground">
                    Sin datos de contacto cargados.
                  </p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {contacto.nombre && (
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{contacto.nombre}</span>
                      </div>
                    )}
                    {contacto.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <a
                          href={`mailto:${contacto.email}`}
                          className="text-primary hover:underline"
                        >
                          {contacto.email}
                        </a>
                      </div>
                    )}
                    {contacto.telefono && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{contacto.telefono}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-medium">Saldo declarado</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {fmtMonto(proveedor.saldoPendiente)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saldo manual del proveedor (no se calcula automaticamente, lo
                  actualizas vos en el form de edicion).
                </p>
              </CardContent>
            </Card>
          </div>

          {proveedor.notas && (
            <Card>
              <CardContent className="p-5">
                <p className="text-sm font-medium mb-2">Notas</p>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {proveedor.notas}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Resumen breve de actividad */}
          {erogaciones.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">Ultimas erogaciones</p>
                  <button
                    type="button"
                    onClick={() => setTab('erogaciones')}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver todas
                  </button>
                </div>
                <div className="space-y-2">
                  {erogaciones.slice(0, 5).map((er) => (
                    <ErogacionRow key={er.id} er={er} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {acuerdos.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">Promesas activas</p>
                  <button
                    type="button"
                    onClick={() => setTab('acuerdos')}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver todas
                  </button>
                </div>
                <div className="space-y-2">
                  {acuerdos
                    .filter((a) => a.estado === 'pendiente')
                    .slice(0, 4)
                    .map((a) => (
                      <AcuerdoRow key={a.id} a={a} />
                    ))}
                  {acuerdos.filter((a) => a.estado === 'pendiente').length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No hay promesas pendientes.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="erogaciones" className="mt-4">
          {erogaciones.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <Wallet className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-base font-medium">Sin erogaciones</p>
                <p className="text-sm text-muted-foreground">
                  No hay erogaciones registradas para este proveedor todavia.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Fecha
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Descripcion
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Empresa
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Monto
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {erogaciones.map((er) => (
                      <tr
                        key={er.id}
                        className="border-t hover:bg-muted/30 cursor-pointer"
                        onClick={() => {
                          window.location.href = `/erogaciones?q=${encodeURIComponent(er.descripcion)}`;
                        }}
                      >
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                          {fmtFechaAR(er.fechaPago)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="line-clamp-1">{er.descripcion}</p>
                          {er.esCritico && (
                            <Badge variant="outline" className="bg-danger/10 text-danger border-danger/30 text-[10px] mt-0.5">
                              critico
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {er.empresaNombre ?? '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtMonto(er.monto)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cn('text-[10px]', ESTADO_PILL_CLASS[er.estado])}
                          >
                            {ESTADO_EROGACION_LABELS[er.estado]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="acuerdos" className="mt-4">
          {acuerdos.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Handshake className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-base font-medium">Sin acuerdos registrados</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Cuando le prometas algo a este proveedor (un diferimiento, un
                  pago parcial), registralo para llevar trazabilidad.
                </p>
                <Link
                  href={`/acuerdos?proveedor=${proveedor.id}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Crear acuerdo
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {acuerdos.map((a) => (
                <AcuerdoRow key={a.id} a={a} expandido />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ErogacionRow({ er }: { er: ErogFila }) {
  return (
    <Link
      href={`/erogaciones?q=${encodeURIComponent(er.descripcion)}`}
      className="block p-2.5 rounded-md border hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm line-clamp-1">{er.descripcion}</p>
          <p className="text-xs text-muted-foreground">
            {fmtFechaAR(er.fechaPago)} · {er.empresaNombre ?? '-'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm tabular-nums font-medium">{fmtMonto(er.monto)}</p>
          <Badge
            variant="outline"
            className={cn('text-[10px]', ESTADO_PILL_CLASS[er.estado])}
          >
            {ESTADO_EROGACION_LABELS[er.estado]}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

function AcuerdoRow({ a, expandido = false }: { a: Acuerdo; expandido?: boolean }) {
  const dias = diasHasta(a.fechaCompromiso);
  const vencido = a.estado === 'pendiente' && dias !== null && dias < 0;
  const porVencer =
    a.estado === 'pendiente' && dias !== null && dias >= 0 && dias <= 7;

  return (
    <Link
      href={`/acuerdos?proveedor=${a.proveedorId}`}
      className={cn(
        'block p-3 rounded-md border hover:bg-muted/30 transition-colors',
        vencido && 'border-danger/30 bg-danger/5',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn('text-[10px]', TIPO_ACUERDO_PILL[a.tipo as TipoAcuerdo])}
            >
              {TIPO_ACUERDO_LABELS[a.tipo as TipoAcuerdo]}
            </Badge>
            <Badge
              variant="outline"
              className={cn('text-[10px]', ESTADO_ACUERDO_PILL[a.estado as EstadoAcuerdo])}
            >
              {ESTADO_ACUERDO_LABELS[a.estado as EstadoAcuerdo]}
            </Badge>
            {vencido && (
              <span className="text-[10px] font-medium text-danger uppercase">
                Vencido hace {Math.abs(dias!)}d
              </span>
            )}
            {porVencer && (
              <span className="text-[10px] font-medium text-warning">
                {dias === 0 ? 'Vence hoy' : `En ${dias} dias`}
              </span>
            )}
          </div>
          <p className={cn('text-sm', !expandido && 'line-clamp-2')}>{a.compromiso}</p>
          {expandido && a.contexto && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              {a.contexto}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-0.5">
          {a.fechaCompromiso && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {format(parseISO(a.fechaCompromiso), "d MMM ''yy", { locale: es })}
            </p>
          )}
          {a.montoCompromiso && (
            <p className="text-sm font-medium tabular-nums">
              {fmtMonto(a.montoCompromiso)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
