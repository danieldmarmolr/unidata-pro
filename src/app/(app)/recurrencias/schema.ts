import { z } from 'zod';

export const FRECUENCIAS = [
  'mensual',
  'semanal',
  'quincenal',
  'trimestral',
  'anual',
  'custom',
] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

export const FRECUENCIA_LABELS: Record<Frecuencia, string> = {
  mensual: 'Mensual',
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  trimestral: 'Trimestral',
  anual: 'Anual',
  custom: 'Custom',
};

export const recurrenciaFormSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripcion es obligatoria').max(500),
  montoBase: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Debe ser un numero positivo'),
  frecuencia: z.enum(FRECUENCIAS),
  fechaInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida (YYYY-MM-DD)'),
  fechaFin: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  cuotasTotales: z.number().int().positive().optional(),
  proveedorId: z.number().int().positive().optional(),
  empresaId: z.number().int().positive('Seleccionar empresa'),
  bancoId: z.number().int().positive('Seleccionar banco'),
  activa: z.boolean(),
});

export type RecurrenciaInput = z.infer<typeof recurrenciaFormSchema>;
