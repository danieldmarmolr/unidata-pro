import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { empresas } from './empresas';
import { unidadesNegocio } from './unidades-negocio';

export const facturacionDiaria = pgTable(
  'facturacion_diaria',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fecha: date('fecha').notNull(),
    monto: numeric('monto', { precision: 18, scale: 2 }).notNull(),
    unidadNegocioId: bigint('unidad_negocio_id', { mode: 'number' })
      .notNull()
      .references(() => unidadesNegocio.id, { onDelete: 'restrict' }),
    empresaId: bigint('empresa_id', { mode: 'number' }).references(() => empresas.id, {
      onDelete: 'set null',
    }),
    esReal: boolean('es_real').notNull().default(true),
    esEventoPuntual: boolean('es_evento_puntual').notNull().default(false),
    origen: text('origen').notNull().default('manual'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('facturacion_fecha_unidad_empresa_uq').on(t.fecha, t.unidadNegocioId, t.empresaId),
    index('facturacion_fecha_idx').on(t.fecha),
  ],
);

export type FacturacionDiaria = typeof facturacionDiaria.$inferSelect;
export type NuevaFacturacionDiaria = typeof facturacionDiaria.$inferInsert;
