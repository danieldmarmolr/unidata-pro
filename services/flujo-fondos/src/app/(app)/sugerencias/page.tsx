import { desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { erogaciones, proveedores } from '@/db/schema';
import {
  detectarPatrones,
  type ErogacionParaPatron,
} from '@/lib/detectar-patrones';
import { SugerenciasClient } from './sugerencias-client';

export const dynamic = 'force-dynamic';

export default async function SugerenciasPage() {
  const rows = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      monto: erogaciones.monto,
      descripcion: erogaciones.descripcion,
      proveedorId: erogaciones.proveedorId,
      proveedorNombre: proveedores.nombre,
      empresaId: erogaciones.empresaId,
      bancoId: erogaciones.bancoId,
      estado: erogaciones.estado,
      recurrenciaId: erogaciones.recurrenciaId,
    })
    .from(erogaciones)
    .leftJoin(proveedores, eq(proveedores.id, erogaciones.proveedorId))
    .where(isNotNull(erogaciones.proveedorId))
    .orderBy(desc(erogaciones.fechaPago));

  const filas: ErogacionParaPatron[] = rows.map((r) => ({
    id: r.id,
    fechaPago: r.fechaPago,
    monto: r.monto,
    descripcion: r.descripcion,
    proveedorId: r.proveedorId,
    proveedorNombre: r.proveedorNombre,
    empresaId: r.empresaId,
    bancoId: r.bancoId,
    estado: r.estado,
    recurrenciaId: r.recurrenciaId,
  }));

  const patrones = detectarPatrones(filas);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sugerencias</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Analizamos tu historial de erogaciones para detectar gastos que se
          repiten al mismo proveedor con frecuencia regular y monto similar.
          Convertilos en recurrencias para que se generen automaticamente.
        </p>
      </div>

      <SugerenciasClient patrones={patrones} erogacionesAnalizadas={filas.length} />
    </div>
  );
}
