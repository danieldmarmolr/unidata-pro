import type { EstadoAcuerdo, TipoAcuerdo } from './schema';

export const ESTADO_ACUERDO_PILL: Record<EstadoAcuerdo, string> = {
  pendiente: 'bg-warning/10 text-warning border-warning/30',
  cumplido: 'bg-success/10 text-success border-success/30',
  incumplido: 'bg-danger/10 text-danger border-danger/30',
};

export const TIPO_ACUERDO_PILL: Record<TipoAcuerdo, string> = {
  diferimiento: 'bg-info/10 text-info border-info/30',
  pago_parcial: 'bg-primary/10 text-primary border-primary/30',
  plan_cuotas: 'bg-secondary text-secondary-foreground border-border',
  otro: 'bg-muted text-muted-foreground border-border',
};

export function diasHasta(fechaISO: string | null, referencia: Date = new Date()): number | null {
  if (!fechaISO) return null;
  const [y, m, d] = fechaISO.split('-').map((s) => parseInt(s, 10));
  const target = new Date(y, m - 1, d);
  const ref = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate(),
  );
  return Math.round((target.getTime() - ref.getTime()) / 86400000);
}
