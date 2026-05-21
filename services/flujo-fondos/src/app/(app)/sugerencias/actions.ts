'use server';

import { addDays, format } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { recurrencias } from '@/db/schema';
import type {
  PatronDetectado,
} from '@/lib/detectar-patrones';

type ActionResult = { ok: true; recurrenciaId: number } | { ok: false; error: string };

export async function crearRecurrenciaDePatron(patron: PatronDetectado): Promise<ActionResult> {
  try {
    // La fecha de inicio sugerida es la fecha de la proxima ocurrencia: ultima + intervalo
    const fechaUltima = new Date(patron.fechaUltima);
    const fechaInicioSugerida = addDays(fechaUltima, patron.intervaloMedioDias);
    const fechaInicioStr = format(fechaInicioSugerida, 'yyyy-MM-dd');

    const [inserted] = await db
      .insert(recurrencias)
      .values({
        descripcion: patron.descripcionTipica,
        montoBase: patron.montoPromedio.toFixed(2),
        frecuencia: patron.frecuenciaSugerida,
        fechaInicio: fechaInicioStr,
        proveedorId: patron.proveedorId,
        empresaId: patron.empresaId,
        bancoId: patron.bancoId,
        activa: true,
      })
      .returning({ id: recurrencias.id });

    revalidatePath('/sugerencias');
    revalidatePath('/recurrencias');
    return { ok: true, recurrenciaId: inserted.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
