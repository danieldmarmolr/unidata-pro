import { addDays, format } from 'date-fns';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { facturacionDiaria, unidadesNegocio } from '@/db/schema';
import {
  agruparPorFecha,
  compararRealVsProyectado,
  resumir,
} from './calcular';
import { PrecisionClient } from './precision-client';
import { precisionFiltrosSchema } from './schema';

export const dynamic = 'force-dynamic';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default async function PrecisionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = precisionFiltrosSchema.parse({
    diasAtras: sp.diasAtras,
    ventana: sp.ventana,
    decay: sp.decay,
    unidad: sp.unidad,
  });

  const hoy = new Date();
  const hoyStr = isoDate(hoy);
  const desdeComparar = addDays(hoy, -filtros.diasAtras);
  const desdeCompararStr = isoDate(desdeComparar);

  // Para no causar data leakage, cargo TODAS las filas hasta hoy
  // (el calculador internamente filtra historicas para cada fecha).
  const unidades = await db
    .select({ id: unidadesNegocio.id, nombre: unidadesNegocio.nombre })
    .from(unidadesNegocio)
    .where(eq(unidadesNegocio.activa, true))
    .orderBy(asc(unidadesNegocio.nombre));

  const todasFilas = await db
    .select({
      fecha: facturacionDiaria.fecha,
      monto: facturacionDiaria.monto,
      unidadNegocioId: facturacionDiaria.unidadNegocioId,
      esEventoPuntual: facturacionDiaria.esEventoPuntual,
    })
    .from(facturacionDiaria)
    .where(lte(facturacionDiaria.fecha, hoyStr))
    .orderBy(asc(facturacionDiaria.fecha));

  // Fechas distintas dentro del rango de comparacion
  const fechasUnicas = [
    ...new Set(
      todasFilas
        .filter((f) => f.fecha >= desdeCompararStr && f.fecha <= hoyStr)
        .map((f) => f.fecha),
    ),
  ].sort();

  const unidadIds = filtros.unidad ? [filtros.unidad] : unidades.map((u) => u.id);

  const comparaciones = compararRealVsProyectado({
    filas: todasFilas,
    fechasComparar: fechasUnicas,
    unidadIds,
    ventanaSemanas: filtros.ventana,
    decay: filtros.decay,
  });

  const resumen = resumir(comparaciones);
  const serieDiaria = agruparPorFecha(comparaciones);

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Precision del modelo
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Compara el ingreso real (lo que efectivamente facturaste) contra el ingreso
          proyectado (lo que el motor de promedios habria predicho) para los ultimos
          dias. Cada fecha se proyecta usando solo datos previos a ella (sin data
          leakage), para que el resultado refleje como funcionaria el modelo en vivo.
        </p>
      </div>

      <PrecisionClient
        comparaciones={comparaciones}
        resumen={resumen}
        serieDiaria={serieDiaria}
        unidades={unidades}
        filtros={filtros}
        rangoLabel={`${format(desdeComparar, 'dd/MM')} → ${format(hoy, 'dd/MM/yyyy')}`}
        totalFilasFacturacion={todasFilas.length}
      />
    </div>
  );
}
