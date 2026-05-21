import { z } from 'zod';

export const TIPO_ACUERDO = [
  'diferimiento',
  'pago_parcial',
  'plan_cuotas',
  'otro',
] as const;
export type TipoAcuerdo = (typeof TIPO_ACUERDO)[number];

export const TIPO_ACUERDO_LABELS: Record<TipoAcuerdo, string> = {
  diferimiento: 'Diferimiento',
  pago_parcial: 'Pago parcial',
  plan_cuotas: 'Plan de cuotas',
  otro: 'Otro',
};

export const TIPO_ACUERDO_DESC: Record<TipoAcuerdo, string> = {
  diferimiento: 'Mover la fecha de pago acordada con el proveedor',
  pago_parcial: 'Pagar una parte ahora y la otra despues',
  plan_cuotas: 'Dividir el pago en varias cuotas',
  otro: 'Otro tipo de acuerdo',
};

export const ESTADO_ACUERDO = ['pendiente', 'cumplido', 'incumplido'] as const;
export type EstadoAcuerdo = (typeof ESTADO_ACUERDO)[number];

export const ESTADO_ACUERDO_LABELS: Record<EstadoAcuerdo, string> = {
  pendiente: 'Pendiente',
  cumplido: 'Cumplido',
  incumplido: 'Incumplido',
};

// Form sin z.coerce (RHF necesita input=output)
export const acuerdoFormSchema = z.object({
  proveedorId: z.number().int().positive('Seleccionar proveedor'),
  tipo: z.enum(TIPO_ACUERDO),
  compromiso: z.string().trim().min(1, 'El compromiso es obligatorio').max(500),
  fechaCompromiso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida')
    .optional()
    .or(z.literal('')),
  montoCompromiso: z
    .string()
    .trim()
    .regex(/^(\d+(\.\d+)?)?$/, 'Debe ser un numero')
    .optional()
    .or(z.literal('')),
  estado: z.enum(ESTADO_ACUERDO),
  contexto: z.string().trim().max(2000).optional().or(z.literal('')),
  erogacionId: z.number().int().positive().optional(),
});

export type AcuerdoInput = z.infer<typeof acuerdoFormSchema>;

// Filtros URL
export const acuerdosFiltersSchema = z.object({
  estado: z.enum(ESTADO_ACUERDO).optional(),
  tipo: z.enum(TIPO_ACUERDO).optional(),
  proveedor: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
});

export type AcuerdosFilters = z.infer<typeof acuerdosFiltersSchema>;
