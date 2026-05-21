import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { parseISO, subWeeks } from 'date-fns';
import { cache } from 'react';
import { db } from '@/db';
import { facturacionDiaria, unidadesNegocio } from '@/db/schema';
import {
  calcularPromediosTodas,
  diferimientoDeUnidad,
  proyectarMonto,
  type FacturacionFila,
  type PromediosUnidad,
} from '@/app/(app)/promedios/calcular';

export type ProyeccionConfig = {
  semanasVentana?: number;
  decay?: number;
  referencia?: Date;
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function cargarFilasFacturacion(
  referencia: Date,
  semanasVentana: number,
): Promise<FacturacionFila[]> {
  const desde = subWeeks(referencia, semanasVentana);
  const rows = await db
    .select({
      fecha: facturacionDiaria.fecha,
      monto: facturacionDiaria.monto,
      unidadNegocioId: facturacionDiaria.unidadNegocioId,
      esEventoPuntual: facturacionDiaria.esEventoPuntual,
    })
    .from(facturacionDiaria)
    .where(
      and(
        gte(facturacionDiaria.fecha, isoDate(desde)),
        lte(facturacionDiaria.fecha, isoDate(referencia)),
      ),
    )
    .orderBy(asc(facturacionDiaria.fecha));
  return rows;
}

// Implementacion interna con clave estable (strings) para que React.cache()
// pueda deduplicar llamadas iguales dentro del mismo request. El config
// publico recibe un Date, que como objeto cambia de identidad en cada llamada
// y rompe la memoizacion — por eso normalizamos a fechaISO.
const calcularProyeccionTodasInternal = cache(
  async (
    referenciaISO: string,
    semanasVentana: number,
    decay: number,
  ): Promise<{
    unidades: { id: number; nombre: string; activa: boolean }[];
    promedios: PromediosUnidad[];
  }> => {
    const referencia = parseISO(referenciaISO);
    // Las dos queries (unidades + facturacion) son independientes —
    // las corremos en paralelo.
    const [unidades, filas] = await Promise.all([
      db
        .select({
          id: unidadesNegocio.id,
          nombre: unidadesNegocio.nombre,
          activa: unidadesNegocio.activa,
        })
        .from(unidadesNegocio)
        .where(eq(unidadesNegocio.activa, true))
        .orderBy(asc(unidadesNegocio.nombre)),
      cargarFilasFacturacion(referencia, semanasVentana),
    ]);

    const promediosBase = calcularPromediosTodas(
      unidades.map((u) => u.id),
      filas,
      { semanasVentana, decay, referencia },
    );

    // Enriquecer con nombre + diferimiento para que proyectarMonto pueda
    // aplicar el shift por unidad sin que cada caller lo pase a mano.
    const promedios: PromediosUnidad[] = promediosBase.map((p) => {
      const u = unidades.find((x) => x.id === p.unidadNegocioId);
      return {
        ...p,
        unidadNombre: u?.nombre,
        diasDiferimiento: diferimientoDeUnidad(u?.nombre),
      };
    });

    return { unidades, promedios };
  },
);

export async function calcularProyeccionTodas(
  config: ProyeccionConfig = {},
): Promise<{
  unidades: { id: number; nombre: string; activa: boolean }[];
  promedios: PromediosUnidad[];
}> {
  const { semanasVentana = 12, decay = 0.85, referencia = new Date() } = config;
  return calcularProyeccionTodasInternal(
    isoDate(referencia),
    semanasVentana,
    decay,
  );
}

export async function proyectarFacturacionDia(
  fechaISO: string,
  config: ProyeccionConfig = {},
): Promise<{ unidadNegocioId: number; monto: number }[]> {
  const { unidades, promedios } = await calcularProyeccionTodas(config);
  return unidades.map((u) => {
    const prom = promedios.find((p) => p.unidadNegocioId === u.id);
    return {
      unidadNegocioId: u.id,
      monto: prom ? proyectarMonto(prom, fechaISO) : 0,
    };
  });
}
