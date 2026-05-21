import { addDays, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { and, asc, count, eq, gte, lt, lte, ne, sql } from 'drizzle-orm';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Handshake,
  Inbox,
  Layers,
  PlayCircle,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { db } from '@/db';
import {
  acuerdos,
  bancosMediosPago,
  empresas,
  erogaciones,
  facturacionDiaria,
  ingresosPuntuales,
  proveedores,
  saldosIniciales,
  unidadesNegocio,
} from '@/db/schema';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import { fmtMonto } from './erogaciones/utils';
import { HomeDistribucionGastos } from './home-distribucion-gastos';
import { HomeFacturacionTrend } from './home-facturacion-trend';
import { HomeProyeccionMini } from './home-proyeccion-mini';
import {
  proyectarSaldo,
  resumirProyeccion,
  type ErogacionFlujo,
  type IngresoPuntualFlujo,
} from './proyeccion/calcular';
import { proyectarMonto } from './promedios/calcular';
import { BANCO_CONSOLIDADO_NOMBRE } from './saldos/schema';

export const dynamic = 'force-dynamic';

function hoyISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getAcuerdosUrgentes() {
  const hoy = new Date();
  const hoyStr = format(hoy, 'yyyy-MM-dd');
  const en7Str = format(addDays(hoy, 7), 'yyyy-MM-dd');

  const vencidos = await db
    .select({
      id: acuerdos.id,
      proveedorId: acuerdos.proveedorId,
      proveedorNombre: proveedores.nombre,
      compromiso: acuerdos.compromiso,
      fechaCompromiso: acuerdos.fechaCompromiso,
      montoCompromiso: acuerdos.montoCompromiso,
    })
    .from(acuerdos)
    .innerJoin(proveedores, eq(proveedores.id, acuerdos.proveedorId))
    .where(
      and(
        eq(acuerdos.estado, 'pendiente'),
        lte(acuerdos.fechaCompromiso, hoyStr),
      ),
    )
    .orderBy(asc(acuerdos.fechaCompromiso))
    .limit(5);

  const porVencer = await db
    .select({
      id: acuerdos.id,
      proveedorId: acuerdos.proveedorId,
      proveedorNombre: proveedores.nombre,
      compromiso: acuerdos.compromiso,
      fechaCompromiso: acuerdos.fechaCompromiso,
      montoCompromiso: acuerdos.montoCompromiso,
    })
    .from(acuerdos)
    .innerJoin(proveedores, eq(proveedores.id, acuerdos.proveedorId))
    .where(
      and(
        eq(acuerdos.estado, 'pendiente'),
        gte(acuerdos.fechaCompromiso, hoyStr),
        lte(acuerdos.fechaCompromiso, en7Str),
      ),
    )
    .orderBy(asc(acuerdos.fechaCompromiso))
    .limit(5);

  const [{ n: totalPendientes }] = await db
    .select({ n: count() })
    .from(acuerdos)
    .where(eq(acuerdos.estado, 'pendiente'));

  return { vencidos, porVencer, totalPendientes };
}

async function getProyeccion30() {
  const hoy = new Date();
  const hoyStr = format(hoy, 'yyyy-MM-dd');
  const finStr = format(addDays(hoy, 29), 'yyyy-MM-dd');

  // Las 4 queries son independientes — corren en paralelo.
  const [todos, proyeccion, erogs, ingPunt] = await Promise.all([
    db
      .select({
        bancoId: saldosIniciales.bancoId,
        fecha: saldosIniciales.fecha,
        saldo: saldosIniciales.saldo,
      })
      .from(saldosIniciales)
      .where(lte(saldosIniciales.fecha, hoyStr))
      .orderBy(asc(saldosIniciales.fecha)),
    calcularProyeccionTodas({ referencia: hoy }),
    db
      .select({
        fechaPago: erogaciones.fechaPago,
        monto: erogaciones.monto,
        estado: erogaciones.estado,
        esCritico: erogaciones.esCritico,
      })
      .from(erogaciones)
      .where(
        and(
          gte(erogaciones.fechaPago, hoyStr),
          lte(erogaciones.fechaPago, finStr),
          eq(erogaciones.oculto, false),
        ),
      ),
    db
      .select({
        fecha: ingresosPuntuales.fecha,
        monto: ingresosPuntuales.monto,
      })
      .from(ingresosPuntuales)
      .where(
        and(
          gte(ingresosPuntuales.fecha, hoyStr),
          lte(ingresosPuntuales.fecha, finStr),
        ),
      ),
  ]);
  const { promedios } = proyeccion;

  const ultimo = new Map<number, { fecha: string; saldo: string }>();
  for (const s of todos) {
    const p = ultimo.get(s.bancoId);
    if (!p || s.fecha > p.fecha) ultimo.set(s.bancoId, { fecha: s.fecha, saldo: s.saldo });
  }
  const saldoInicial = Array.from(ultimo.values()).reduce(
    (a, x) => a + Number(x.saldo),
    0,
  );
  const tieneSaldoInicial = ultimo.size > 0;

  if (!tieneSaldoInicial) {
    return {
      tieneSaldoInicial: false as const,
      saldoInicial: 0,
      saldoFinal: 0,
      diasEstrenimiento: 0,
      primerDiaCritico: null as { fechaISO: string; saldo: number } | null,
      dias: [] as { fechaISO: string; saldo: number; esEstrenimiento: boolean }[],
    };
  }

  const erogsForCalc: ErogacionFlujo[] = erogs.map((e) => ({
    fechaPago: e.fechaPago,
    monto: e.monto,
    estado: e.estado,
    esCritico: e.esCritico,
  }));
  const ingPuntForCalc: IngresoPuntualFlujo[] = ingPunt.map((x) => ({
    fecha: x.fecha,
    monto: x.monto,
  }));
  const diasFull = proyectarSaldo({
    saldoInicial,
    fechaDesde: hoy,
    diasHorizonte: 30,
    erogaciones: erogsForCalc,
    promedios,
    ingresosPuntuales: ingPuntForCalc,
    umbralEstrenimiento: 0,
  });
  const resumen = resumirProyeccion(saldoInicial, diasFull);

  return {
    tieneSaldoInicial: true as const,
    saldoInicial,
    saldoFinal: resumen.saldoFinal,
    diasEstrenimiento: resumen.diasEstrenimiento,
    primerDiaCritico: resumen.primerDiaEstrenimiento,
    dias: diasFull.map((d) => ({
      fechaISO: d.fechaISO,
      saldo: d.saldoAperturaCierre,
      esEstrenimiento: d.esEstrenimiento,
    })),
  };
}

async function getKpis() {
  const today = hoyISO();
  const en7 = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  // Las 7 queries son independientes — corren en paralelo en vez de en serie.
  const [
    [empresasCount],
    [unidadesCount],
    [bancosCount],
    [proveedoresCount],
    porEstado,
    [atrasadas],
    [proximas],
  ] = await Promise.all([
    db.select({ n: count() }).from(empresas),
    db.select({ n: count() }).from(unidadesNegocio),
    // Excluimos el banco virtual "Total consolidado" del conteo de bancos reales
    db
      .select({ n: count() })
      .from(bancosMediosPago)
      .where(ne(bancosMediosPago.nombre, BANCO_CONSOLIDADO_NOMBRE)),
    db.select({ n: count() }).from(proveedores),
    db
      .select({
        estado: erogaciones.estado,
        total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
        cantidad: count(),
      })
      .from(erogaciones)
      .where(eq(erogaciones.oculto, false))
      .groupBy(erogaciones.estado),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
        cantidad: count(),
      })
      .from(erogaciones)
      .where(
        // Atrasado = pendiente + fecha_pago estrictamente anterior a hoy.
        // Los pagos cuya fecha_pago es hoy NO son atrasados todavia.
        and(
          eq(erogaciones.estado, 'pendiente'),
          lt(erogaciones.fechaPago, today),
          eq(erogaciones.oculto, false),
        ),
      ),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
        cantidad: count(),
      })
      .from(erogaciones)
      .where(
        and(
          eq(erogaciones.estado, 'pendiente'),
          gte(erogaciones.fechaPago, today),
          lte(erogaciones.fechaPago, en7),
          eq(erogaciones.oculto, false),
        ),
      ),
  ]);

  const pendienteTotal =
    porEstado.find((p) => p.estado === 'pendiente')?.total ?? '0';
  const enCursoTotal =
    porEstado.find((p) => p.estado === 'en_curso')?.total ?? '0';
  const pagadoTotal =
    porEstado.find((p) => p.estado === 'pagado')?.total ?? '0';

  return {
    setup: {
      empresas: empresasCount?.n ?? 0,
      unidades: unidadesCount?.n ?? 0,
      bancos: bancosCount?.n ?? 0,
      proveedores: proveedoresCount?.n ?? 0,
    },
    operacion: {
      pendienteTotal,
      enCursoTotal,
      pagadoTotal,
      atrasadasMonto: atrasadas?.total ?? '0',
      atrasadasCantidad: atrasadas?.cantidad ?? 0,
      proximasMonto: proximas?.total ?? '0',
      proximasCantidad: proximas?.cantidad ?? 0,
    },
  };
}

async function getFacturacionTrend() {
  const hoy = new Date();
  const desde = addDays(hoy, -60);
  const hoyStr = isoDate(hoy);
  const desdeStr = isoDate(desde);

  // Unidades activas
  const unidades = await db
    .select({ id: unidadesNegocio.id, nombre: unidadesNegocio.nombre })
    .from(unidadesNegocio)
    .where(eq(unidadesNegocio.activa, true))
    .orderBy(asc(unidadesNegocio.nombre));

  // Real: facturacion en los ultimos 60 dias (suma por fecha+unidad)
  const realesRows = await db
    .select({
      fecha: facturacionDiaria.fecha,
      unidadNegocioId: facturacionDiaria.unidadNegocioId,
      monto: sql<string>`COALESCE(SUM(${facturacionDiaria.monto}::numeric), 0)::text`,
    })
    .from(facturacionDiaria)
    .where(
      and(
        gte(facturacionDiaria.fecha, desdeStr),
        lte(facturacionDiaria.fecha, hoyStr),
      ),
    )
    .groupBy(facturacionDiaria.fecha, facturacionDiaria.unidadNegocioId);

  const { promedios } = await calcularProyeccionTodas({
    referencia: hoy,
    semanasVentana: 12,
    decay: 0.85,
  });

  // Index real por (unidad, fecha)
  const realIndex = new Map<string, number>();
  const ultimaPorUnidad = new Map<number, string>();
  for (const r of realesRows) {
    const k = `${r.unidadNegocioId}|${r.fecha}`;
    realIndex.set(k, Number(r.monto));
    const prev = ultimaPorUnidad.get(r.unidadNegocioId);
    if (!prev || r.fecha > prev) ultimaPorUnidad.set(r.unidadNegocioId, r.fecha);
  }
  // Ultima fecha consolidada = max de todas las unidades
  let ultimaConsolidada: string | null = null;
  for (const v of ultimaPorUnidad.values()) {
    if (!ultimaConsolidada || v > ultimaConsolidada) ultimaConsolidada = v;
  }

  // Construir serie completa dia a dia
  const serie: {
    fecha: string;
    porUnidad: Record<number, { real: number | null; proyectado: number | null }>;
  }[] = [];
  for (let i = 0; i <= 60; i++) {
    const fecha = isoDate(addDays(desde, i));
    const porUnidad: Record<number, { real: number | null; proyectado: number | null }> = {};
    for (const u of unidades) {
      const realVal = realIndex.get(`${u.id}|${fecha}`);
      if (realVal !== undefined) {
        porUnidad[u.id] = { real: realVal, proyectado: null };
      } else {
        // Si la fecha es <= ultima fecha real de la unidad, no proyectamos
        // (asumimos que ese dia no facturo, no es bache).
        const ultimaUnidad = ultimaPorUnidad.get(u.id);
        const esBache = !ultimaUnidad || fecha > ultimaUnidad;
        if (esBache && fecha <= hoyStr) {
          const prom = promedios.find((p) => p.unidadNegocioId === u.id);
          const proyectado = prom ? proyectarMonto(prom, fecha) : 0;
          porUnidad[u.id] = { real: null, proyectado };
        } else {
          porUnidad[u.id] = { real: null, proyectado: null };
        }
      }
    }
    serie.push({ fecha, porUnidad });
  }

  const ultimaFechaRealPorUnidad: Record<number, string | null> = {};
  for (const u of unidades) {
    ultimaFechaRealPorUnidad[u.id] = ultimaPorUnidad.get(u.id) ?? null;
  }

  return {
    unidades,
    serie,
    ultimaFechaRealConsolidada: ultimaConsolidada,
    ultimaFechaRealPorUnidad,
  };
}

async function getTopProveedoresPendientes() {
  const today = hoyISO();
  const rows = await db
    .select({
      proveedorId: erogaciones.proveedorId,
      proveedorNombre: proveedores.nombre,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
      vencidasCantidad: sql<string>`SUM(CASE WHEN ${erogaciones.fechaPago} < ${today} THEN 1 ELSE 0 END)::text`,
    })
    .from(erogaciones)
    .leftJoin(proveedores, eq(proveedores.id, erogaciones.proveedorId))
    .where(and(eq(erogaciones.estado, 'pendiente'), eq(erogaciones.oculto, false)))
    .groupBy(erogaciones.proveedorId, proveedores.nombre)
    .orderBy(sql`SUM(${erogaciones.monto}::numeric) DESC`)
    .limit(5);
  return rows.map((r) => ({
    proveedorId: r.proveedorId,
    nombre: r.proveedorNombre ?? 'Sin proveedor',
    total: Number(r.total),
    cantidad: r.cantidad,
    vencidas: Number(r.vencidasCantidad ?? 0),
  }));
}

async function getDistribucionPorCategoriaMes() {
  const hoy = new Date();
  const inicioMes = isoDate(startOfMonth(hoy));
  const finMes = isoDate(endOfMonth(hoy));
  const rows = await db
    .select({
      categoria: erogaciones.categoria,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
    })
    .from(erogaciones)
    .where(
      and(
        gte(erogaciones.fechaPago, inicioMes),
        lte(erogaciones.fechaPago, finMes),
        eq(erogaciones.oculto, false),
      ),
    )
    .groupBy(erogaciones.categoria);
  const items = rows
    .map((r) => ({ categoria: r.categoria, total: Number(r.total) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const total = items.reduce((a, x) => a + x.total, 0);
  return { items, total };
}

const SETUP_KPIS = [
  { key: 'empresas' as const, label: 'Empresas', icon: Building2, href: '/empresas', meta: 4 },
  { key: 'unidades' as const, label: 'Unidades', icon: Layers, href: '/unidades-negocio', meta: 3 },
  { key: 'bancos' as const, label: 'Bancos', icon: Wallet, href: '/bancos', meta: 5 },
  { key: 'proveedores' as const, label: 'Proveedores', icon: Users, href: '/proveedores', meta: null },
];

export default async function Home() {
  const [
    kpis,
    proyeccion,
    acuerdosUrgentes,
    facturacionTrend,
    topProveedores,
    distribucion,
  ] = await Promise.all([
    getKpis(),
    getProyeccion30(),
    getAcuerdosUrgentes(),
    getFacturacionTrend(),
    getTopProveedoresPendientes(),
    getDistribucionPorCategoriaMes(),
  ]);

  const setupCompleto =
    kpis.setup.empresas >= 4 && kpis.setup.unidades >= 3 && kpis.setup.bancos >= 5;

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Tablero
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Inicio</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Estado del flujo de fondos, facturacion y obligaciones del periodo.
        </p>
      </div>

      {/* Banner */}
      {setupCompleto ? (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-info/10 text-info flex items-center justify-center">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">Procesar hoy</p>
                <p className="text-xs text-muted-foreground">
                  {kpis.operacion.proximasCantidad} pagos en los proximos 7 dias ·{' '}
                  <span className="tabular-nums">
                    {fmtMonto(kpis.operacion.proximasMonto)}
                  </span>
                </p>
              </div>
            </div>
            <Link
              href="/erogaciones?estado=pendiente"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir al Inbox
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-warning/10 text-warning flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">Falta terminar el setup</p>
                <p className="text-xs text-muted-foreground">
                  Cargá las empresas, unidades de negocio y bancos antes de
                  continuar.
                </p>
              </div>
            </div>
            <Link
              href="/empresas"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Continuar
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Operacion KPIs */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Erogaciones
        </p>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Link href="/erogaciones?estado=pendiente" className="group">
            <Card className="h-full transition-colors hover:bg-muted/40 border-warning/30">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <Clock className="h-4 w-4 text-warning" />
                </div>
                <p className="text-xs text-muted-foreground">Pendiente</p>
                <p className="text-xl font-semibold tabular-nums text-warning mt-1">
                  {fmtMonto(kpis.operacion.pendienteTotal)}
                </p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/erogaciones?estado=en_curso" className="group">
            <Card className="h-full transition-colors hover:bg-muted/40 border-info/30">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <Inbox className="h-4 w-4 text-info" />
                </div>
                <p className="text-xs text-muted-foreground">En curso</p>
                <p className="text-xl font-semibold tabular-nums text-info mt-1">
                  {fmtMonto(kpis.operacion.enCursoTotal)}
                </p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/erogaciones?estado=pagado" className="group">
            <Card className="h-full transition-colors hover:bg-muted/40 border-success/30">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                </div>
                <p className="text-xs text-muted-foreground">Pagado</p>
                <p className="text-xl font-semibold tabular-nums text-success mt-1">
                  {fmtMonto(kpis.operacion.pagadoTotal)}
                </p>
              </CardContent>
            </Card>
          </Link>
          <Link
            href={`/erogaciones?estado=pendiente&hasta=${hoyISO()}`}
            className="group"
          >
            <Card
              className={`h-full transition-colors hover:bg-muted/40 ${
                kpis.operacion.atrasadasCantidad > 0
                  ? 'border-danger/40 bg-danger/5'
                  : ''
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <AlertTriangle
                    className={`h-4 w-4 ${
                      kpis.operacion.atrasadasCantidad > 0
                        ? 'text-danger'
                        : 'text-muted-foreground'
                    }`}
                  />
                  {kpis.operacion.atrasadasCantidad > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {kpis.operacion.atrasadasCantidad}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Atrasadas</p>
                <p
                  className={`text-xl font-semibold tabular-nums mt-1 ${
                    kpis.operacion.atrasadasCantidad > 0
                      ? 'text-danger'
                      : 'text-foreground'
                  }`}
                >
                  {fmtMonto(kpis.operacion.atrasadasMonto)}
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Facturacion trend (full width) */}
      <HomeFacturacionTrend {...facturacionTrend} />

      {/* Proyeccion + Top proveedores */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HomeProyeccionMini
          dias={proyeccion.dias}
          saldoInicial={proyeccion.saldoInicial}
          saldoFinal={proyeccion.saldoFinal}
          diasEstrenimiento={proyeccion.diasEstrenimiento}
          primerDiaCritico={proyeccion.primerDiaCritico}
          tieneSaldoInicial={proyeccion.tieneSaldoInicial}
        />
        <TopProveedoresCard items={topProveedores} />
      </div>

      {/* Distribucion + Acuerdos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HomeDistribucionGastos
          items={distribucion.items}
          total={distribucion.total}
        />
        <AcuerdosCard data={acuerdosUrgentes} />
      </div>

      {/* Setup KPIs (al pie, ya menos importantes) */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Datos maestros
        </p>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {SETUP_KPIS.map(({ key, label, icon: Icon, href, meta }) => {
            const value = kpis.setup[key];
            const completo = meta !== null && value >= meta;
            return (
              <Link key={key} href={href} className="group">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {completo && <CheckCircle2 className="h-4 w-4 text-success" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-2xl font-semibold tabular-nums tracking-tight">
                        {value}
                      </span>
                      {meta !== null && (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          / {meta}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type TopProveedor = {
  proveedorId: number | null;
  nombre: string;
  total: number;
  cantidad: number;
  vencidas: number;
};

function TopProveedoresCard({ items }: { items: TopProveedor[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Top proveedores</CardTitle>
          </div>
          <CardDescription>Sin obligaciones pendientes</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground py-6 text-center">
          No hay erogaciones pendientes registradas.
        </CardContent>
      </Card>
    );
  }
  const max = Math.max(...items.map((i) => i.total));
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Top proveedores pendientes</CardTitle>
          </div>
          <Link
            href="/erogaciones?estado=pendiente"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Ver todos
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CardDescription>Por monto adeudado</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((p) => {
          const pct = max > 0 ? (p.total / max) * 100 : 0;
          return (
            <Link
              key={p.proveedorId ?? p.nombre}
              href={
                p.proveedorId
                  ? `/erogaciones?proveedor=${p.proveedorId}&estado=pendiente`
                  : '/erogaciones?estado=pendiente'
              }
              className="block group"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium truncate flex-1">
                  {p.nombre}
                </span>
                <span className="text-sm tabular-nums font-medium">
                  {fmtMonto(p.total)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={
                      p.vencidas > 0
                        ? 'h-full bg-danger transition-all'
                        : 'h-full bg-primary/60 transition-all'
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums w-20 text-right">
                  {p.cantidad} {p.cantidad === 1 ? 'factura' : 'facturas'}
                  {p.vencidas > 0 && (
                    <span className="text-danger ml-1">· {p.vencidas} venc</span>
                  )}
                </span>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

type AcuerdosData = Awaited<ReturnType<typeof getAcuerdosUrgentes>>;

function AcuerdosCard({ data }: { data: AcuerdosData }) {
  const hayVencidos = data.vencidos.length > 0;
  const hayPorVencer = data.porVencer.length > 0;
  const hayAlgo = hayVencidos || hayPorVencer;

  if (!hayAlgo && data.totalPendientes === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Handshake className="h-4 w-4 text-muted-foreground" />
            Acuerdos
          </CardTitle>
          <CardDescription>Sin promesas activas</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Cuando le prometas algo a un proveedor (diferimientos, pagos parciales),
            registralo en{' '}
            <Link href="/acuerdos" className="text-primary hover:underline">
              Acuerdos
            </Link>{' '}
            para tener trazabilidad.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={
        hayVencidos
          ? 'border-danger/40 bg-danger/5'
          : hayPorVencer
            ? 'border-warning/40 bg-warning/5'
            : ''
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Handshake
              className={
                hayVencidos ? 'h-4 w-4 text-danger' : 'h-4 w-4 text-warning'
              }
            />
            Acuerdos urgentes
          </CardTitle>
          <Link
            href="/acuerdos"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Ver todos
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CardDescription>
          {hayVencidos
            ? `${data.vencidos.length} ${data.vencidos.length === 1 ? 'promesa vencida' : 'promesas vencidas'}`
            : `${data.porVencer.length} ${data.porVencer.length === 1 ? 'vence' : 'vencen'} esta semana`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data.vencidos.slice(0, 3).map((a) => (
          <Link
            key={`v-${a.id}`}
            href={`/acuerdos?proveedor=${a.proveedorId}`}
            className="block p-2 rounded-md border border-danger/30 bg-card hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {a.proveedorNombre}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {a.compromiso}
                </p>
              </div>
              <Badge
                variant="outline"
                className="bg-danger/10 text-danger border-danger/30 text-[10px] shrink-0"
              >
                vencido
              </Badge>
            </div>
          </Link>
        ))}
        {!hayVencidos &&
          data.porVencer.slice(0, 3).map((a) => (
            <Link
              key={`p-${a.id}`}
              href={`/acuerdos?proveedor=${a.proveedorId}`}
              className="block p-2 rounded-md border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {a.proveedorNombre}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {a.compromiso}
                  </p>
                </div>
                {a.fechaCompromiso && (
                  <span className="text-[10px] text-warning shrink-0 tabular-nums">
                    {format(parseISO(a.fechaCompromiso), 'dd/MM')}
                  </span>
                )}
              </div>
            </Link>
          ))}
      </CardContent>
    </Card>
  );
}
