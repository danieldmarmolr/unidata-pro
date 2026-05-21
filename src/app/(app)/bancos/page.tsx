import { asc, ne } from 'drizzle-orm';
import { db } from '@/db';
import { bancosMediosPago } from '@/db/schema';
import { BANCO_CONSOLIDADO_NOMBRE } from '../saldos/schema';
import { BancosClient } from './bancos-client';

export const dynamic = 'force-dynamic';

export default async function BancosPage() {
  const lista = await db
    .select()
    .from(bancosMediosPago)
    .where(ne(bancosMediosPago.nombre, BANCO_CONSOLIDADO_NOMBRE))
    .orderBy(asc(bancosMediosPago.nombre));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bancos y medios de pago</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Las cuentas bancarias y billeteras digitales desde donde se ejecutan los pagos.
        </p>
      </div>

      <BancosClient bancos={lista} />
    </div>
  );
}
