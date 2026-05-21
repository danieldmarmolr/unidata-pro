import { z } from 'zod';

export const facturacionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida'),
  unidadNegocioId: z.number().int().positive('Seleccionar unidad'),
  monto: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Debe ser un numero positivo'),
  empresaId: z.number().int().positive().nullable().optional(),
  esEventoPuntual: z.boolean().optional(),
});

export type FacturacionInput = z.infer<typeof facturacionSchema>;
