import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { acuerdos, empresas, erogaciones, proveedores } from '@/db/schema';
import { ProveedorFichaClient } from './ficha-client';

export const dynamic = 'force-dynamic';

export default async function ProveedorFichaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proveedorId = Number(id);
  if (!Number.isFinite(proveedorId)) notFound();

  const [proveedor] = await db
    .select()
    .from(proveedores)
    .where(eq(proveedores.id, proveedorId));
  if (!proveedor) notFound();

  // Erogaciones del proveedor con empresa nombrada
  const erogs = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      fechaCarga: erogaciones.fechaCarga,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      moneda: erogaciones.moneda,
      estado: erogaciones.estado,
      esCritico: erogaciones.esCritico,
      empresaId: erogaciones.empresaId,
      empresaNombre: empresas.nombre,
      pagadoAt: erogaciones.pagadoAt,
    })
    .from(erogaciones)
    .leftJoin(empresas, eq(empresas.id, erogaciones.empresaId))
    .where(eq(erogaciones.proveedorId, proveedorId))
    .orderBy(desc(erogaciones.fechaPago));

  // Acuerdos del proveedor
  const acuerdosRows = await db
    .select()
    .from(acuerdos)
    .where(eq(acuerdos.proveedorId, proveedorId))
    .orderBy(asc(acuerdos.estado), desc(acuerdos.fechaCompromiso));

  // Stats agregadas
  const sumas = await db
    .select({
      estado: erogaciones.estado,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .where(eq(erogaciones.proveedorId, proveedorId))
    .groupBy(erogaciones.estado);

  const acuerdosStats = await db
    .select({ estado: acuerdos.estado, n: count() })
    .from(acuerdos)
    .where(eq(acuerdos.proveedorId, proveedorId))
    .groupBy(acuerdos.estado);

  return (
    <ProveedorFichaClient
      proveedor={proveedor}
      erogaciones={erogs}
      acuerdos={acuerdosRows}
      sumasPorEstado={sumas}
      acuerdosPorEstado={acuerdosStats}
    />
  );
}
