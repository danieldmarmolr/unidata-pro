import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { empresas } from '@/db/schema';
import { EmpresasClient } from './empresas-client';

export const dynamic = 'force-dynamic';

export default async function EmpresasPage() {
  const lista = await db.select().from(empresas).orderBy(asc(empresas.nombre));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Las razones sociales del grupo. Comparten una tesoreria consolidada.
        </p>
      </div>

      <EmpresasClient empresas={lista} />
    </div>
  );
}
