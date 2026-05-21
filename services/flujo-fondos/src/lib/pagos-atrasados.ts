import { addDays } from 'date-fns';
import {
  proyectarMonto,
  type PromediosUnidad,
} from '@/app/(app)/promedios/calcular';

export const HORIZONTE_BUSQUEDA_DIAS = 60;
export const COLCHON_DEFAULT = 6_000_000;

export type PrioridadAtraso = 'normal' | 'laxo';

export type PagoAtrasadoInput = {
  id: number;
  fechaPago: string; // fecha original (pasada)
  monto: number;
  prioridad: PrioridadAtraso;
  diasAtraso: number; // hoyISO - fechaPago en dias
};

export type ErogacionFutura = {
  fechaPago: string; // fecha efectiva: tentativa si la hay, sino la original
  monto: number;
  estado: string;
};

export type IngresoPuntualFuturo = {
  fecha: string;
  monto: number;
};

export type SugerenciaResultado = {
  id: number;
  fechaSugerida: string | null; // null si no hay dia viable
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Construye un array de saldos por dia desde hoy hasta hoy+horizonte considerando:
 * - Saldo inicial
 * - Facturacion proyectada por unidad (promedios)
 * - Ingresos puntuales
 * - Erogaciones futuras (pendientes / en_curso)
 *
 * Cada elemento es el saldo al CIERRE del dia.
 */
function calcularSaldosDiarios(params: {
  saldoInicial: number;
  hoy: Date;
  horizonte: number;
  promedios: PromediosUnidad[];
  erogaciones: ErogacionFutura[];
  ingresosPuntuales: IngresoPuntualFuturo[];
}): number[] {
  const { saldoInicial, hoy, horizonte, promedios, erogaciones, ingresosPuntuales } =
    params;

  const erogPorFecha = new Map<string, number>();
  for (const er of erogaciones) {
    if (er.estado === 'pagado' || er.estado === 'cancelado' || er.estado === 'rechazado')
      continue;
    erogPorFecha.set(
      er.fechaPago,
      (erogPorFecha.get(er.fechaPago) ?? 0) + er.monto,
    );
  }

  const ingPorFecha = new Map<string, number>();
  for (const ip of ingresosPuntuales) {
    ingPorFecha.set(ip.fecha, (ingPorFecha.get(ip.fecha) ?? 0) + ip.monto);
  }

  const saldos: number[] = [];
  let saldo = saldoInicial;
  for (let i = 0; i < horizonte; i++) {
    const fechaISO = isoDate(addDays(hoy, i));
    const egreso = erogPorFecha.get(fechaISO) ?? 0;
    const ingPunt = ingPorFecha.get(fechaISO) ?? 0;
    // Dia 0 (hoy): el saldo inicial ya incluye lo facturado hoy.
    const ingProm =
      i === 0
        ? 0
        : promedios.reduce((a, p) => a + proyectarMonto(p, fechaISO), 0);
    saldo = saldo + ingProm + ingPunt - egreso;
    saldos.push(saldo);
  }
  return saldos;
}

/**
 * Ordena los pagos atrasados por prioridad (normal primero) y dentro de cada
 * grupo por dias de atraso DESC (mas viejos primero).
 */
export function ordenarPagosAtrasados(
  pagos: PagoAtrasadoInput[],
): PagoAtrasadoInput[] {
  return [...pagos].sort((a, b) => {
    if (a.prioridad !== b.prioridad) return a.prioridad === 'normal' ? -1 : 1;
    return b.diasAtraso - a.diasAtraso;
  });
}

/**
 * Para cada pago atrasado calcula la fecha sugerida (primer dia donde, si lo
 * coloco ahi, ningun dia desde ese hasta el final del horizonte cae por debajo
 * del colchon). Los pagos se procesan en orden de prioridad y los ya asignados
 * impactan a los que vienen despues.
 *
 * Retorna un array con id + fechaSugerida (null si no hay dia viable).
 */
export function sugerirFechasPagosAtrasados(params: {
  pagos: PagoAtrasadoInput[];
  saldoInicial: number;
  hoy: Date;
  horizonte?: number;
  colchon: number;
  promedios: PromediosUnidad[];
  erogacionesFuturas: ErogacionFutura[]; // ya con fecha efectiva (tentativa o real)
  ingresosPuntuales: IngresoPuntualFuturo[];
}): SugerenciaResultado[] {
  const {
    pagos,
    saldoInicial,
    hoy,
    horizonte = HORIZONTE_BUSQUEDA_DIAS,
    colchon,
    promedios,
    erogacionesFuturas,
    ingresosPuntuales,
  } = params;

  // Trabajamos sobre una copia mutable de erogaciones para ir acumulando los
  // pagos ya asignados en esta corrida.
  const erogsAcumuladas: ErogacionFutura[] = [...erogacionesFuturas];

  const ordenados = ordenarPagosAtrasados(pagos);
  const resultados: SugerenciaResultado[] = [];

  for (const pago of ordenados) {
    // Para cada candidato d desde manana hasta hoy+horizonte-1, simulo colocar
    // el pago ahi y verifico que el saldo desde d hasta el final del horizonte
    // se mantenga >= colchon.
    let fechaSugerida: string | null = null;
    for (let d = 1; d < horizonte; d++) {
      const fechaISO = isoDate(addDays(hoy, d));
      const erogsConCandidato = erogsAcumuladas.concat({
        fechaPago: fechaISO,
        monto: pago.monto,
        estado: 'pendiente',
      });
      const saldos = calcularSaldosDiarios({
        saldoInicial,
        hoy,
        horizonte,
        promedios,
        erogaciones: erogsConCandidato,
        ingresosPuntuales,
      });
      // Verifico desde el dia d hasta el final que el saldo no caiga.
      let viable = true;
      for (let j = d; j < horizonte; j++) {
        if (saldos[j] < colchon) {
          viable = false;
          break;
        }
      }
      if (viable) {
        fechaSugerida = fechaISO;
        break;
      }
    }

    if (fechaSugerida) {
      erogsAcumuladas.push({
        fechaPago: fechaSugerida,
        monto: pago.monto,
        estado: 'pendiente',
      });
    }
    resultados.push({ id: pago.id, fechaSugerida });
  }

  return resultados;
}

/**
 * Helper para calcular dias de atraso entre una fecha pasada y hoy.
 */
export function calcularDiasAtraso(fechaPagoISO: string, hoy: Date): number {
  const fp = new Date(fechaPagoISO + 'T00:00:00');
  const hoyMid = new Date(isoDate(hoy) + 'T00:00:00');
  const ms = hoyMid.getTime() - fp.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
