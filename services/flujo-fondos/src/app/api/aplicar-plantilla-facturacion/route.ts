import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { facturacionDiaria } from '@/db/schema';
import type { FacturacionPlantilla } from '../parsear-plantilla-facturacion/route';

export const dynamic = 'force-dynamic';

export type AplicarPlantillaFactResult =
  | { ok: true; insertadas: number; actualizadas: number; salteadas: number }
  | { ok: false; error: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<AplicarPlantillaFactResult>> {
  console.log('[aplicar-plantilla-facturacion] INICIO');
  try {
    const body = (await req.json()) as { filas: FacturacionPlantilla[] };
    const filas = body.filas ?? [];
    console.log('[aplicar-plantilla-facturacion] filas recibidas:', filas.length);

    const validas = filas.filter(
      (f) => f.errores.length === 0 && f.unidadNegocioId,
    );
    const salteadas = filas.length - validas.length;

    let insertadas = 0;
    let actualizadas = 0;

    for (const f of validas) {
      const existente = await db
        .select({ id: facturacionDiaria.id })
        .from(facturacionDiaria)
        .where(
          sql`${facturacionDiaria.fecha} = ${f.fecha}
              AND ${facturacionDiaria.unidadNegocioId} = ${f.unidadNegocioId!}
              AND ${
                f.empresaId === null
                  ? sql`${facturacionDiaria.empresaId} IS NULL`
                  : sql`${facturacionDiaria.empresaId} = ${f.empresaId}`
              }`,
        )
        .limit(1);

      if (existente.length > 0) {
        await db
          .update(facturacionDiaria)
          .set({
            monto: f.monto,
            esEventoPuntual: f.esEventoPuntual,
            origen: 'plantilla-facturacion',
          })
          .where(eq(facturacionDiaria.id, existente[0].id));
        actualizadas++;
      } else {
        await db.insert(facturacionDiaria).values({
          fecha: f.fecha,
          monto: f.monto,
          unidadNegocioId: f.unidadNegocioId!,
          empresaId: f.empresaId,
          esEventoPuntual: f.esEventoPuntual,
          esReal: true,
          origen: 'plantilla-facturacion',
        });
        insertadas++;
      }
    }

    revalidatePath('/');
    revalidatePath('/promedios');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/precision');
    revalidatePath('/facturacion');
    console.log(
      '[aplicar-plantilla-facturacion] OK:',
      insertadas,
      'ins,',
      actualizadas,
      'upd',
    );
    return NextResponse.json({ ok: true, insertadas, actualizadas, salteadas });
  } catch (e) {
    console.error('[aplicar-plantilla-facturacion] error:', e);
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
