'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { proveedores } from '@/db/schema';
import { proveedorSchema, type ProveedorInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function traducirError(msg: string): string {
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'No se puede borrar: hay erogaciones o recurrencias cargadas a este proveedor';
  }
  return msg;
}

function normalizar(input: ProveedorInput) {
  const tags = (input.tagsRaw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const contacto: { nombre?: string; email?: string; telefono?: string } = {};
  if (input.contactoNombre) contacto.nombre = input.contactoNombre;
  if (input.contactoEmail) contacto.email = input.contactoEmail;
  if (input.contactoTelefono) contacto.telefono = input.contactoTelefono;

  return {
    nombre: input.nombre,
    cuit: input.cuit || null,
    prioridad: input.prioridad,
    saldoPendiente:
      input.saldoPendiente && input.saldoPendiente !== '' ? input.saldoPendiente : '0',
    notas: input.notas || null,
    tags,
    contacto,
  };
}

export async function crearProveedor(input: ProveedorInput): Promise<ActionResult> {
  const parsed = proveedorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db.insert(proveedores).values(normalizar(parsed.data));
    revalidatePath('/proveedores');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function editarProveedor(
  id: number,
  input: ProveedorInput,
): Promise<ActionResult> {
  const parsed = proveedorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db
      .update(proveedores)
      .set({ ...normalizar(parsed.data), updatedAt: new Date() })
      .where(eq(proveedores.id, id));
    revalidatePath('/proveedores');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function borrarProveedor(id: number): Promise<ActionResult> {
  try {
    await db.delete(proveedores).where(eq(proveedores.id, id));
    revalidatePath('/proveedores');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}
