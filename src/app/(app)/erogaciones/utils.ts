import type { EstadoErogacion } from './schema';

export const ESTADO_PILL_CLASS: Record<EstadoErogacion, string> = {
  pendiente:
    'bg-warning/10 text-warning border-warning/30',
  en_curso:
    'bg-info/10 text-info border-info/30',
  pagado:
    'bg-success/10 text-success border-success/30',
  cancelado:
    'bg-muted text-muted-foreground border-border',
  rechazado:
    'bg-danger/10 text-danger border-danger/30',
};

export const fmtCurrency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
});

export function fmtMonto(monto: string | number): string {
  return fmtCurrency.format(Number(monto));
}

export function fmtFechaAR(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-');
  return `${d}/${m}/${y}`;
}

// "hoy" / "manana" / "ayer" / "en 5 dias" / "hace 12 dias"
export function fmtFechaRelativa(fechaISO: string, referencia: Date = new Date()): string {
  const ref = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate(),
  );
  const [y, m, d] = fechaISO.split('-').map((s) => parseInt(s, 10));
  const target = new Date(y, m - 1, d);
  const diff = Math.round((target.getTime() - ref.getTime()) / 86400000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'manana';
  if (diff === -1) return 'ayer';
  if (diff > 0 && diff <= 7) return `en ${diff} dias`;
  if (diff < 0 && diff >= -30) return `hace ${-diff} dias`;
  return fmtFechaAR(fechaISO);
}

export function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
