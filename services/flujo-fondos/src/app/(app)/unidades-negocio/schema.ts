import { z } from 'zod';

export const unidadNegocioSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  canal: z.enum(['directo', 'marketplace', 'dropshipping', 'otro']),
  activa: z.boolean(),
});

export type UnidadNegocioInput = z.infer<typeof unidadNegocioSchema>;
