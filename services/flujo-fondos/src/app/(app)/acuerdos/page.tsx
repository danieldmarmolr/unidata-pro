import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '@/db';
import { acuerdos, erogaciones, proveedores } from '@/db/schema';
import { AcuerdosClient } from './acuerdos-client';
import { acuerdosFiltersSchema } from './schema';

export const dynamic = 'force-dynamic';

export default async function AcuerdosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = acuerdosFiltersSchema.parse({
    estado: sp.estado,
    tipo: sp.tipo,
    proveedor: sp.proveedor,
    q: typeof sp.q === 'string' ? sp.q : undefined,
  });

  const whereParts = [];
  if (filtros.estado) whereParts.push(eq(acuerdos.estado, filtros.estado));
  if (filtros.tipo) whereParts.push(eq(acuerdos.tipo, filtros.tipo));
  if (filtros.proveedor)
    whereParts.push(eq(acuerdos.proveedorId, filtros.proveedor));
  if (filtros.q && filtros.q.length > 0) {
    whereParts.push(
      or(
        ilike(acuerdos.compromiso, `%${filtros.q}%`),
        ilike(acuerdos.contexto, `%${filtros.q}%`),
      ),
    );
  }

  const filas = await db
    .select({
      id: acuerdos.id,
      proveedorId: acuerdos.proveedorId,
      proveedorNombre: proveedores.nombre,
      tipo: acuerdos.tipo,
      compromiso: acuerdos.compromiso,
      fechaCompromiso: acuerdos.fechaCompromiso,
      montoCompromiso: acuerdos.montoCompromiso,
      estado: acuerdos.estado,
      contexto: acuerdos.contexto,
      erogacionId: acuerdos.erogacionId,
      erogacionDescripcion: erogaciones.descripcion,
      createdAt: acuerdos.createdAt,
      fechaResolucion: acuerdos.fechaResolucion,
    })
    .from(acuerdos)
    .innerJoin(proveedores, eq(proveedores.id, acuerdos.proveedorId))
    .leftJoin(erogaciones, eq(erogaciones.id, acuerdos.erogacionId))
    .where(whereParts.length > 0 ? and(...whereParts) : undefined)
    .orderBy(
      // Pendientes primero (mas urgentes arriba), despues por fecha de creacion desc
      asc(acuerdos.estado),
      asc(acuerdos.fechaCompromiso),
      desc(acuerdos.createdAt),
    );

  // Stats globales (no filtradas) para el strip superior
  const porEstadoRows = await db
    .select({ estado: acuerdos.estado, n: count() })
    .from(acuerdos)
    .groupBy(acuerdos.estado);
  const porEstado = {
    pendiente: porEstadoRows.find((r) => r.estado === 'pendiente')?.n ?? 0,
    cumplido: porEstadoRows.find((r) => r.estado === 'cumplido')?.n ?? 0,
    incumplido: porEstadoRows.find((r) => r.estado === 'incumplido')?.n ?? 0,
  };

  const listaProveedores = await db
    .select({ id: proveedores.id, nombre: proveedores.nombre })
    .from(proveedores)
    .orderBy(asc(proveedores.nombre));

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Acuerdos con proveedores
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Promesas que hiciste a proveedores tratadas como entidad propia, no como
          notas sueltas. Cada acuerdo tiene un ciclo de vida: pendiente → cumplido o
          incumplido. Conocer el historial te ayuda a saber a quien sí y a quien no
          podes prometerle algo.
        </p>
      </div>

      <AcuerdosClient
        filas={filas}
        proveedores={listaProveedores}
        filtros={filtros}
        porEstado={porEstado}
      />
    </div>
  );
}
