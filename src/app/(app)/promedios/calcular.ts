import { differenceInCalendarWeeks, parseISO, startOfWeek, subDays } from 'date-fns';

// Unidades con diferimiento: lo que se factura un dia X se cobra (entra
// como ingreso) el dia X + diasDiferimiento. Match por nombre (case
// insensitive, trim) para evitar pasar el dato en cada llamada.
const DIFERIMIENTO_POR_UNIDAD: Record<string, number> = {
  'unistore mayorista': 1,
};

export function diferimientoDeUnidad(nombre: string | null | undefined): number {
  if (!nombre) return 0;
  return DIFERIMIENTO_POR_UNIDAD[nombre.trim().toLowerCase()] ?? 0;
}

export type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DOW_LABELS: Record<DowIndex, string> = {
  0: 'Lun',
  1: 'Mar',
  2: 'Mie',
  3: 'Jue',
  4: 'Vie',
  5: 'Sab',
  6: 'Dom',
};

export const DOW_LABELS_LONG: Record<DowIndex, string> = {
  0: 'Lunes',
  1: 'Martes',
  2: 'Miercoles',
  3: 'Jueves',
  4: 'Viernes',
  5: 'Sabado',
  6: 'Domingo',
};

export type FacturacionFila = {
  fecha: string; // YYYY-MM-DD
  monto: string | number;
  unidadNegocioId: number;
  esEventoPuntual: boolean;
};

export type EstadisticaDow = {
  ponderado: number;
  simple: number;
  n: number;
  desvioPct: number; // % desvío estándar relativo al promedio simple
};

export type PromediosUnidad = {
  unidadNegocioId: number;
  unidadNombre?: string; // opcional, usado para aplicar diferimientos
  diasDiferimiento?: number; // dias entre facturacion y cobro
  porDow: Record<DowIndex, EstadisticaDow>;
  totalSemanalPonderado: number;
  totalSemanalSimple: number;
  filasUsadas: number;
  filasExcluidasEventoPuntual: number;
  filasFueraDeVentana: number;
};

export type OpcionesCalculo = {
  semanasVentana: number; // default 12
  decay: number; // default 0.85
  referencia: Date; // default new Date()
};

const VACIO: EstadisticaDow = { ponderado: 0, simple: 0, n: 0, desvioPct: 0 };

function dowLunes(fecha: Date): DowIndex {
  // getDay: 0=domingo .. 6=sábado. Normalizamos a 0=lunes .. 6=domingo.
  return (((fecha.getDay() + 6) % 7) as DowIndex);
}

function semanasAtras(fecha: Date, referencia: Date): number {
  const lunesFecha = startOfWeek(fecha, { weekStartsOn: 1 });
  const lunesRef = startOfWeek(referencia, { weekStartsOn: 1 });
  return differenceInCalendarWeeks(lunesRef, lunesFecha, { weekStartsOn: 1 });
}

export function calcularPromediosUnidad(
  unidadNegocioId: number,
  filas: FacturacionFila[],
  opciones: Partial<OpcionesCalculo> = {},
): PromediosUnidad {
  const { semanasVentana = 12, decay = 0.85, referencia = new Date() } = opciones;

  const buckets: Record<DowIndex, { montos: number[]; pesos: number[] }> = {
    0: { montos: [], pesos: [] },
    1: { montos: [], pesos: [] },
    2: { montos: [], pesos: [] },
    3: { montos: [], pesos: [] },
    4: { montos: [], pesos: [] },
    5: { montos: [], pesos: [] },
    6: { montos: [], pesos: [] },
  };

  let filasUsadas = 0;
  let filasExcluidasEventoPuntual = 0;
  let filasFueraDeVentana = 0;

  for (const fila of filas) {
    if (fila.unidadNegocioId !== unidadNegocioId) continue;
    if (fila.esEventoPuntual) {
      filasExcluidasEventoPuntual++;
      continue;
    }
    const fecha = parseISO(fila.fecha);
    const semanas = semanasAtras(fecha, referencia);
    if (semanas < 0 || semanas >= semanasVentana) {
      filasFueraDeVentana++;
      continue;
    }
    const dow = dowLunes(fecha);
    const monto = Number(fila.monto);
    if (!Number.isFinite(monto) || monto < 0) continue;
    const peso = Math.pow(decay, semanas);
    buckets[dow].montos.push(monto);
    buckets[dow].pesos.push(peso);
    filasUsadas++;
  }

  const porDow = {
    0: { ...VACIO },
    1: { ...VACIO },
    2: { ...VACIO },
    3: { ...VACIO },
    4: { ...VACIO },
    5: { ...VACIO },
    6: { ...VACIO },
  } as Record<DowIndex, EstadisticaDow>;

  let totalSemanalPonderado = 0;
  let totalSemanalSimple = 0;

  const DOWS: DowIndex[] = [0, 1, 2, 3, 4, 5, 6];
  DOWS.forEach((dow) => {
    const { montos, pesos } = buckets[dow];
    if (montos.length === 0) return;
    const sumaSimple = montos.reduce((a, b) => a + b, 0);
    const simple = sumaSimple / montos.length;
    const sumaPeso = pesos.reduce((a, b) => a + b, 0);
    const sumaPesoMonto = montos.reduce((a, m, i) => a + m * pesos[i], 0);
    const ponderado = sumaPeso > 0 ? sumaPesoMonto / sumaPeso : 0;
    const varianza =
      montos.reduce((a, m) => a + (m - simple) ** 2, 0) / montos.length;
    const desvio = Math.sqrt(varianza);
    const desvioPct = simple > 0 ? (desvio / simple) * 100 : 0;
    porDow[dow] = {
      ponderado,
      simple,
      n: montos.length,
      desvioPct,
    };
    totalSemanalPonderado += ponderado;
    totalSemanalSimple += simple;
  });

  return {
    unidadNegocioId,
    porDow,
    totalSemanalPonderado,
    totalSemanalSimple,
    filasUsadas,
    filasExcluidasEventoPuntual,
    filasFueraDeVentana,
  };
}

export function calcularPromediosTodas(
  unidadIds: number[],
  filas: FacturacionFila[],
  opciones: Partial<OpcionesCalculo> = {},
): PromediosUnidad[] {
  return unidadIds.map((id) => calcularPromediosUnidad(id, filas, opciones));
}

export function proyectarMonto(
  promedios: PromediosUnidad,
  fechaISO: string,
): number {
  // Si la unidad tiene diferimiento d, lo que se observa hoy proviene
  // de lo facturado hace d dias. Para obtener el monto que entra hoy,
  // miramos el DOW del dia "fecha - d" (porque ese era el dia de
  // facturacion original).
  const d = promedios.diasDiferimiento ?? 0;
  const fechaFacturacion = d > 0 ? subDays(parseISO(fechaISO), d) : parseISO(fechaISO);
  const dow = dowLunes(fechaFacturacion);
  return promedios.porDow[dow].ponderado;
}
