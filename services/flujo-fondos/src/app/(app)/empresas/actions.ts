'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { empresas } from '@/db/schema';
import { empresaSchema, type EmpresaInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function traducirError(msg: string): string {
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return 'Ya existe una empresa con ese nombre';
  }
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'No se puede borrar: hay registros que dependen de esta empresa';
  }
  return msg;
}

export async function crearEmpresa(input: EmpresaInput): Promise<ActionResult> {
  const parsed = empresaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(empresas).values({
      nombre: parsed.data.nombre,
      cuit: parsed.data.cuit || null,
      activa: parsed.data.activa,
    });
    revalidatePath('/empresas');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function editarEmpresa(id: number, input: EmpresaInput): Promise<ActionResult> {
  const parsed = empresaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db
      .update(empresas)
      .set({
        nombre: parsed.data.nombre,
        cuit: parsed.data.cuit || null,
        activa: parsed.data.activa,
      })
      .where(eq(empresas.id, id));
    revalidatePath('/empresas');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function borrarEmpresa(id: number): Promise<ActionResult> {
  try {
    await db.delete(empresas).where(eq(empresas.id, id));
    revalidatePath('/empresas');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}
