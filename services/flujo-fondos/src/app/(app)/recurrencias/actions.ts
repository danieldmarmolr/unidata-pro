'use server';

import { addDays, addMonths, addWeeks, addYears, parseISO } from 'date-fns';
import { and, eq, gte, lte } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { erogaciones, recurrencias } from '@/db/schema';
import { recurrenciaFormSchema, type RecurrenciaInput, type Frecuencia } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };
type GenerarResult = { ok: true; creadas: number; saltadas: number } | { ok: false; error: string };

function normalizar(input: RecurrenciaInput) {
  return {
    descripcion: input.descripcion,
    montoBase: input.montoBase,
    frecuencia: input.frecuencia,
    fechaInicio: input.fechaInicio,
    fechaFin: input.fechaFin && input.fechaFin !== '' ? input.fechaFin : null,
    cuotasTotales: input.cuotasTotales ?? null,
    proveedorId: input.proveedorId ?? null,
    empresaId: input.empresaId,
    bancoId: input.bancoId,
    activa: input.activa,
  };
}

export async function crearRecurrencia(input: RecurrenciaInput): Promise<ActionResult> {
  const parsed = recurrenciaFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(recurrencias).values(normalizar(parsed.data));
    revalidatePath('/recurrencias');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editarRecurrencia(
  id: number,
  input: RecurrenciaInput,
): Promise<ActionResult> {
  const parsed = recurrenciaFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.update(recurrencias).set(normalizar(parsed.data)).where(eq(recurrencias.id, id));
    revalidatePath('/recurrencias');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function borrarRecurrencia(id: number): Promise<ActionResult> {
  try {
    await db.delete(recurrencias).where(eq(recurrencias.id, id));
    revalidatePath('/recurrencias');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleActivaRecurrencia(
  id: number,
  activa: boolean,
): Promise<ActionResult> {
  try {
    await db.update(recurrencias).set({ activa }).where(eq(recurrencias.id, id));
    revalidatePath('/recurrencias');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function siguienteFecha(fecha: Date, frecuencia: Frecuencia): Date {
  switch (frecuencia) {
    case 'mensual':
      return addMonths(fecha, 1);
    case 'semanal':
      return addWeeks(fecha, 1);
    case 'quincenal':
      return addDays(fecha, 15);
    case 'trimestral':
      return addMonths(fecha, 3);
    case 'anual':
      return addYears(fecha, 1);
    case 'custom':
      return addMonths(fecha, 1); // fallback razonable
  }
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Genera erogaciones pendientes para una recurrencia en el rango [hoy, hoy + horizonteDias].
 * No duplica: si ya hay una erogacion con recurrenciaId=id y fechaPago dentro del rango
 * con el mismo monto, la salta.
 */
export async function generarErogacionesDeRecurrencia(
  id: number,
  horizonteDias: number = 90,
): Promise<GenerarResult> {
  try {
    const [rec] = await db.select().from(recurrencias).where(eq(recurrencias.id, id));
    if (!rec) return { ok: false, error: 'Recurrencia no encontrada' };
    if (!rec.activa) return { ok: false, error: 'La recurrencia esta desactivada' };
    if (!rec.montoBase) return { ok: false, error: 'La recurrencia no tiene monto base' };
    if (!rec.empresaId || !rec.bancoId)
      return { ok: false, error: 'Faltan empresa o banco asignados' };

    const hoy = new Date();
    const limite = addDays(hoy, horizonteDias);

    // Erogaciones existentes para esta recurrencia dentro del horizonte
    const existentes = await db
      .select({ fechaPago: erogaciones.fechaPago })
      .from(erogaciones)
      .where(
        and(
          eq(erogaciones.recurrenciaId, id),
          gte(erogaciones.fechaPago, isoDate(hoy)),
          lte(erogaciones.fechaPago, isoDate(limite)),
        ),
      );
    const fechasYaCreadas = new Set(existentes.map((e) => e.fechaPago));

    // Iterar desde fechaInicio sumando intervalos hasta superar el limite
    let cursor = parseISO(rec.fechaInicio);
    while (cursor < hoy) {
      cursor = siguienteFecha(cursor, rec.frecuencia);
    }

    const fechaFinReal = rec.fechaFin ? parseISO(rec.fechaFin) : null;
    const toInsert: Array<{
      fechaPago: string;
      descripcion: string;
      monto: string;
      empresaId: number;
      bancoId: number;
      proveedorId: number | null;
      recurrenciaId: number;
      esRecurrente: boolean;
      estado: 'pendiente';
    }> = [];

    let saltadas = 0;
    while (cursor <= limite) {
      if (fechaFinReal && cursor > fechaFinReal) break;
      const fechaISO = isoDate(cursor);
      if (fechasYaCreadas.has(fechaISO)) {
        saltadas++;
      } else {
        toInsert.push({
          fechaPago: fechaISO,
          descripcion: rec.descripcion,
          monto: rec.montoBase,
          empresaId: rec.empresaId,
          bancoId: rec.bancoId,
          proveedorId: rec.proveedorId,
          recurrenciaId: rec.id,
          esRecurrente: true,
          estado: 'pendiente',
        });
      }
      cursor = siguienteFecha(cursor, rec.frecuencia);
    }

    if (toInsert.length > 0) {
      await db.insert(erogaciones).values(toInsert);
    }

    revalidatePath('/recurrencias');
    revalidatePath('/erogaciones');
    revalidatePath('/calendario');
    return { ok: true, creadas: toInsert.length, saltadas };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
