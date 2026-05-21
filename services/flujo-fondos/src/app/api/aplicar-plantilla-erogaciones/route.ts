import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { erogaciones } from '@/db/schema';
import type { ErogacionPlantilla } from '../parsear-plantilla-erogaciones/route';

export const dynamic = 'force-dynamic';

export type AplicarPlantillaErogResult =
  | {
      ok: true;
      insertadas: number;
      salteadas: number;
      salteadasPorDuplicado: number;
    }
  | { ok: false; error: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<AplicarPlantillaErogResult>> {
  console.log('[aplicar-plantilla-erogaciones] INICIO');
  try {
    const body = (await req.json()) as { filas: ErogacionPlantilla[] };
    const filas = body.filas ?? [];
    console.log('[aplicar-plantilla-erogaciones] filas recibidas:', filas.length);

    const validas = filas.filter(
      (f) =>
        f.errores.length === 0 && f.empresaId && f.bancoId && !f.yaExiste,
    );
    const salteadasPorDuplicado = filas.filter(
      (f) => f.errores.length === 0 && f.yaExiste,
    ).length;
    const salteadas = filas.length - validas.length;

    const BATCH = 100;
    let insertadas = 0;
    for (let i = 0; i < validas.length; i += BATCH) {
      const batch = validas.slice(i, i + BATCH);
      await db.insert(erogaciones).values(
        batch.map((f) => ({
          fechaPago: f.fechaPago,
          descripcion: f.descripcion,
          monto: f.monto,
          empresaId: f.empresaId!,
          bancoId: f.bancoId!,
          proveedorId: f.proveedorId,
          estado: f.estado,
          esCritico: f.esCritico,
          categoria: f.categoria,
          notas: f.notas,
          metadata: sql`${JSON.stringify({
            origen: 'plantilla-erogaciones',
            filaExcel: f.filaExcel,
          })}::jsonb`,
        })),
      );
      insertadas += batch.length;
    }

    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/calendario');
    revalidatePath('/proyeccion');
    revalidatePath('/');
    console.log(
      '[aplicar-plantilla-erogaciones] OK:',
      insertadas,
      'insertadas',
    );
    return NextResponse.json({
      ok: true,
      insertadas,
      salteadas,
      salteadasPorDuplicado,
    });
  } catch (e) {
    console.error('[aplicar-plantilla-erogaciones] error:', e);
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
