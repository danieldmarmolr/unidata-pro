import { differenceInCalendarDays } from 'date-fns';
import { and, asc, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  empresas,
  erogaciones,
  ingresosPuntuales,
  saldosIniciales,
} from '@/db/schema';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import {
  generarDiasCalendario,
  isoMes,
  parseMesParam,
  rangoMes,
  rangoVistaMes,
  resumirMes,
  type ErogacionDia,
  type IngresoPuntualDia,
} from './calcular';
import { CalendarioClient } from './calendario-client';
import { calendarioFiltrosSchema } from './schema';
import {
  proyectarSaldo,
  type ErogacionFlujo,
  type IngresoPuntualFlujo,
} from '../proyeccion/calcular';

export const dynamic = 'force-dynamic';

const ESTADOS_ACTIVOS: Array<'pendiente' | 'en_curso' | 'pagado'> = [
  'pendiente',
  'en_curso',
  'pagado',
];

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = calendarioFiltrosSchema.parse({
    mes: typeof sp.mes === 'string' ? sp.mes : undefined,
    empresa: sp.empresa,
  });

  const ahora = new Date();
  const mes = parseMesParam(filtros.mes, ahora);
  const { inicio, fin } = rangoMes(mes);

  // Cargar todas las empresas (para selector + nombres en detalle)
  const todasEmpresas = await db
    .select({ id: empresas.id, nombre: empresas.nombre })
    .from(empresas)
    .orderBy(asc(empresas.nombre));

  // Promedios para proyectar ingresos
  const { unidades, promedios } = await calcularProyeccionTodas({ referencia: ahora });

  // Erogaciones de la vista (incluye días del mes anterior/siguiente
  // que se muestran en la grilla para llenar 7xN)
  const condEmpresa =
    filtros.empresa !== undefined ? eq(erogaciones.empresaId, filtros.empresa) : undefined;

  const rows = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      moneda: erogaciones.moneda,
      estado: erogaciones.estado,
      esCritico: erogaciones.esCritico,
      empresaId: erogaciones.empresaId,
      bancoId: erogaciones.bancoId,
      proveedorId: erogaciones.proveedorId,
    })
    .from(erogaciones)
    .where(
      and(
        eq(erogaciones.oculto, false),
        or(
          and(
            gte(erogaciones.fechaPago, inicio),
            lte(erogaciones.fechaPago, fin),
          ),
          and(
            isNotNull(erogaciones.fechaSugeridaTentativa),
            gte(erogaciones.fechaSugeridaTentativa, inicio),
            lte(erogaciones.fechaSugeridaTentativa, fin),
          ),
        ),
        inArray(erogaciones.estado, ESTADOS_ACTIVOS),
        condEmpresa,
      ),
    )
    .orderBy(asc(erogaciones.fechaPago));

  const erogsList: ErogacionDia[] = rows.map((r) => ({
    id: r.id,
    fechaPago: r.fechaSugeridaTentativa ?? r.fechaPago,
    fechaPagoOriginal: r.fechaPago,
    descripcion: r.descripcion,
    monto: r.monto,
    moneda: r.moneda,
    estado: r.estado,
    esCritico: r.esCritico,
    empresaId: r.empresaId,
    bancoId: r.bancoId,
    proveedorId: r.proveedorId,
    esTentativa: r.fechaSugeridaTentativa !== null,
  }));

  // Ingresos puntuales del rango visible
  const ingPuntRows = await db
    .select({
      id: ingresosPuntuales.id,
      fecha: ingresosPuntuales.fecha,
      descripcion: ingresosPuntuales.descripcion,
      monto: ingresosPuntuales.monto,
      categoria: ingresosPuntuales.categoria,
    })
    .from(ingresosPuntuales)
    .where(
      and(
        gte(ingresosPuntuales.fecha, inicio),
        lte(ingresosPuntuales.fecha, fin),
      ),
    )
    .orderBy(asc(ingresosPuntuales.fecha));
  const ingPuntList: IngresoPuntualDia[] = ingPuntRows.map((r) => ({
    id: r.id,
    fecha: r.fecha,
    descripcion: r.descripcion,
    monto: r.monto,
    categoria: r.categoria,
  }));

  const dias = generarDiasCalendario(mes, erogsList, promedios, ahora, ingPuntList);
  const resumen = resumirMes(dias);
  const mesActualISO = isoMes(mes);

  // Saldo proyectado: solo para dias de hoy en adelante dentro del rango visible.
  const { fin: finVistaDate } = rangoVistaMes(mes);
  const finVistaISO = (() => {
    const y = finVistaDate.getFullYear();
    const m = String(finVistaDate.getMonth() + 1).padStart(2, '0');
    const d = String(finVistaDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const hoyISOStr = (() => {
    const y = ahora.getFullYear();
    const m = String(ahora.getMonth() + 1).padStart(2, '0');
    const d = String(ahora.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  let saldoPorFecha: Record<string, number> = {};
  let saldoInicial = 0;
  let saldoDisponible = false;
  if (finVistaISO >= hoyISOStr) {
    const saldosRows = await db
      .select({
        bancoId: saldosIniciales.bancoId,
        fecha: saldosIniciales.fecha,
        saldo: saldosIniciales.saldo,
      })
      .from(saldosIniciales)
      .where(lte(saldosIniciales.fecha, hoyISOStr))
      .orderBy(asc(saldosIniciales.fecha));
    const ultimo = new Map<number, { fecha: string; saldo: string }>();
    for (const s of saldosRows) {
      const prev = ultimo.get(s.bancoId);
      if (!prev || s.fecha > prev.fecha) ultimo.set(s.bancoId, { fecha: s.fecha, saldo: s.saldo });
    }
    if (ultimo.size > 0) {
      saldoInicial = Array.from(ultimo.values()).reduce((a, x) => a + Number(x.saldo), 0);
      saldoDisponible = true;

      const horizonteDias = differenceInCalendarDays(finVistaDate, ahora) + 1;
      // Erogaciones del horizonte (mismas que ya leimos pueden no alcanzar; releemos)
      const erogsHorizonte = await db
        .select({
          fechaPago: erogaciones.fechaPago,
          fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
          monto: erogaciones.monto,
          estado: erogaciones.estado,
          esCritico: erogaciones.esCritico,
        })
        .from(erogaciones)
        .where(
          and(
            eq(erogaciones.oculto, false),
            or(
              and(
                gte(erogaciones.fechaPago, hoyISOStr),
                lte(erogaciones.fechaPago, finVistaISO),
              ),
              and(
                isNotNull(erogaciones.fechaSugeridaTentativa),
                gte(erogaciones.fechaSugeridaTentativa, hoyISOStr),
                lte(erogaciones.fechaSugeridaTentativa, finVistaISO),
              ),
            ),
          ),
        );
      const erogsCalc: ErogacionFlujo[] = erogsHorizonte.map((e) => ({
        fechaPago: e.fechaSugeridaTentativa ?? e.fechaPago,
        monto: e.monto,
        estado: e.estado,
        esCritico: e.esCritico,
      }));
      const ingPuntHorizonte = await db
        .select({
          fecha: ingresosPuntuales.fecha,
          monto: ingresosPuntuales.monto,
        })
        .from(ingresosPuntuales)
        .where(
          and(
            gte(ingresosPuntuales.fecha, hoyISOStr),
            lte(ingresosPuntuales.fecha, finVistaISO),
          ),
        );
      const ingPuntCalc: IngresoPuntualFlujo[] = ingPuntHorizonte.map((x) => ({
        fecha: x.fecha,
        monto: x.monto,
      }));
      const diasProy = proyectarSaldo({
        saldoInicial,
        fechaDesde: ahora,
        diasHorizonte: horizonteDias,
        erogaciones: erogsCalc,
        promedios,
        ingresosPuntuales: ingPuntCalc,
        umbralEstrenimiento: 0,
      });
      saldoPorFecha = Object.fromEntries(diasProy.map((d) => [d.fechaISO, d.saldoAperturaCierre]));
    }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendario de caja</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Vista mensual del flujo de fondos. Combina los ingresos proyectados (promedios
          ponderados por dia de semana) con las erogaciones comprometidas. Los dias con
          flujo negativo se resaltan para detectar atascos a tiempo.
        </p>
      </div>

      <CalendarioClient
        dias={dias}
        resumen={resumen}
        mesActualISO={mesActualISO}
        empresas={todasEmpresas}
        unidades={unidades}
        filtros={filtros}
        saldoPorFecha={saldoPorFecha}
        saldoInicial={saldoInicial}
        saldoDisponible={saldoDisponible}
      />
    </div>
  );
}
