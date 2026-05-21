'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { bancosMediosPago } from '@/db/schema';
import { bancoSchema, type BancoInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function traducirError(msg: string): string {
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return 'Ya existe un banco con ese nombre';
  }
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'No se puede borrar: hay erogaciones, recurrencias o saldos cargados con este banco';
  }
  return msg;
}

function normalizar(input: BancoInput) {
  return {
    nombre: input.nombre,
    tipo: input.tipo,
    saldoActual: input.saldoActual && input.saldoActual !== '' ? input.saldoActual : null,
    moneda: input.moneda,
    activo: input.activo,
  };
}

export async function crearBanco(input: BancoInput): Promise<ActionResult> {
  const parsed = bancoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(bancosMediosPago).values(normalizar(parsed.data));
    revalidatePath('/bancos');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function editarBanco(id: number, input: BancoInput): Promise<ActionResult> {
  const parsed = bancoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db
      .update(bancosMediosPago)
      .set(normalizar(parsed.data))
      .where(eq(bancosMediosPago.id, id));
    revalidatePath('/bancos');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function borrarBanco(id: number): Promise<ActionResult> {
  try {
    await db.delete(bancosMediosPago).where(eq(bancosMediosPago.id, id));
    revalidatePath('/bancos');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}
