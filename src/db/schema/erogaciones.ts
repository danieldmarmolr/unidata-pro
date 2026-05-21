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
} from 'drizzle-orm/pg-core';
import { bancosMediosPago } from './bancos';
import { empresas } from './empresas';
import { estadoErogacionEnum } from './enums';
import { proveedores } from './proveedores';
import { recurrencias } from './recurrencias';

type Adjuntos = Array<{
  nombre: string;
  url: string;
  tipo?: string;
}>;

export const erogaciones = pgTable(
  'erogaciones',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fechaPago: date('fecha_pago').notNull(),
    fechaCarga: timestamp('fecha_carga', { withTimezone: true }).notNull().defaultNow(),
    descripcion: text('descripcion').notNull(),
    monto: numeric('monto', { precision: 18, scale: 2 }).notNull(),
    moneda: text('moneda').notNull().default('ARS'),
    tipoCambio: numeric('tipo_cambio', { precision: 14, scale: 4 }),
    empresaId: bigint('empresa_id', { mode: 'number' })
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    proveedorId: bigint('proveedor_id', { mode: 'number' }).references(() => proveedores.id, {
      onDelete: 'set null',
    }),
    bancoId: bigint('banco_id', { mode: 'number' })
      .notNull()
      .references(() => bancosMediosPago.id, { onDelete: 'restrict' }),
    estado: estadoErogacionEnum('estado').notNull().default('pendiente'),
    categoria: text('categoria'),
    subcategoria: text('subcategoria'),
    recurrenciaId: bigint('recurrencia_id', { mode: 'number' }).references(() => recurrencias.id, {
      onDelete: 'set null',
    }),
    esRecurrente: boolean('es_recurrente').notNull().default(false),
    esCritico: boolean('es_critico').notNull().default(false),
    adjuntos: jsonb('adjuntos').$type<Adjuntos>().notNull().default([]),
    notas: text('notas'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    pagadoAt: timestamp('pagado_at', { withTimezone: true }),
    prioridadAtraso: text('prioridad_atraso').notNull().default('normal'),
    fechaSugeridaTentativa: date('fecha_sugerida_tentativa'),
    // Si esta en true, la erogacion sigue cargada y visible en la tabla
    // /erogaciones (tachada), pero queda EXCLUIDA de toda proyeccion y
    // calculo agregado. Sirve para armar escenarios "what if" sin borrar
    // datos. Es un flag persistente, no de sesion.
    oculto: boolean('oculto').notNull().default(false),
  },
  (t) => [
    index('erogaciones_fecha_estado_idx').on(t.fechaPago, t.estado),
    index('erogaciones_empresa_fecha_idx').on(t.empresaId, t.fechaPago),
    index('erogaciones_proveedor_idx').on(t.proveedorId),
    index('erogaciones_tentativa_idx').on(t.fechaSugeridaTentativa),
  ],
);

export type PrioridadAtraso = 'normal' | 'laxo';

export type Erogacion = typeof erogaciones.$inferSelect;
export type NuevaErogacion = typeof erogaciones.$inferInsert;
