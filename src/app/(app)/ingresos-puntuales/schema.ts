import { z } from 'zod';

export const CATEGORIAS_INGRESO_PUNTUAL = [
  'cobro_cheque',
  'prestamo',
  'devolucion',
  'aporte_socio',
  'venta_activo',
  'otro',
] as const;

export type CategoriaIngresoPuntual = (typeof CATEGORIAS_INGRESO_PUNTUAL)[number];

export const CATEGORIA_LABELS: Record<CategoriaIngresoPuntual, string> = {
  cobro_cheque: 'Cobro de cheque',
  prestamo: 'Prestamo',
  devolucion: 'Devolucion',
  aporte_socio: 'Aporte de socio',
  venta_activo: 'Venta de activo',
  otro: 'Otro',
};

export const ingresoPuntualSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida'),
  descripcion: z.string().trim().min(1, 'Descripcion obligatoria').max(500),
  monto: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Debe ser un numero positivo'),
  empresaId: z.number().int().positive('Seleccionar empresa'),
  bancoId: z.number().int().positive().nullable().optional(),
  categoria: z.enum(CATEGORIAS_INGRESO_PUNTUAL).nullable().optional(),
  notas: z.string().trim().max(2000).optional(),
});

export type IngresoPuntualInput = z.infer<typeof ingresoPuntualSchema>;
