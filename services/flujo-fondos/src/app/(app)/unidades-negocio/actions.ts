'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { unidadesNegocio } from '@/db/schema';
import { unidadNegocioSchema, type UnidadNegocioInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function traducirError(msg: string): string {
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return 'Ya existe una unidad de negocio con ese nombre';
  }
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'No se puede borrar: hay facturacion cargada a esta unidad';
  }
  return msg;
}

export async function crearUnidadNegocio(input: UnidadNegocioInput): Promise<ActionResult> {
  const parsed = unidadNegocioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(unidadesNegocio).values(parsed.data);
    revalidatePath('/unidades-negocio');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function editarUnidadNegocio(
  id: number,
  input: UnidadNegocioInput,
): Promise<ActionResult> {
  const parsed = unidadNegocioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.update(unidadesNegocio).set(parsed.data).where(eq(unidadesNegocio.id, id));
    revalidatePath('/unidades-negocio');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function borrarUnidadNegocio(id: number): Promise<ActionResult> {
  try {
    await db.delete(unidadesNegocio).where(eq(unidadesNegocio.id, id));
    revalidatePath('/unidades-negocio');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}
