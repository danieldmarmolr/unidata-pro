import { z } from 'zod';

export const ESTADO_EROGACION = [
  'pendiente',
  'en_curso',
  'pagado',
  'cancelado',
  'rechazado',
] as const;

export type EstadoErogacion = (typeof ESTADO_EROGACION)[number];

export const ESTADO_LABELS: Record<EstadoErogacion, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  pagado: 'Pagado',
  cancelado: 'Cancelado',
  rechazado: 'Rechazado',
};

// Schema del formulario (cliente + server share).
// Sin z.coerce para que useForm tenga tipos input=output (RHF necesita eso).
// La coercion desde strings de Select la hace el Controller con Number(v).
export const erogacionFormSchema = z.object({
  fechaPago: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida (formato YYYY-MM-DD)'),
  descripcion: z.string().trim().min(1, 'La descripcion es obligatoria').max(500),
  monto: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Debe ser un numero positivo'),
  moneda: z.string().trim().min(1).max(10),
  empresaId: z.number().int().positive('Seleccionar empresa'),
  proveedorId: z.number().int().positive().optional(),
  bancoId: z.number().int().positive('Seleccionar banco'),
  estado: z.enum(ESTADO_EROGACION),
  categoria: z.string().trim().max(80).optional(),
  esCritico: z.boolean(),
  notas: z.string().trim().max(2000).optional(),
});

export type ErogacionInput = z.infer<typeof erogacionFormSchema>;

// Schema de filtros (lo que entra por URL search params).
export const erogacionFiltersSchema = z.object({
  estado: z.enum(ESTADO_EROGACION).optional(),
  empresa: z.coerce.number().int().positive().optional(),
  banco: z.coerce.number().int().positive().optional(),
  proveedor: z.coerce.number().int().positive().optional(),
  desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().trim().optional(),
  oculto: z.enum(['1', '0']).optional(),
  sort: z
    .enum(['fecha_asc', 'fecha_desc', 'monto_asc', 'monto_desc'])
    .default('fecha_asc'),
});

export type ErogacionFilters = z.infer<typeof erogacionFiltersSchema>;
