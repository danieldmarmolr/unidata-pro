import { z } from 'zod';

export const bancoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  tipo: z.enum(['banco', 'billetera_digital', 'efectivo', 'otro']),
  saldoActual: z
    .union([
      z
        .string()
        .trim()
        .regex(/^-?\d+(\.\d+)?$/, 'Debe ser un numero')
        .transform((v) => v),
      z.literal(''),
    ])
    .optional(),
  moneda: z.string().trim().min(1, 'La moneda es obligatoria').max(10),
  activo: z.boolean(),
});

export type BancoInput = z.infer<typeof bancoSchema>;
