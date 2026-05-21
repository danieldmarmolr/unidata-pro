import { bigserial, boolean, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tipoBancoEnum } from './enums';

export const bancosMediosPago = pgTable('bancos_medios_pago', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull().unique(),
  tipo: tipoBancoEnum('tipo').notNull().default('banco'),
  saldoActual: numeric('saldo_actual', { precision: 18, scale: 2 }),
  moneda: text('moneda').notNull().default('ARS'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BancoMedioPago = typeof bancosMediosPago.$inferSelect;
export type NuevoBancoMedioPago = typeof bancosMediosPago.$inferInsert;
