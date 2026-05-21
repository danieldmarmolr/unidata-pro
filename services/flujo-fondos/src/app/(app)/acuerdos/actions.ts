'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { acuerdos } from '@/db/schema';
import { acuerdoFormSchema, type AcuerdoInput, type EstadoAcuerdo } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function normalizar(input: AcuerdoInput) {
  return {
    proveedorId: input.proveedorId,
    tipo: input.tipo,
    compromiso: input.compromiso,
    fechaCompromiso:
      input.fechaCompromiso && input.fechaCompromiso !== '' ? input.fechaCompromiso : null,
    montoCompromiso:
      input.montoCompromiso && input.montoCompromiso !== ''
        ? input.montoCompromiso
        : null,
    estado: input.estado,
    contexto: input.contexto && input.contexto !== '' ? input.contexto : null,
    erogacionId: input.erogacionId ?? null,
  };
}

export async function crearAcuerdo(input: AcuerdoInput): Promise<ActionResult> {
  const parsed = acuerdoFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(acuerdos).values(normalizar(parsed.data));
    revalidatePath('/acuerdos');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editarAcuerdo(id: number, input: AcuerdoInput): Promise<ActionResult> {
  const parsed = acuerdoFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    const datos = normalizar(parsed.data);
    // Si el estado cambia a cumplido/incumplido, marcar fecha_resolucion
    const fechaResolucion =
      datos.estado === 'pendiente' ? null : new Date();
    await db
      .update(acuerdos)
      .set({ ...datos, fechaResolucion })
      .where(eq(acuerdos.id, id));
    revalidatePath('/acuerdos');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function borrarAcuerdo(id: number): Promise<ActionResult> {
  try {
    await db.delete(acuerdos).where(eq(acuerdos.id, id));
    revalidatePath('/acuerdos');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cambiarEstadoAcuerdo(
  id: number,
  estado: EstadoAcuerdo,
): Promise<ActionResult> {
  try {
    const fechaResolucion = estado === 'pendiente' ? null : new Date();
    await db
      .update(acuerdos)
      .set({ estado, fechaResolucion })
      .where(eq(acuerdos.id, id));
    revalidatePath('/acuerdos');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
