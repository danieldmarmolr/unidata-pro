import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { subWeeks } from 'date-fns';
import { db } from '@/db';
import { facturacionDiaria } from '@/db/schema';
import { calcularProyeccionTodas } from '@/lib/proyeccion';
import { filtrosPromediosSchema } from './schema';
import { PromediosClient } from './promedios-client';

export const dynamic = 'force-dynamic';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default async function PromediosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = filtrosPromediosSchema.parse({
    ventana: sp.ventana,
    decay: sp.decay,
  });

  const referencia = new Date();
  const { unidades, promedios } = await calcularProyeccionTodas({
    semanasVentana: filtros.ventana,
    decay: filtros.decay,
    referencia,
  });

  // Total de filas en la tabla de facturación (para mostrar empty state si está vacía)
  const [{ value: totalFilas }] = await db
    .select({ value: count() })
    .from(facturacionDiaria);

  // Eventos puntuales dentro de la ventana, para auditar exclusiones
  const desde = subWeeks(referencia, filtros.ventana);
  const eventosExcluidos = await db
    .select({
      id: facturacionDiaria.id,
      fecha: facturacionDiaria.fecha,
      monto: facturacionDiaria.monto,
      unidadNegocioId: facturacionDiaria.unidadNegocioId,
    })
    .from(facturacionDiaria)
    .where(
      and(
        eq(facturacionDiaria.esEventoPuntual, true),
        gte(facturacionDiaria.fecha, isoDate(desde)),
        lte(facturacionDiaria.fecha, isoDate(referencia)),
      ),
    )
    .orderBy(desc(facturacionDiaria.fecha));

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Promedios por dia de semana</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Base de la proyeccion de caja. Calculamos cuanto factura tipicamente cada unidad
          de negocio por dia de semana, dandole mas peso a las ultimas semanas y excluyendo
          eventos puntuales (Black Friday, cancelaciones, etc.) para no contaminar el modelo.
        </p>
      </div>

      <PromediosClient
        unidades={unidades}
        promedios={promedios}
        filtros={filtros}
        totalFilasFacturacion={totalFilas}
        eventosExcluidos={eventosExcluidos}
        referenciaISO={isoDate(referencia)}
      />
    </div>
  );
}
