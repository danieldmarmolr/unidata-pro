'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { ingresosPuntuales } from '@/db/schema';
import { ingresoPuntualSchema, type IngresoPuntualInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidar() {
  revalidatePath('/ingresos-puntuales');
  revalidatePath('/proyeccion');
  revalidatePath('/calendario');
  revalidatePath('/');
}

export async function crearIngresoPuntual(
  input: IngresoPuntualInput,
): Promise<ActionResult> {
  const parsed = ingresoPuntualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(ingresosPuntuales).values({
      fecha: parsed.data.fecha,
      descripcion: parsed.data.descripcion,
      monto: parsed.data.monto,
      empresaId: parsed.data.empresaId,
      bancoId: parsed.data.bancoId ?? null,
      categoria: parsed.data.categoria ?? null,
      notas: parsed.data.notas ?? null,
      origen: 'manual',
    });
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editarIngresoPuntual(
  id: number,
  input: IngresoPuntualInput,
): Promise<ActionResult> {
  const parsed = ingresoPuntualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db
      .update(ingresosPuntuales)
      .set({
        fecha: parsed.data.fecha,
        descripcion: parsed.data.descripcion,
        monto: parsed.data.monto,
        empresaId: parsed.data.empresaId,
        bancoId: parsed.data.bancoId ?? null,
        categoria: parsed.data.categoria ?? null,
        notas: parsed.data.notas ?? null,
        updatedAt: new Date(),
      })
      .where(eq(ingresosPuntuales.id, id));
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function borrarIngresoPuntual(id: number): Promise<ActionResult> {
  try {
    await db.delete(ingresosPuntuales).where(eq(ingresosPuntuales.id, id));
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
