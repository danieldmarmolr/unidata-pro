import { addDays, format } from 'date-fns';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  empresas,
  facturacionDiaria,
  unidadesNegocio,
} from '@/db/schema';
import { FacturacionClient } from './facturacion-client';

export const dynamic = 'force-dynamic';

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const desdeParam = typeof sp.desde === 'string' ? sp.desde : undefined;
  const hastaParam = typeof sp.hasta === 'string' ? sp.hasta : undefined;

  const hoy = new Date();
  const hoyStr = format(hoy, 'yyyy-MM-dd');
  const desde = desdeParam ?? format(addDays(hoy, -90), 'yyyy-MM-dd');
  const hasta = hastaParam ?? hoyStr;

  const [items, unidades, empresasList] = await Promise.all([
    db
      .select({
        id: facturacionDiaria.id,
        fecha: facturacionDiaria.fecha,
        unidadNegocioId: facturacionDiaria.unidadNegocioId,
        empresaId: facturacionDiaria.empresaId,
        monto: facturacionDiaria.monto,
        esEventoPuntual: facturacionDiaria.esEventoPuntual,
        origen: facturacionDiaria.origen,
      })
      .from(facturacionDiaria)
      .where(
        and(
          gte(facturacionDiaria.fecha, desde),
          lte(facturacionDiaria.fecha, hasta),
        ),
      )
      .orderBy(desc(facturacionDiaria.fecha), asc(facturacionDiaria.unidadNegocioId)),
    db
      .select({ id: unidadesNegocio.id, nombre: unidadesNegocio.nombre })
      .from(unidadesNegocio)
      .where(eq(unidadesNegocio.activa, true))
      .orderBy(asc(unidadesNegocio.nombre)),
    db
      .select({ id: empresas.id, nombre: empresas.nombre })
      .from(empresas)
      .orderBy(asc(empresas.nombre)),
  ]);

  // Resumen rapido
  const [totalRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${facturacionDiaria.monto}::numeric), 0)::text`,
      cantidad: sql<string>`COUNT(*)::text`,
    })
    .from(facturacionDiaria)
    .where(
      and(
        gte(facturacionDiaria.fecha, desde),
        lte(facturacionDiaria.fecha, hasta),
      ),
    );

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Facturacion diaria</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Todos los datos de facturacion cargados, dia por dia y por unidad de
          negocio. Usados para calcular los promedios ponderados que alimentan
          la proyeccion de caja.
        </p>
      </div>

      <FacturacionClient
        items={items}
        unidades={unidades}
        empresas={empresasList}
        rango={{ desde, hasta }}
        total={Number(totalRow?.total ?? 0)}
        cantidad={Number(totalRow?.cantidad ?? 0)}
      />
    </div>
  );
}
