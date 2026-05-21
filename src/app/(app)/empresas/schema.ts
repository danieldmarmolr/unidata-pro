import { z } from 'zod';

export const empresaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  cuit: z.string().trim().max(20).optional(),
  activa: z.boolean(),
});

export type EmpresaInput = z.infer<typeof empresaSchema>;
