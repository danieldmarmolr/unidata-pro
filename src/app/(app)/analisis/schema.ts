import { z } from 'zod';

export const PERIODOS = [
  'este_mes',
  'mes_pasado',
  'ultimos_30',
  'ultimos_90',
  'ultimos_365',
  'todo',
] as const;
export type Periodo = (typeof PERIODOS)[number];

export const PERIODO_LABELS: Record<Periodo, string> = {
  este_mes: 'Este mes',
  mes_pasado: 'Mes pasado',
  ultimos_30: 'Ultimos 30 dias',
  ultimos_90: 'Ultimos 90 dias',
  ultimos_365: 'Ultimo año',
  todo: 'Todo',
};

export const analisisFiltrosSchema = z.object({
  periodo: z
    .enum(PERIODOS)
    .catch('este_mes'),
  estado: z.enum(['todos', 'pagado', 'pendiente_curso']).catch('todos'),
});

export type AnalisisFiltros = z.infer<typeof analisisFiltrosSchema>;
