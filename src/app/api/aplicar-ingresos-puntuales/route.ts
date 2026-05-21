import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { ingresosPuntuales } from '@/db/schema';
import type { IngresoPuntualPlantilla } from '../parsear-ingresos-puntuales/route';

export const dynamic = 'force-dynamic';

export type AplicarPlantillaIngrPuntResult =
  | { ok: true; insertadas: number; salteadas: number; salteadasPorDuplicado: number }
  | { ok: false; error: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<AplicarPlantillaIngrPuntResult>> {
  console.log('[aplicar-ingresos-puntuales] INICIO');
  try {
    const body = (await req.json()) as { filas: IngresoPuntualPlantilla[] };
    const filas = body.filas ?? [];
    console.log('[aplicar-ingresos-puntuales] filas recibidas:', filas.length);

    const validas = filas.filter(
      (f) => f.errores.length === 0 && f.empresaId && !f.yaExiste,
    );
    const salteadasPorDuplicado = filas.filter(
      (f) => f.errores.length === 0 && f.yaExiste,
    ).length;
    const salteadas = filas.length - validas.length;

    const BATCH = 100;
    let insertadas = 0;
    for (let i = 0; i < validas.length; i += BATCH) {
      const batch = validas.slice(i, i + BATCH);
      await db.insert(ingresosPuntuales).values(
        batch.map((f) => ({
          fecha: f.fecha,
          descripcion: f.descripcion,
          monto: f.monto,
          empresaId: f.empresaId!,
          bancoId: f.bancoId,
          categoria: f.categoria,
          notas: f.notas,
          origen: 'plantilla-ingresos-puntuales',
          metadata: sql`${JSON.stringify({
            origen: 'plantilla-ingresos-puntuales',
            filaExcel: f.filaExcel,
          })}::jsonb`,
        })),
      );
      insertadas += batch.length;
    }

    revalidatePath('/ingresos-puntuales');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    console.log('[aplicar-ingresos-puntuales] OK:', insertadas, 'insertadas');
    return NextResponse.json({
      ok: true,
      insertadas,
      salteadas,
      salteadasPorDuplicado,
    });
  } catch (e) {
    console.error('[aplicar-ingresos-puntuales] error:', e);
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
