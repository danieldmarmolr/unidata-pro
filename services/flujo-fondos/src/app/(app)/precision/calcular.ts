import { parseISO } from 'date-fns';
import {
  calcularPromediosUnidad,
  proyectarMonto,
  type FacturacionFila,
} from '../promedios/calcular';

export type ComparacionDia = {
  fechaISO: string;
  unidadNegocioId: number;
  real: number;
  proyectado: number;
  error: number; // real - proyectado
  errorPct: number; // % relativo al proyectado (0 si proyectado=0 y real=0)
  excluido: boolean; // true si la fila era un evento puntual (no se compara)
};

export type ResumenPrecision = {
  comparados: number; // dias × unidades comparados
  excluidos: number;
  mae: number; // mean absolute error (montos)
  mape: number; // mean absolute percentage error %
  bias: number; // promedio del error con signo (positivo = subestimamos, negativo = sobreestimamos)
  cobertura: number; // % de comparaciones donde el real cayo dentro de +/-25% del proyectado
  mejorDia: ComparacionDia | null;
  peorDia: ComparacionDia | null;
};

export function compararRealVsProyectado({
  filas,
  fechasComparar,
  unidadIds,
  ventanaSemanas,
  decay,
}: {
  filas: FacturacionFila[];
  fechasComparar: string[]; // ordenadas ascendentemente
  unidadIds: number[];
  ventanaSemanas: number;
  decay: number;
}): ComparacionDia[] {
  const filasOrden = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const resultado: ComparacionDia[] = [];

  for (const fechaCompararISO of fechasComparar) {
    // Filas anteriores a la fecha (sin data leakage)
    const filasHistoricas = filasOrden.filter((f) => f.fecha < fechaCompararISO);
    // Filas reales del dia (para extraer real por unidad)
    const filasDia = filasOrden.filter((f) => f.fecha === fechaCompararISO);
    const referencia = parseISO(fechaCompararISO);

    for (const uid of unidadIds) {
      const filaReal = filasDia.find((f) => f.unidadNegocioId === uid);
      if (!filaReal) continue; // sin dato real, nada que comparar
      if (filaReal.esEventoPuntual) {
        resultado.push({
          fechaISO: fechaCompararISO,
          unidadNegocioId: uid,
          real: Number(filaReal.monto),
          proyectado: 0,
          error: 0,
          errorPct: 0,
          excluido: true,
        });
        continue;
      }
      const prom = calcularPromediosUnidad(uid, filasHistoricas, {
        semanasVentana: ventanaSemanas,
        decay,
        referencia,
      });
      const real = Number(filaReal.monto);
      const proyectado = proyectarMonto(prom, fechaCompararISO);
      const error = real - proyectado;
      const errorPct = proyectado > 0 ? (error / proyectado) * 100 : real === 0 ? 0 : 100;
      resultado.push({
        fechaISO: fechaCompararISO,
        unidadNegocioId: uid,
        real,
        proyectado,
        error,
        errorPct,
        excluido: false,
      });
    }
  }

  return resultado;
}

export function resumir(comparaciones: ComparacionDia[]): ResumenPrecision {
  const validas = comparaciones.filter((c) => !c.excluido);
  const excluidos = comparaciones.length - validas.length;

  if (validas.length === 0) {
    return {
      comparados: 0,
      excluidos,
      mae: 0,
      mape: 0,
      bias: 0,
      cobertura: 0,
      mejorDia: null,
      peorDia: null,
    };
  }

  const sumaAbs = validas.reduce((a, c) => a + Math.abs(c.error), 0);
  const sumaAbsPct = validas.reduce((a, c) => a + Math.abs(c.errorPct), 0);
  const sumaSigno = validas.reduce((a, c) => a + c.error, 0);
  const dentroRango = validas.filter((c) => Math.abs(c.errorPct) <= 25).length;

  let mejor: ComparacionDia | null = null;
  let peor: ComparacionDia | null = null;
  for (const c of validas) {
    if (mejor === null || Math.abs(c.errorPct) < Math.abs(mejor.errorPct)) mejor = c;
    if (peor === null || Math.abs(c.errorPct) > Math.abs(peor.errorPct)) peor = c;
  }

  return {
    comparados: validas.length,
    excluidos,
    mae: sumaAbs / validas.length,
    mape: sumaAbsPct / validas.length,
    bias: sumaSigno / validas.length,
    cobertura: (dentroRango / validas.length) * 100,
    mejorDia: mejor,
    peorDia: peor,
  };
}

export function agruparPorFecha(comparaciones: ComparacionDia[]): Array<{
  fechaISO: string;
  real: number;
  proyectado: number;
}> {
  const por = new Map<string, { real: number; proyectado: number }>();
  for (const c of comparaciones) {
    if (c.excluido) continue;
    const prev = por.get(c.fechaISO) ?? { real: 0, proyectado: 0 };
    prev.real += c.real;
    prev.proyectado += c.proyectado;
    por.set(c.fechaISO, prev);
  }
  return Array.from(por.entries())
    .map(([fechaISO, v]) => ({ fechaISO, ...v }))
    .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
}
