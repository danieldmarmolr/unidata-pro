'use server';

import { addDays } from 'date-fns';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  bancosMediosPago,
  erogaciones,
  ingresosPuntuales,
  saldosIniciales,
} from '@/db/schema';
import {
  calcularDiasAtraso,
  HORIZONTE_BUSQUEDA_DIAS,
  sugerirFechasPagosAtrasados,
  type ErogacionFutura,
  type IngresoPuntualFuturo,
  type PagoAtrasadoInput,
  type PrioridadAtraso,
  type SugerenciaResultado,
} from '@/lib/pagos-atrasados';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import {
  cambiarPrioridadSchema,
  colchonSchema,
  idsSchema,
  paresSugerenciaSchema,
} from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function obtenerSaldoConsolidado(hoyISO: string): Promise<number> {
  const bancos = await db
    .select({ id: bancosMediosPago.id })
    .from(bancosMediosPago);
  const todos = await db
    .select({
      bancoId: saldosIniciales.bancoId,
      fecha: saldosIniciales.fecha,
      saldo: saldosIniciales.saldo,
    })
    .from(saldosIniciales)
    .where(lte(saldosIniciales.fecha, hoyISO));
  const ultimoPorBanco = new Map<number, { fecha: string; saldo: string }>();
  for (const s of todos) {
    const prev = ultimoPorBanco.get(s.bancoId);
    if (!prev || s.fecha > prev.fecha) {
      ultimoPorBanco.set(s.bancoId, { fecha: s.fecha, saldo: s.saldo });
    }
  }
  let total = 0;
  for (const b of bancos) {
    const reg = ultimoPorBanco.get(b.id);
    if (reg) total += Number(reg.saldo);
  }
  return total;
}

/**
 * Calcula las sugerencias para los IDs dados sin guardar nada.
 * Reusa el contexto (saldo, promedios, ingresos puntuales, erogaciones futuras
 * excluyendo los IDs candidatos) y corre el algoritmo.
 */
export async function calcularSugerencias(
  ids: number[],
  colchon: number,
): Promise<
  | { ok: true; sugerencias: SugerenciaResultado[] }
  | { ok: false; error: string }
> {
  const parseIds = idsSchema.safeParse({ ids });
  if (!parseIds.success) {
    return {
      ok: false,
      error: parseIds.error.issues.map((i) => i.message).join('. '),
    };
  }
  const parseCol = colchonSchema.safeParse({ colchon });
  if (!parseCol.success) {
    return {
      ok: false,
      error: parseCol.error.issues.map((i) => i.message).join('. '),
    };
  }

  try {
    const hoy = new Date();
    const hoyISO = isoDate(hoy);
    const finISO = isoDate(addDays(hoy, HORIZONTE_BUSQUEDA_DIAS - 1));

    const seleccionados = await db
      .select({
        id: erogaciones.id,
        fechaPago: erogaciones.fechaPago,
        monto: erogaciones.monto,
        prioridadAtraso: erogaciones.prioridadAtraso,
        estado: erogaciones.estado,
      })
      .from(erogaciones)
      .where(inArray(erogaciones.id, ids));

    const atrasados = seleccionados.filter(
      (e) =>
        (e.estado === 'pendiente' || e.estado === 'en_curso') &&
        e.fechaPago < hoyISO,
    );

    if (atrasados.length === 0) {
      return { ok: true, sugerencias: [] };
    }

    const pagosInput: PagoAtrasadoInput[] = atrasados.map((e) => ({
      id: e.id,
      fechaPago: e.fechaPago,
      monto: Number(e.monto),
      prioridad:
        e.prioridadAtraso === 'laxo'
          ? ('laxo' as PrioridadAtraso)
          : ('normal' as PrioridadAtraso),
      diasAtraso: calcularDiasAtraso(e.fechaPago, hoy),
    }));

    const { promedios } = await calcularProyeccionTodas({ referencia: hoy });
    const saldoInicial = await obtenerSaldoConsolidado(hoyISO);

    const idsAtrasadosSeleccionados = atrasados.map((a) => a.id);
    // Erogaciones futuras: las que tienen fecha efectiva (tentativa o real)
    // dentro del horizonte. Excluyo los seleccionados porque los voy a
    // colocar yo en la simulacion.
    const futuras = await db
      .select({
        id: erogaciones.id,
        fechaPago: erogaciones.fechaPago,
        fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
        monto: erogaciones.monto,
        estado: erogaciones.estado,
      })
      .from(erogaciones)
      .where(
        and(
          ne(erogaciones.estado, 'pagado'),
          ne(erogaciones.estado, 'cancelado'),
          ne(erogaciones.estado, 'rechazado'),
          eq(erogaciones.oculto, false),
          notInArray(erogaciones.id, idsAtrasadosSeleccionados),
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
      );

    const erogsFuturas: ErogacionFutura[] = futuras.map((e) => ({
      fechaPago: e.fechaSugeridaTentativa ?? e.fechaPago,
      monto: Number(e.monto),
      estado: e.estado,
    }));

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
    const ingPuntForCalc: IngresoPuntualFuturo[] = ingPunt.map((x) => ({
      fecha: x.fecha,
      monto: Number(x.monto),
    }));

    const sugerencias = sugerirFechasPagosAtrasados({
      pagos: pagosInput,
      saldoInicial,
      hoy,
      colchon,
      promedios,
      erogacionesFuturas: erogsFuturas,
      ingresosPuntuales: ingPuntForCalc,
    });

    return { ok: true, sugerencias };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cambia la prioridad de atraso de una erogacion (normal / laxo).
 */
export async function cambiarPrioridad(
  id: number,
  prioridad: PrioridadAtraso,
): Promise<ActionResult> {
  const parsed = cambiarPrioridadSchema.safeParse({ id, prioridad });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('. '),
    };
  }
  try {
    await db
      .update(erogaciones)
      .set({ prioridadAtraso: parsed.data.prioridad, updatedAt: new Date() })
      .where(eq(erogaciones.id, parsed.data.id));
    revalidatePath('/pagos-atrasados');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Aplica los pares (id, fechaSugerida) como fecha_sugerida_tentativa.
 * El cliente envia los pares ya calculados — esta funcion solo persiste.
 */
export async function aplicarTentativas(
  pares: Array<{ id: number; fechaSugerida: string }>,
): Promise<ActionResult> {
  const parsed = paresSugerenciaSchema.safeParse({ pares });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('. '),
    };
  }
  try {
    for (const par of parsed.data.pares) {
      await db
        .update(erogaciones)
        .set({
          fechaSugeridaTentativa: par.fechaSugerida,
          updatedAt: new Date(),
        })
        .where(eq(erogaciones.id, par.id));
    }
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Confirma las tentativas: copia fecha_sugerida_tentativa a fecha_pago y borra
 * la tentativa. Si ids esta vacio, confirma TODAS las tentativas activas.
 */
export async function confirmarTentativas(
  ids: number[] = [],
): Promise<ActionResult> {
  try {
    const filtroIds =
      ids.length > 0 ? inArray(erogaciones.id, ids) : undefined;
    const condiciones = filtroIds
      ? and(isNotNull(erogaciones.fechaSugeridaTentativa), filtroIds)
      : isNotNull(erogaciones.fechaSugeridaTentativa);

    await db
      .update(erogaciones)
      .set({
        fechaPago: sql`${erogaciones.fechaSugeridaTentativa}`,
        fechaSugeridaTentativa: null,
        updatedAt: new Date(),
      })
      .where(condiciones);

    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cancela las tentativas: simplemente pone fecha_sugerida_tentativa a NULL.
 * Si ids esta vacio, cancela TODAS las tentativas activas.
 */
export async function cancelarTentativas(
  ids: number[] = [],
): Promise<ActionResult> {
  try {
    const filtroIds =
      ids.length > 0 ? inArray(erogaciones.id, ids) : undefined;
    const condiciones = filtroIds
      ? and(isNotNull(erogaciones.fechaSugeridaTentativa), filtroIds)
      : isNotNull(erogaciones.fechaSugeridaTentativa);

    await db
      .update(erogaciones)
      .set({ fechaSugeridaTentativa: null, updatedAt: new Date() })
      .where(condiciones);

    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
