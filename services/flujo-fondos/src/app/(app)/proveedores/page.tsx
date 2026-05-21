import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { proveedores } from '@/db/schema';
import { ProveedoresClient } from './proveedores-client';

export const dynamic = 'force-dynamic';

export default async function ProveedoresPage() {
  const lista = await db
    .select()
    .from(proveedores)
    .orderBy(asc(proveedores.nombre));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Las personas o empresas a las que les hacemos pagos. La prioridad y las notas
          definen el orden de pago cuando la caja esta apretada.
        </p>
      </div>

      <ProveedoresClient proveedores={lista} />
    </div>
  );
}
