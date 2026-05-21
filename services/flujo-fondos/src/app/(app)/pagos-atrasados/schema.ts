import { z } from 'zod';

export const prioridadAtrasoSchema = z.enum(['normal', 'laxo']);
export type PrioridadAtraso = z.infer<typeof prioridadAtrasoSchema>;

export const PRIORIDAD_LABELS: Record<PrioridadAtraso, string> = {
  normal: 'Normal',
  laxo: 'Laxo',
};

export const cambiarPrioridadSchema = z.object({
  id: z.number().int().positive(),
  prioridad: prioridadAtrasoSchema,
});

export const idsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'Seleccioná al menos un pago'),
});

export const paresSugerenciaSchema = z.object({
  pares: z
    .array(
      z.object({
        id: z.number().int().positive(),
        fechaSugerida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .min(1),
});

export const colchonSchema = z.object({
  colchon: z.number().finite().nonnegative(),
});
