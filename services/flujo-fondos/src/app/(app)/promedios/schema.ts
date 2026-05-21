import { z } from 'zod';

export const VENTANAS_VALIDAS = [4, 8, 12, 26, 52] as const;
export type VentanaSemanas = (typeof VENTANAS_VALIDAS)[number];

export const DECAYS_PRESETS: { label: string; value: number; desc: string }[] = [
  { label: 'Sin ponderar', value: 1, desc: 'Promedio simple (todas las semanas pesan igual)' },
  { label: 'Suave', value: 0.95, desc: 'Las semanas recientes pesan un poco mas' },
  { label: 'Balanceado', value: 0.85, desc: 'Default: las recientes pesan notablemente mas' },
  { label: 'Agresivo', value: 0.7, desc: 'Solo las ultimas 2-3 semanas pesan en serio' },
];

export const filtrosPromediosSchema = z.object({
  ventana: z.coerce
    .number()
    .refine((v) => (VENTANAS_VALIDAS as readonly number[]).includes(v), {
      message: 'Ventana invalida',
    })
    .catch(12),
  decay: z.coerce
    .number()
    .min(0.5)
    .max(1)
    .catch(0.85),
});

export type FiltrosPromedios = z.infer<typeof filtrosPromediosSchema>;
