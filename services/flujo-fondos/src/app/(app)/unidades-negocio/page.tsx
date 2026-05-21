import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { unidadesNegocio } from '@/db/schema';
import { UnidadesNegocioClient } from './unidades-negocio-client';

export const dynamic = 'force-dynamic';

export default async function UnidadesNegocioPage() {
  const lista = await db
    .select()
    .from(unidadesNegocio)
    .orderBy(asc(unidadesNegocio.nombre));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Unidades de negocio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Los canales que generan facturacion (Unistore Mayorista, Mercado Libre, Unidrop).
        </p>
      </div>

      <UnidadesNegocioClient unidades={lista} />
    </div>
  );
}
