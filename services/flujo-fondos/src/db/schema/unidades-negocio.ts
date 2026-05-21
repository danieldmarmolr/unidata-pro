import { bigserial, boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { canalUnidadNegocioEnum } from './enums';

export const unidadesNegocio = pgTable('unidades_negocio', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull().unique(),
  canal: canalUnidadNegocioEnum('canal').notNull().default('otro'),
  activa: boolean('activa').notNull().default(true),
  configIngesta: jsonb('config_ingesta').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UnidadNegocio = typeof unidadesNegocio.$inferSelect;
export type NuevaUnidadNegocio = typeof unidadesNegocio.$inferInsert;
