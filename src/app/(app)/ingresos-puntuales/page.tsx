import { asc, desc, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  ingresosPuntuales,
} from '@/db/schema';
import { BANCO_CONSOLIDADO_NOMBRE } from '../saldos/schema';
import { IngresosPuntualesClient } from './ingresos-puntuales-client';

export const dynamic = 'force-dynamic';

export default async function IngresosPuntualesPage() {
  const [items, empresasList, bancosList] = await Promise.all([
    db
      .select({
        id: ingresosPuntuales.id,
        fecha: ingresosPuntuales.fecha,
        descripcion: ingresosPuntuales.descripcion,
        monto: ingresosPuntuales.monto,
        empresaId: ingresosPuntuales.empresaId,
        bancoId: ingresosPuntuales.bancoId,
        categoria: ingresosPuntuales.categoria,
        notas: ingresosPuntuales.notas,
        origen: ingresosPuntuales.origen,
      })
      .from(ingresosPuntuales)
      .orderBy(desc(ingresosPuntuales.fecha), desc(ingresosPuntuales.id)),
    db
      .select({ id: empresas.id, nombre: empresas.nombre })
      .from(empresas)
      .orderBy(asc(empresas.nombre)),
    db
      .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
      .from(bancosMediosPago)
      .where(ne(bancosMediosPago.nombre, BANCO_CONSOLIDADO_NOMBRE))
      .orderBy(asc(bancosMediosPago.nombre)),
  ]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ingresos puntuales
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Plata que entra de forma extraordinaria (cobros de cheques, prestamos,
          devoluciones, aportes). Se suman al saldo del dia correspondiente en
          la proyeccion de flujo. No se mezclan con la facturacion recurrente
          para no contaminar los promedios.
        </p>
      </div>

      <IngresosPuntualesClient
        items={items}
        empresas={empresasList}
        bancos={bancosList}
      />
    </div>
  );
}
