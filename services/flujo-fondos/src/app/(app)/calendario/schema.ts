import { z } from 'zod';

export const calendarioFiltrosSchema = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  empresa: z.coerce.number().int().positive().optional(),
});

export type CalendarioFiltros = z.infer<typeof calendarioFiltrosSchema>;
