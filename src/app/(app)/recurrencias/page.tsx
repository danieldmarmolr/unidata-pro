import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  proveedores,
  recurrencias,
} from '@/db/schema';
import { RecurrenciasClient } from './recurrencias-client';

export const dynamic = 'force-dynamic';

export default async function RecurrenciasPage() {
  const [filas, listaEmpresas, listaBancos, listaProveedores] = await Promise.all([
    db
      .select({
        id: recurrencias.id,
        descripcion: recurrencias.descripcion,
        montoBase: recurrencias.montoBase,
        frecuencia: recurrencias.frecuencia,
        fechaInicio: recurrencias.fechaInicio,
        fechaFin: recurrencias.fechaFin,
        cuotasTotales: recurrencias.cuotasTotales,
        empresaId: recurrencias.empresaId,
        bancoId: recurrencias.bancoId,
        proveedorId: recurrencias.proveedorId,
        activa: recurrencias.activa,
        empresaNombre: empresas.nombre,
        bancoNombre: bancosMediosPago.nombre,
        proveedorNombre: proveedores.nombre,
      })
      .from(recurrencias)
      .leftJoin(empresas, eq(empresas.id, recurrencias.empresaId))
      .leftJoin(bancosMediosPago, eq(bancosMediosPago.id, recurrencias.bancoId))
      .leftJoin(proveedores, eq(proveedores.id, recurrencias.proveedorId))
      .orderBy(asc(recurrencias.descripcion)),
    db
      .select({ id: empresas.id, nombre: empresas.nombre })
      .from(empresas)
      .orderBy(asc(empresas.nombre)),
    db
      .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
      .from(bancosMediosPago)
      .orderBy(asc(bancosMediosPago.nombre)),
    db
      .select({ id: proveedores.id, nombre: proveedores.nombre })
      .from(proveedores)
      .orderBy(asc(proveedores.nombre)),
  ]);

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Recurrencias</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Gastos que se repiten todos los meses (alquileres, sueldos, servicios). En vez
          de cargarlos uno por uno, defines la recurrencia una vez y el sistema genera
          las erogaciones pendientes en el rango que vos elijas.
        </p>
      </div>

      <RecurrenciasClient
        filas={filas}
        empresas={listaEmpresas}
        bancos={listaBancos}
        proveedores={listaProveedores}
      />
    </div>
  );
}
