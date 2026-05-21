import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { bancosMediosPago } from './bancos';
import { empresas } from './empresas';
import { frecuenciaRecurrenciaEnum } from './enums';
import { proveedores } from './proveedores';

type Indexacion = {
  tipo?: 'inflacion' | 'tasa_fija' | 'tasa_variable' | 'ninguna';
  valor?: number;
  notas?: string;
};

export const recurrencias = pgTable('recurrencias', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  descripcion: text('descripcion').notNull(),
  montoBase: numeric('monto_base', { precision: 18, scale: 2 }),
  frecuencia: frecuenciaRecurrenciaEnum('frecuencia').notNull(),
  fechaInicio: date('fecha_inicio').notNull(),
  fechaFin: date('fecha_fin'),
  cuotasTotales: integer('cuotas_totales'),
  proveedorId: bigint('proveedor_id', { mode: 'number' }).references(() => proveedores.id, {
    onDelete: 'set null',
  }),
  empresaId: bigint('empresa_id', { mode: 'number' }).references(() => empresas.id, {
    onDelete: 'set null',
  }),
  bancoId: bigint('banco_id', { mode: 'number' }).references(() => bancosMediosPago.id, {
    onDelete: 'set null',
  }),
  indexacion: jsonb('indexacion').$type<Indexacion>().notNull().default({}),
  activa: boolean('activa').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Recurrencia = typeof recurrencias.$inferSelect;
export type NuevaRecurrencia = typeof recurrencias.$inferInsert;
