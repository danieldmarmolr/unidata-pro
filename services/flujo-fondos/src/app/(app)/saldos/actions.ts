'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { bancosMediosPago, saldosIniciales } from '@/db/schema';
import {
  BANCO_CONSOLIDADO_NOMBRE,
  saldoConsolidadoFormSchema,
  saldoFormSchema,
  type SaldoConsolidadoInput,
  type SaldoInput,
} from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function cargarSaldo(input: SaldoInput): Promise<ActionResult> {
  const parsed = saldoFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    // El indice unico esta sobre (fecha, banco_id). Si ya hay uno con la
    // misma fecha y banco, lo actualizamos en vez de insertar.
    const existente = await db
      .select({ id: saldosIniciales.id })
      .from(saldosIniciales)
      .where(
        and(
          eq(saldosIniciales.bancoId, parsed.data.bancoId),
          eq(saldosIniciales.fecha, parsed.data.fecha),
        ),
      )
      .limit(1);

    if (existente.length > 0) {
      await db
        .update(saldosIniciales)
        .set({ saldo: parsed.data.saldo, fuente: parsed.data.fuente })
        .where(eq(saldosIniciales.id, existente[0].id));
    } else {
      await db.insert(saldosIniciales).values({
        bancoId: parsed.data.bancoId,
        fecha: parsed.data.fecha,
        saldo: parsed.data.saldo,
        fuente: parsed.data.fuente,
      });
    }

    revalidatePath('/saldos');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function obtenerOCrearBancoConsolidado(): Promise<number> {
  const existente = await db
    .select({ id: bancosMediosPago.id })
    .from(bancosMediosPago)
    .where(eq(bancosMediosPago.nombre, BANCO_CONSOLIDADO_NOMBRE))
    .limit(1);
  if (existente.length > 0) return existente[0].id;
  const [creado] = await db
    .insert(bancosMediosPago)
    .values({
      nombre: BANCO_CONSOLIDADO_NOMBRE,
      tipo: 'otro',
      moneda: 'ARS',
      activo: true,
    })
    .returning({ id: bancosMediosPago.id });
  return creado.id;
}

export async function cargarSaldoConsolidado(
  input: SaldoConsolidadoInput,
): Promise<ActionResult> {
  const parsed = saldoConsolidadoFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('. '),
    };
  }
  try {
    const bancoId = await obtenerOCrearBancoConsolidado();
    const existente = await db
      .select({ id: saldosIniciales.id })
      .from(saldosIniciales)
      .where(
        and(
          eq(saldosIniciales.bancoId, bancoId),
          eq(saldosIniciales.fecha, parsed.data.fecha),
        ),
      )
      .limit(1);
    if (existente.length > 0) {
      await db
        .update(saldosIniciales)
        .set({ saldo: parsed.data.saldo, fuente: 'manual' })
        .where(eq(saldosIniciales.id, existente[0].id));
    } else {
      await db.insert(saldosIniciales).values({
        bancoId,
        fecha: parsed.data.fecha,
        saldo: parsed.data.saldo,
        fuente: 'manual',
      });
    }
    revalidatePath('/saldos');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function borrarSaldo(id: number): Promise<ActionResult> {
  try {
    await db.delete(saldosIniciales).where(eq(saldosIniciales.id, id));
    revalidatePath('/saldos');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
