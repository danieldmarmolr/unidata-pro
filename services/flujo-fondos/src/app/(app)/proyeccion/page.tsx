import { addDays, format } from 'date-fns';
import { and, asc, eq, gte, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  erogaciones,
  ingresosPuntuales,
  saldosIniciales,
} from '@/db/schema';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import {
  proyectarSaldo,
  resumirProyeccion,
  type ErogacionFlujo,
  type IngresoPuntualFlujo,
} from './calcular';
import { ProyeccionClient } from './proyeccion-client';
import { proyeccionFiltrosSchema } from './schema';

export const dynamic = 'force-dynamic';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function obtenerSaldoConsolidado(hoyISO: string): Promise<{
  saldoTotal: number;
  porBanco: { bancoId: number; bancoNombre: string; saldo: number; fecha: string }[];
}> {
  // Bancos para nombrarlos
  const bancos = await db
    .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
    .from(bancosMediosPago)
    .orderBy(asc(bancosMediosPago.nombre));

  // Todos los saldos iniciales <= hoy
  const todos = await db
    .select({
      bancoId: saldosIniciales.bancoId,
      fecha: saldosIniciales.fecha,
      saldo: saldosIniciales.saldo,
    })
    .from(saldosIniciales)
    .where(lte(saldosIniciales.fecha, hoyISO))
    .orderBy(asc(saldosIniciales.fecha));

  // Para cada banco, agarrar el saldo de fecha mas reciente
  const ultimoPorBanco = new Map<number, { fecha: string; saldo: string }>();
  for (const s of todos) {
    const prev = ultimoPorBanco.get(s.bancoId);
    if (!prev || s.fecha > prev.fecha) {
      ultimoPorBanco.set(s.bancoId, { fecha: s.fecha, saldo: s.saldo });
    }
  }

  const porBanco = bancos
    .map((b) => {
      const reg = ultimoPorBanco.get(b.id);
      if (!reg) return null;
      return {
        bancoId: b.id,
        bancoNombre: b.nombre,
        saldo: Number(reg.saldo),
        fecha: reg.fecha,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const saldoTotal = porBanco.reduce((a, b) => a + b.saldo, 0);
  return { saldoTotal, porBanco };
}

export default async function ProyeccionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = proyeccionFiltrosSchema.parse({
    horizonte: sp.horizonte,
    umbral: sp.umbral,
    saldoManual: sp.saldoManual,
  });

  const hoy = new Date();
  const hoyISO = isoDate(hoy);
  const finISO = isoDate(addDays(hoy, filtros.horizonte - 1));

  // Promedios
  const { promedios, unidades } = await calcularProyeccionTodas({ referencia: hoy });

  // Erogaciones del horizonte: o bien fecha_pago original cae en el rango,
  // o tienen una tentativa que cae en el rango. La fecha efectiva para la
  // proyeccion es: fecha_sugerida_tentativa si existe, sino fecha_pago.
  const erogs = await db
    .select({
      fechaPago: erogaciones.fechaPago,
      fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
      monto: erogaciones.monto,
      estado: erogaciones.estado,
      esCritico: erogaciones.esCritico,
      descripcion: erogaciones.descripcion,
      id: erogaciones.id,
    })
    .from(erogaciones)
    .where(
      and(
        eq(erogaciones.oculto, false),
        or(
          and(
            gte(erogaciones.fechaPago, hoyISO),
            lte(erogaciones.fechaPago, finISO),
          ),
          and(
            isNotNull(erogaciones.fechaSugeridaTentativa),
            gte(erogaciones.fechaSugeridaTentativa, hoyISO),
            lte(erogaciones.fechaSugeridaTentativa, finISO),
          ),
        ),
      ),
    )
    .orderBy(asc(erogaciones.fechaPago));

  const erogsForCalc: ErogacionFlujo[] = erogs.map((e) => ({
    fechaPago: e.fechaSugeridaTentativa ?? e.fechaPago,
    monto: e.monto,
    estado: e.estado,
    esCritico: e.esCritico,
  }));

  // Ingresos puntuales en el horizonte
  const ingPunt = await db
    .select({
      fecha: ingresosPuntuales.fecha,
      monto: ingresosPuntuales.monto,
    })
    .from(ingresosPuntuales)
    .where(
      and(
        gte(ingresosPuntuales.fecha, hoyISO),
        lte(ingresosPuntuales.fecha, finISO),
      ),
    );
  const ingPuntForCalc: IngresoPuntualFlujo[] = ingPunt.map((x) => ({
    fecha: x.fecha,
    monto: x.monto,
  }));

  // Saldo inicial
  const { saldoTotal: saldoAuto, porBanco } = await obtenerSaldoConsolidado(hoyISO);
  const saldoInicial =
    filtros.saldoManual !== undefined ? filtros.saldoManual : saldoAuto;

  const dias = proyectarSaldo({
    saldoInicial,
    fechaDesde: hoy,
    diasHorizonte: filtros.horizonte,
    erogaciones: erogsForCalc,
    promedios,
    ingresosPuntuales: ingPuntForCalc,
    umbralEstrenimiento: filtros.umbral,
  });

  const resumen = resumirProyeccion(saldoInicial, dias);

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Proyeccion de saldo</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Saldo consolidado proyectado dia a dia, partiendo del ultimo saldo registrado
          y aplicando ingresos esperados (promedios ponderados) menos egresos
          comprometidos. El umbral define cuando un saldo cuenta como
          &quot;estrenimiento del flujo&quot;.
        </p>
      </div>

      <ProyeccionClient
        dias={dias}
        resumen={resumen}
        saldoAuto={saldoAuto}
        porBanco={porBanco}
        unidadesCount={unidades.length}
        erogacionesCount={erogs.length}
        filtros={filtros}
        hoyISO={hoyISO}
        finISO={finISO}
        finLabel={format(addDays(hoy, filtros.horizonte - 1), 'dd/MM/yyyy')}
      />
    </div>
  );
}
