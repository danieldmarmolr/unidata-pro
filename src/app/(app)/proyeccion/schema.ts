import { z } from 'zod';

export const HORIZONTES_VALIDOS = [15, 30, 60, 90] as const;
export type HorizonteDias = (typeof HORIZONTES_VALIDOS)[number];

export const proyeccionFiltrosSchema = z.object({
  horizonte: z.coerce
    .number()
    .refine((v) => (HORIZONTES_VALIDOS as readonly number[]).includes(v), {
      message: 'Horizonte invalido',
    })
    .catch(30),
  umbral: z.coerce.number().catch(0),
  saldoManual: z.coerce.number().optional(),
});

export type ProyeccionFiltros = z.infer<typeof proyeccionFiltrosSchema>;
