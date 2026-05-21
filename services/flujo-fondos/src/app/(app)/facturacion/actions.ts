'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { facturacionDiaria } from '@/db/schema';
import { facturacionSchema, type FacturacionInput } from './schema';

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidar() {
  revalidatePath('/facturacion');
  revalidatePath('/promedios');
  revalidatePath('/proyeccion');
  revalidatePath('/calendario');
  revalidatePath('/precision');
  revalidatePath('/');
}

export async function crearFacturacion(input: FacturacionInput): Promise<ActionResult> {
  const parsed = facturacionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    // Si ya existe (fecha+unidad+empresa) hacemos update
    const empresaCond =
      parsed.data.empresaId === null || parsed.data.empresaId === undefined
        ? sql`${facturacionDiaria.empresaId} IS NULL`
        : eq(facturacionDiaria.empresaId, parsed.data.empresaId);
    const existente = await db
      .select({ id: facturacionDiaria.id })
      .from(facturacionDiaria)
      .where(
        and(
          eq(facturacionDiaria.fecha, parsed.data.fecha),
          eq(facturacionDiaria.unidadNegocioId, parsed.data.unidadNegocioId),
          empresaCond,
        ),
      )
      .limit(1);
    if (existente.length > 0) {
      await db
        .update(facturacionDiaria)
        .set({
          monto: parsed.data.monto,
          esEventoPuntual: parsed.data.esEventoPuntual ?? false,
          origen: 'manual',
        })
        .where(eq(facturacionDiaria.id, existente[0].id));
    } else {
      await db.insert(facturacionDiaria).values({
        fecha: parsed.data.fecha,
        unidadNegocioId: parsed.data.unidadNegocioId,
        empresaId: parsed.data.empresaId ?? null,
        monto: parsed.data.monto,
        esEventoPuntual: parsed.data.esEventoPuntual ?? false,
        esReal: true,
        origen: 'manual',
      });
    }
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editarFacturacion(
  id: number,
  input: FacturacionInput,
): Promise<ActionResult> {
  const parsed = facturacionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  try {
    await db
      .update(facturacionDiaria)
      .set({
        fecha: parsed.data.fecha,
        unidadNegocioId: parsed.data.unidadNegocioId,
        empresaId: parsed.data.empresaId ?? null,
        monto: parsed.data.monto,
        esEventoPuntual: parsed.data.esEventoPuntual ?? false,
      })
      .where(eq(facturacionDiaria.id, id));
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function borrarFacturacion(id: number): Promise<ActionResult> {
  try {
    await db.delete(facturacionDiaria).where(eq(facturacionDiaria.id, id));
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
