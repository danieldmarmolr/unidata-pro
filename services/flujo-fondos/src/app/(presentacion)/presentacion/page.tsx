import { addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  acuerdos,
  bancosMediosPago,
  erogaciones,
  proveedores,
  saldosIniciales,
} from '@/db/schema';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import {
  proyectarSaldo,
  resumirProyeccion,
  type ErogacionFlujo,
} from '../../(app)/proyeccion/calcular';
import { PresentacionClient } from './presentacion-client';

export const dynamic = 'force-dynamic';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getDatos() {
  const hoy = new Date();
  const hoyStr = isoDate(hoy);
  const en7Str = isoDate(addDays(hoy, 7));
  const en30Str = isoDate(addDays(hoy, 29));

  // Saldo inicial consolidado
  const saldosRows = await db
    .select({
      bancoId: saldosIniciales.bancoId,
      fecha: saldosIniciales.fecha,
      saldo: saldosIniciales.saldo,
    })
    .from(saldosIniciales)
    .where(lte(saldosIniciales.fecha, hoyStr));
  const ultimo = new Map<number, { fecha: string; saldo: string }>();
  for (const s of saldosRows) {
    const prev = ultimo.get(s.bancoId);
    if (!prev || s.fecha > prev.fecha) ultimo.set(s.bancoId, { fecha: s.fecha, saldo: s.saldo });
  }
  const saldoInicial = Array.from(ultimo.values()).reduce(
    (a, x) => a + Number(x.saldo),
    0,
  );

  // Sumas por estado de erogacion
  const porEstado = await db
    .select({
      estado: erogaciones.estado,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .groupBy(erogaciones.estado);

  // Atrasadas
  const [atrasadas] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .where(and(eq(erogaciones.estado, 'pendiente'), lte(erogaciones.fechaPago, hoyStr)));

  // Pagos críticos en próximos 7 días
  const criticosProximos = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      proveedorNombre: proveedores.nombre,
    })
    .from(erogaciones)
    .leftJoin(proveedores, eq(proveedores.id, erogaciones.proveedorId))
    .where(
      and(
        eq(erogaciones.estado, 'pendiente'),
        eq(erogaciones.esCritico, true),
        gte(erogaciones.fechaPago, hoyStr),
        lte(erogaciones.fechaPago, en7Str),
      ),
    )
    .orderBy(asc(erogaciones.fechaPago))
    .limit(5);

  // Acuerdos vencidos
  const acuerdosVencidos = await db
    .select({
      id: acuerdos.id,
      proveedorNombre: proveedores.nombre,
      compromiso: acuerdos.compromiso,
      fechaCompromiso: acuerdos.fechaCompromiso,
    })
    .from(acuerdos)
    .innerJoin(proveedores, eq(proveedores.id, acuerdos.proveedorId))
    .where(and(eq(acuerdos.estado, 'pendiente'), lte(acuerdos.fechaCompromiso, hoyStr)))
    .orderBy(asc(acuerdos.fechaCompromiso))
    .limit(3);

  // Bancos count
  const [{ n: bancosCount }] = await db.select({ n: count() }).from(bancosMediosPago);

  // Proyeccion de saldo 30d
  const { promedios } = await calcularProyeccionTodas({ referencia: hoy });
  const erogs30 = await db
    .select({
      fechaPago: erogaciones.fechaPago,
      monto: erogaciones.monto,
      estado: erogaciones.estado,
      esCritico: erogaciones.esCritico,
    })
    .from(erogaciones)
    .where(and(gte(erogaciones.fechaPago, hoyStr), lte(erogaciones.fechaPago, en30Str)));
  const erogsCalc: ErogacionFlujo[] = erogs30.map((e) => ({
    fechaPago: e.fechaPago,
    monto: e.monto,
    estado: e.estado,
    esCritico: e.esCritico,
  }));
  const diasProy = proyectarSaldo({
    saldoInicial,
    fechaDesde: hoy,
    diasHorizonte: 30,
    erogaciones: erogsCalc,
    promedios,
    umbralEstrenimiento: 0,
  });
  const resumenProy = resumirProyeccion(saldoInicial, diasProy);

  const pendienteTotal = Number(
    porEstado.find((p) => p.estado === 'pendiente')?.total ?? '0',
  );

  return {
    saldoInicial,
    tieneSaldoInicial: ultimo.size > 0,
    resumenProy,
    diasProyectados: diasProy.map((d) => ({
      fechaISO: d.fechaISO,
      saldo: d.saldoAperturaCierre,
      esEstrenimiento: d.esEstrenimiento,
    })),
    pendienteTotal,
    atrasadasMonto: Number(atrasadas?.total ?? '0'),
    atrasadasCantidad: atrasadas?.cantidad ?? 0,
    criticosProximos,
    acuerdosVencidos,
    bancosCount,
    fecha: format(hoy, "EEEE d 'de' MMMM 'de' yyyy", { locale: es }),
  };
}

export default async function PresentacionPage() {
  const data = await getDatos();
  return <PresentacionClient data={data} />;
}
