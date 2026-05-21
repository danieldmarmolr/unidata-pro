import { addDays, parseISO } from 'date-fns';
import {
  proyectarMonto,
  type PromediosUnidad,
} from '../promedios/calcular';

export type ErogacionFlujo = {
  fechaPago: string;
  monto: string | number;
  estado: string;
  esCritico: boolean;
};

export type IngresoPuntualFlujo = {
  fecha: string;
  monto: string | number;
};

export type DiaProyectado = {
  fechaISO: string;
  diaIndex: number; // 0 = dia 1 de la proyeccion
  ingresoProyectado: number; // ingreso por promedios + puntual
  ingresoPuntual: number; // solo el puntual, para distinguir en UI
  egresoComprometido: number;
  saldoAperturaCierre: number; // saldo al cierre del dia
  saldoApertura: number; // saldo al inicio del dia (cierre del dia anterior)
  esEstrenimiento: boolean;
  cantidadErogaciones: number;
  cantidadIngresosPuntuales: number;
};

export type ResumenProyeccion = {
  saldoInicial: number;
  saldoFinal: number;
  cambioTotal: number; // saldoFinal - saldoInicial
  diasEstrenimiento: number;
  primerDiaEstrenimiento: { fechaISO: string; saldo: number } | null;
  peorSaldo: { fechaISO: string; saldo: number };
  mejorSaldo: { fechaISO: string; saldo: number };
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function proyectarSaldo({
  saldoInicial,
  fechaDesde,
  diasHorizonte,
  erogaciones,
  promedios,
  ingresosPuntuales = [],
  umbralEstrenimiento,
}: {
  saldoInicial: number;
  fechaDesde: Date;
  diasHorizonte: number;
  erogaciones: ErogacionFlujo[];
  promedios: PromediosUnidad[];
  ingresosPuntuales?: IngresoPuntualFlujo[];
  umbralEstrenimiento: number;
}): DiaProyectado[] {
  // Agrupar erogaciones por fecha (solo las que TODAVIA NO SE PAGARON).
  // 'pagado' = la plata ya salio de la cuenta, asi que esta reflejada en
  // el saldo inicial. Restarla otra vez seria doble conteo.
  // 'cancelado' y 'rechazado' = nunca van a salir.
  const erogsPorFecha = new Map<string, ErogacionFlujo[]>();
  for (const er of erogaciones) {
    if (
      er.estado === 'cancelado' ||
      er.estado === 'rechazado' ||
      er.estado === 'pagado'
    )
      continue;
    const arr = erogsPorFecha.get(er.fechaPago) ?? [];
    arr.push(er);
    erogsPorFecha.set(er.fechaPago, arr);
  }

  // Agrupar ingresos puntuales por fecha
  const ingPuntPorFecha = new Map<string, IngresoPuntualFlujo[]>();
  for (const ip of ingresosPuntuales) {
    const arr = ingPuntPorFecha.get(ip.fecha) ?? [];
    arr.push(ip);
    ingPuntPorFecha.set(ip.fecha, arr);
  }

  const resultado: DiaProyectado[] = [];
  let saldoActual = saldoInicial;

  for (let i = 0; i < diasHorizonte; i++) {
    const fecha = addDays(fechaDesde, i);
    const fechaISO = isoDate(fecha);
    const erogs = erogsPorFecha.get(fechaISO) ?? [];
    const egreso = erogs.reduce((a, e) => a + Number(e.monto), 0);
    const ingPuntDia = ingPuntPorFecha.get(fechaISO) ?? [];
    const ingresoPuntual = ingPuntDia.reduce((a, x) => a + Number(x.monto), 0);
    // Dia 0 (hoy): el saldo inicial ya incluye lo que se va a facturar
    // hoy, asi que NO sumamos el ingreso proyectado por promedios (seria
    // doble conteo). Si sumamos los egresos pendientes que aun no se
    // pagaron, y los ingresos puntuales agendados para hoy (esos son
    // extraordinarios, no estan en el saldo inicial).
    const ingresoPromedios =
      i === 0
        ? 0
        : promedios.reduce((a, p) => a + proyectarMonto(p, fechaISO), 0);
    const ingreso = ingresoPromedios + ingresoPuntual;

    const saldoApertura = saldoActual;
    const saldoCierre = saldoApertura + ingreso - egreso;
    saldoActual = saldoCierre;

    resultado.push({
      fechaISO,
      diaIndex: i,
      ingresoProyectado: ingreso,
      ingresoPuntual,
      egresoComprometido: egreso,
      saldoApertura,
      saldoAperturaCierre: saldoCierre,
      esEstrenimiento: saldoCierre < umbralEstrenimiento,
      cantidadErogaciones: erogs.length,
      cantidadIngresosPuntuales: ingPuntDia.length,
    });
  }

  return resultado;
}

export function resumirProyeccion(
  saldoInicial: number,
  dias: DiaProyectado[],
): ResumenProyeccion {
  let diasEstrenimiento = 0;
  let primerEstrenimiento: { fechaISO: string; saldo: number } | null = null;
  let peor: { fechaISO: string; saldo: number } = {
    fechaISO: dias[0]?.fechaISO ?? '',
    saldo: saldoInicial,
  };
  let mejor: { fechaISO: string; saldo: number } = {
    fechaISO: dias[0]?.fechaISO ?? '',
    saldo: saldoInicial,
  };

  for (const d of dias) {
    if (d.esEstrenimiento) {
      diasEstrenimiento++;
      if (primerEstrenimiento === null) {
        primerEstrenimiento = {
          fechaISO: d.fechaISO,
          saldo: d.saldoAperturaCierre,
        };
      }
    }
    if (d.saldoAperturaCierre < peor.saldo) {
      peor = { fechaISO: d.fechaISO, saldo: d.saldoAperturaCierre };
    }
    if (d.saldoAperturaCierre > mejor.saldo) {
      mejor = { fechaISO: d.fechaISO, saldo: d.saldoAperturaCierre };
    }
  }

  const saldoFinal = dias.length > 0 ? dias[dias.length - 1].saldoAperturaCierre : saldoInicial;

  return {
    saldoInicial,
    saldoFinal,
    cambioTotal: saldoFinal - saldoInicial,
    diasEstrenimiento,
    primerDiaEstrenimiento: primerEstrenimiento,
    peorSaldo: peor,
    mejorSaldo: mejor,
  };
}
