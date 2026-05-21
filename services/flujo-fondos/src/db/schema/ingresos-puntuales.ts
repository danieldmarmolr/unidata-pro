import {
  bigint,
  bigserial,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { bancosMediosPago } from './bancos';
import { empresas } from './empresas';

export const ingresosPuntuales = pgTable(
  'ingresos_puntuales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fecha: date('fecha').notNull(),
    descripcion: text('descripcion').notNull(),
    monto: numeric('monto', { precision: 18, scale: 2 }).notNull(),
    empresaId: bigint('empresa_id', { mode: 'number' })
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    bancoId: bigint('banco_id', { mode: 'number' }).references(
      () => bancosMediosPago.id,
      { onDelete: 'set null' },
    ),
    categoria: text('categoria'),
    notas: text('notas'),
    origen: text('origen').notNull().default('manual'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingresos_puntuales_fecha_idx').on(t.fecha),
    index('ingresos_puntuales_empresa_fecha_idx').on(t.empresaId, t.fecha),
  ],
);

export type IngresoPuntual = typeof ingresosPuntuales.$inferSelect;
export type NuevoIngresoPuntual = typeof ingresosPuntuales.$inferInsert;
