import { differenceInDays, parseISO } from 'date-fns';

export type ErogacionParaPatron = {
  id: number;
  fechaPago: string;
  monto: string;
  descripcion: string;
  proveedorId: number | null;
  proveedorNombre: string | null;
  empresaId: number;
  bancoId: number;
  estado: string;
  recurrenciaId: number | null;
};

export type PatronDetectado = {
  proveedorId: number;
  proveedorNombre: string;
  empresaId: number;
  bancoId: number;
  descripcionTipica: string;
  cantidad: number;
  montoPromedio: number;
  montoMin: number;
  montoMax: number;
  intervaloMedioDias: number;
  frecuenciaSugerida: 'mensual' | 'semanal' | 'quincenal' | 'trimestral' | 'anual' | 'custom';
  fechaInicio: string;
  fechaUltima: string;
  ejemplos: number[]; // ids de erogaciones
  varianzaPct: number;
};

function elegirFrecuencia(
  intervaloDias: number,
): PatronDetectado['frecuenciaSugerida'] {
  if (intervaloDias <= 9) return 'semanal';
  if (intervaloDias <= 18) return 'quincenal';
  if (intervaloDias <= 45) return 'mensual';
  if (intervaloDias <= 100) return 'trimestral';
  if (intervaloDias <= 400) return 'anual';
  return 'custom';
}

export function detectarPatrones(
  filas: ErogacionParaPatron[],
): PatronDetectado[] {
  // Solo erogaciones con proveedor y sin recurrencia asignada
  const candidatas = filas.filter(
    (f) => f.proveedorId !== null && f.recurrenciaId === null,
  );

  // Agrupar por proveedor
  const porProveedor = new Map<number, ErogacionParaPatron[]>();
  for (const f of candidatas) {
    const arr = porProveedor.get(f.proveedorId!) ?? [];
    arr.push(f);
    porProveedor.set(f.proveedorId!, arr);
  }

  const patrones: PatronDetectado[] = [];

  porProveedor.forEach((erogs, proveedorId) => {
    if (erogs.length < 3) return;

    // Ordenar por fecha
    const ordenadas = [...erogs].sort((a, b) => a.fechaPago.localeCompare(b.fechaPago));

    // Calcular intervalos entre pagos consecutivos
    const intervalos: number[] = [];
    for (let i = 1; i < ordenadas.length; i++) {
      const dias = differenceInDays(
        parseISO(ordenadas[i].fechaPago),
        parseISO(ordenadas[i - 1].fechaPago),
      );
      intervalos.push(dias);
    }
    if (intervalos.length === 0) return;

    const intervaloMedio = intervalos.reduce((a, b) => a + b, 0) / intervalos.length;

    // Si los intervalos son muy variables, no es un patron claro
    const intervaloDesvio = Math.sqrt(
      intervalos.reduce((a, x) => a + (x - intervaloMedio) ** 2, 0) / intervalos.length,
    );
    const intervaloVarPct = intervaloMedio > 0 ? (intervaloDesvio / intervaloMedio) * 100 : 100;

    // Si la varianza del intervalo es > 50%, no es patron
    if (intervaloVarPct > 50) return;
    // Si el intervalo medio es > 400 dias o < 3, descartar
    if (intervaloMedio < 3 || intervaloMedio > 400) return;

    // Montos
    const montos = ordenadas.map((e) => Number(e.monto));
    const promedio = montos.reduce((a, b) => a + b, 0) / montos.length;
    const min = Math.min(...montos);
    const max = Math.max(...montos);
    const varianzaPct = promedio > 0 ? ((max - min) / promedio) * 100 : 0;

    // Si varianza de montos > 30%, no es patron (montos demasiado dispares)
    if (varianzaPct > 30) return;

    // Descripcion: tomar la mas frecuente
    const conteoDesc = new Map<string, number>();
    for (const e of ordenadas) {
      conteoDesc.set(e.descripcion, (conteoDesc.get(e.descripcion) ?? 0) + 1);
    }
    const descTipica =
      Array.from(conteoDesc.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      ordenadas[0].descripcion;

    patrones.push({
      proveedorId,
      proveedorNombre: ordenadas[0].proveedorNombre ?? `Proveedor #${proveedorId}`,
      empresaId: ordenadas[0].empresaId,
      bancoId: ordenadas[0].bancoId,
      descripcionTipica: descTipica,
      cantidad: ordenadas.length,
      montoPromedio: promedio,
      montoMin: min,
      montoMax: max,
      intervaloMedioDias: Math.round(intervaloMedio),
      frecuenciaSugerida: elegirFrecuencia(intervaloMedio),
      fechaInicio: ordenadas[0].fechaPago,
      fechaUltima: ordenadas[ordenadas.length - 1].fechaPago,
      ejemplos: ordenadas.map((e) => e.id),
      varianzaPct,
    });
  });

  // Ordenar por cantidad de ocurrencias desc, despues por varianza asc
  return patrones.sort((a, b) => {
    if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
    return a.varianzaPct - b.varianzaPct;
  });
}
