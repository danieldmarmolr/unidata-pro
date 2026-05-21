import {
  bigint,
  bigserial,
  date,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bancosMediosPago } from './bancos';
import { fuenteSaldoEnum } from './enums';

export const saldosIniciales = pgTable(
  'saldos_iniciales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fecha: date('fecha').notNull(),
    bancoId: bigint('banco_id', { mode: 'number' })
      .notNull()
      .references(() => bancosMediosPago.id, { onDelete: 'restrict' }),
    saldo: numeric('saldo', { precision: 18, scale: 2 }).notNull(),
    fuente: fuenteSaldoEnum('fuente').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('saldos_fecha_banco_uq').on(t.fecha, t.bancoId)],
);

export type SaldoInicial = typeof saldosIniciales.$inferSelect;
export type NuevoSaldoInicial = typeof saldosIniciales.$inferInsert;
