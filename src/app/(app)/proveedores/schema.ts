import { z } from 'zod';

const numericoString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Debe ser un numero');

export const proveedorSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  cuit: z.string().trim().max(20).optional(),
  prioridad: z.enum(['alta', 'media', 'baja']),
  saldoPendiente: z.union([numericoString, z.literal('')]).optional(),
  notas: z.string().trim().max(2000).optional(),
  tagsRaw: z.string().optional(),
  contactoNombre: z.string().trim().max(120).optional(),
  contactoEmail: z
    .union([z.string().trim().email('Email invalido'), z.literal('')])
    .optional(),
  contactoTelefono: z.string().trim().max(40).optional(),
});

export type ProveedorInput = z.infer<typeof proveedorSchema>;
