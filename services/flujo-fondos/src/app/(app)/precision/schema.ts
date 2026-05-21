import { z } from 'zod';

export const HORIZONTES_ATRAS = [14, 30, 60, 90] as const;
export type HorizonteAtras = (typeof HORIZONTES_ATRAS)[number];

export const precisionFiltrosSchema = z.object({
  diasAtras: z.coerce
    .number()
    .refine((v) => (HORIZONTES_ATRAS as readonly number[]).includes(v))
    .catch(30),
  ventana: z.coerce
    .number()
    .refine((v) => [4, 8, 12, 26, 52].includes(v))
    .catch(12),
  decay: z.coerce.number().min(0.5).max(1).catch(0.85),
  unidad: z.coerce.number().int().positive().optional(),
});

export type PrecisionFiltros = z.infer<typeof precisionFiltrosSchema>;
