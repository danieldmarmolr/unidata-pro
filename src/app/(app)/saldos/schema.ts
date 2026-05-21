import { z } from 'zod';

export const BANCO_CONSOLIDADO_NOMBRE = 'Total consolidado';

export const saldoFormSchema = z.object({
  bancoId: z.number().int().positive('Seleccionar banco'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida'),
  saldo: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, 'Debe ser un numero'),
  fuente: z.enum(['manual', 'api_banco', 'extracto_csv']).default('manual'),
});

export type SaldoInput = z.infer<typeof saldoFormSchema>;

export const saldoConsolidadoFormSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida'),
  saldo: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, 'Debe ser un numero'),
});

export type SaldoConsolidadoInput = z.infer<typeof saldoConsolidadoFormSchema>;
