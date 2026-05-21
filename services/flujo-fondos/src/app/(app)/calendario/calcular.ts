import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  proyectarMonto,
  type PromediosUnidad,
} from '../promedios/calcular';

export type ErogacionDia = {
  id: number;
  fechaPago: string; // fecha efectiva (tentativa si existe, sino la real)
  fechaPagoOriginal: string; // fecha original cargada (para distinguir tentativas)
  descripcion: string;
  monto: string;
  moneda: string;
  estado: string;
  esCritico: boolean;
  empresaId: number;
  bancoId: number;
  proveedorId: number | null;
  esTentativa: boolean; // true si fechaPago viene de fecha_sugerida_tentativa
};

export type IngresoPuntualDia = {
  id: number;
  fecha: string;
  descripcion: string;
  monto: string;
  categoria: string | null;
};

export type DiaCalendario = {
  fechaISO: string;
  dia: number;
  esMesActual: boolean;
  esHoy: boolean;
  esFuturo: boolean;
  ingresoProyectado: number; // promedios por DOW
  ingresoPuntual: number; // ingresos puntuales del dia
  ingresoTotal: number; // suma
  egresoComprometido: number;
  neto: number;
  cantidadErogaciones: number;
  cantidadIngresosPuntuales: number;
  erogaciones: ErogacionDia[];
  ingresosPuntuales: IngresoPuntualDia[];
  ingresosPorUnidad: { unidadNegocioId: number; monto: number }[];
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function rangoVistaMes(referencia: Date): { inicio: Date; fin: Date } {
  // El calendario muestra desde el lunes de la primer semana del mes hasta
  // el domingo de la última semana del mes. Esto rellena la grilla 7xN.
  const inicio = startOfWeek(startOfMonth(referencia), { weekStartsOn: 1 });
  const fin = endOfWeek(endOfMonth(referencia), { weekStartsOn: 1 });
  return { inicio, fin };
}

export function rangoMes(referencia: Date): { inicio: string; fin: string } {
  // Para queries a la DB: solo el mes en si, no la vista expandida.
  const { inicio, fin } = rangoVistaMes(referencia);
  return { inicio: isoDate(inicio), fin: isoDate(fin) };
}

export function generarDiasCalendario(
  referencia: Date,
  erogaciones: ErogacionDia[],
  promedios: PromediosUnidad[],
  hoy: Date = new Date(),
  ingresosPuntuales: IngresoPuntualDia[] = [],
): DiaCalendario[] {
  const { inicio, fin } = rangoVistaMes(referencia);
  const dias = eachDayOfInterval({ start: inicio, end: fin });
  const hoyISO = isoDate(hoy);

  // Agrupar erogaciones por fecha
  const erogsPorFecha = new Map<string, ErogacionDia[]>();
  for (const er of erogaciones) {
    const arr = erogsPorFecha.get(er.fechaPago) ?? [];
    arr.push(er);
    erogsPorFecha.set(er.fechaPago, arr);
  }

  // Agrupar ingresos puntuales por fecha
  const ingPuntPorFecha = new Map<string, IngresoPuntualDia[]>();
  for (const ip of ingresosPuntuales) {
    const arr = ingPuntPorFecha.get(ip.fecha) ?? [];
    arr.push(ip);
    ingPuntPorFecha.set(ip.fecha, arr);
  }

  return dias.map((d) => {
    const fechaISO = isoDate(d);
    const erogs = erogsPorFecha.get(fechaISO) ?? [];
    const egreso = erogs.reduce((a, e) => a + Number(e.monto), 0);

    const ingresosPorUnidad = promedios.map((p) => ({
      unidadNegocioId: p.unidadNegocioId,
      monto: proyectarMonto(p, fechaISO),
    }));
    const ingresoProm = ingresosPorUnidad.reduce((a, x) => a + x.monto, 0);

    const ingPuntDia = ingPuntPorFecha.get(fechaISO) ?? [];
    const ingresoPuntual = ingPuntDia.reduce((a, ip) => a + Number(ip.monto), 0);
    const ingresoTotal = ingresoProm + ingresoPuntual;

    return {
      fechaISO,
      dia: d.getDate(),
      esMesActual: isSameMonth(d, referencia),
      esHoy: fechaISO === hoyISO,
      esFuturo: fechaISO > hoyISO,
      ingresoProyectado: ingresoProm,
      ingresoPuntual,
      ingresoTotal,
      egresoComprometido: egreso,
      neto: ingresoTotal - egreso,
      cantidadErogaciones: erogs.length,
      cantidadIngresosPuntuales: ingPuntDia.length,
      erogaciones: erogs,
      ingresosPuntuales: ingPuntDia,
      ingresosPorUnidad,
    };
  });
}

export type ResumenMes = {
  ingresoTotal: number;
  egresoTotal: number;
  netoTotal: number;
  diasNegativos: number;
  peorDia: { fechaISO: string; neto: number } | null;
  mejorDia: { fechaISO: string; neto: number } | null;
};

export function resumirMes(dias: DiaCalendario[]): ResumenMes {
  const delMes = dias.filter((d) => d.esMesActual);
  let ingresoTotal = 0;
  let egresoTotal = 0;
  let diasNegativos = 0;
  let peor: { fechaISO: string; neto: number } | null = null;
  let mejor: { fechaISO: string; neto: number } | null = null;

  for (const d of delMes) {
    ingresoTotal += d.ingresoTotal;
    egresoTotal += d.egresoComprometido;
    if (d.neto < 0) diasNegativos++;
    if (peor === null || d.neto < peor.neto) {
      peor = { fechaISO: d.fechaISO, neto: d.neto };
    }
    if (mejor === null || d.neto > mejor.neto) {
      mejor = { fechaISO: d.fechaISO, neto: d.neto };
    }
  }

  return {
    ingresoTotal,
    egresoTotal,
    netoTotal: ingresoTotal - egresoTotal,
    diasNegativos,
    peorDia: peor,
    mejorDia: mejor,
  };
}

export function parseMesParam(mes: string | undefined, ahora: Date = new Date()): Date {
  // Formato esperado: YYYY-MM. Si invalido, usar el mes actual.
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return startOfMonth(ahora);
  }
  const d = parseISO(`${mes}-01`);
  if (Number.isNaN(d.getTime())) return startOfMonth(ahora);
  return d;
}

export function isoMes(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
