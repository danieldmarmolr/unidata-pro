import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  erogaciones,
  proveedores,
} from '@/db/schema';
import { ErogacionesClient } from './erogaciones-client';
import { erogacionFiltersSchema } from './schema';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ErogacionesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rawParams = await searchParams;
  // Sanitize: only first value per key, ignore arrays.
  const cleanParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) {
    if (typeof v === 'string' && v.length > 0) cleanParams[k] = v;
  }
  const filters = erogacionFiltersSchema.parse(cleanParams);

  const [empresasList, bancosList, proveedoresList] = await Promise.all([
    db.select().from(empresas).orderBy(asc(empresas.nombre)),
    db
      .select()
      .from(bancosMediosPago)
      .orderBy(asc(bancosMediosPago.nombre)),
    db.select().from(proveedores).orderBy(asc(proveedores.nombre)),
  ]);

  const conds = [];
  if (filters.estado) conds.push(eq(erogaciones.estado, filters.estado));
  if (filters.empresa) conds.push(eq(erogaciones.empresaId, filters.empresa));
  if (filters.banco) conds.push(eq(erogaciones.bancoId, filters.banco));
  if (filters.proveedor)
    conds.push(eq(erogaciones.proveedorId, filters.proveedor));
  if (filters.desde) conds.push(gte(erogaciones.fechaPago, filters.desde));
  if (filters.hasta) conds.push(lte(erogaciones.fechaPago, filters.hasta));
  if (filters.q)
    conds.push(sql`${erogaciones.descripcion} ILIKE ${`%${filters.q}%`}`);
  if (filters.oculto === '1') conds.push(eq(erogaciones.oculto, true));
  if (filters.oculto === '0') conds.push(eq(erogaciones.oculto, false));

  const orderByMap = {
    fecha_asc: asc(erogaciones.fechaPago),
    fecha_desc: desc(erogaciones.fechaPago),
    monto_asc: asc(erogaciones.monto),
    monto_desc: desc(erogaciones.monto),
  };

  const filas = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      moneda: erogaciones.moneda,
      empresaId: erogaciones.empresaId,
      empresaNombre: empresas.nombre,
      bancoId: erogaciones.bancoId,
      bancoNombre: bancosMediosPago.nombre,
      proveedorId: erogaciones.proveedorId,
      proveedorNombre: proveedores.nombre,
      estado: erogaciones.estado,
      categoria: erogaciones.categoria,
      esCritico: erogaciones.esCritico,
      notas: erogaciones.notas,
      pagadoAt: erogaciones.pagadoAt,
      oculto: erogaciones.oculto,
    })
    .from(erogaciones)
    .leftJoin(empresas, eq(erogaciones.empresaId, empresas.id))
    .leftJoin(
      bancosMediosPago,
      eq(erogaciones.bancoId, bancosMediosPago.id),
    )
    .leftJoin(proveedores, eq(erogaciones.proveedorId, proveedores.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(orderByMap[filters.sort]);

  return (
    <ErogacionesClient
      erogaciones={filas}
      empresas={empresasList}
      bancos={bancosList}
      proveedores={proveedoresList}
      filters={filters}
    />
  );
}

export type ErogacionRow = Awaited<
  ReturnType<typeof loadRows>
>[number];

// Helper para inferir el tipo del row (necesario porque el client lo recibe).
async function loadRows() {
  return db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      moneda: erogaciones.moneda,
      empresaId: erogaciones.empresaId,
      empresaNombre: empresas.nombre,
      bancoId: erogaciones.bancoId,
      bancoNombre: bancosMediosPago.nombre,
      proveedorId: erogaciones.proveedorId,
      proveedorNombre: proveedores.nombre,
      estado: erogaciones.estado,
      categoria: erogaciones.categoria,
      esCritico: erogaciones.esCritico,
      notas: erogaciones.notas,
      pagadoAt: erogaciones.pagadoAt,
      oculto: erogaciones.oculto,
    })
    .from(erogaciones);
}
