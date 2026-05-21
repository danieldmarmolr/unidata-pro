import {
  bigint,
  bigserial,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { erogaciones } from './erogaciones';
import { estadoAcuerdoEnum, tipoAcuerdoEnum } from './enums';
import { proveedores } from './proveedores';

// "Promesas hechas a proveedores" como entidad de primera clase.
// Inspirado en el doc de inspiraciones, seccion 3.4: en vez de quedar
// como nota libre, cada acuerdo tiene su propio ciclo de vida.
export const acuerdos = pgTable(
  'acuerdos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    proveedorId: bigint('proveedor_id', { mode: 'number' })
      .notNull()
      .references(() => proveedores.id, { onDelete: 'cascade' }),
    tipo: tipoAcuerdoEnum('tipo').notNull(),
    compromiso: text('compromiso').notNull(),
    fechaCompromiso: date('fecha_compromiso'),
    montoCompromiso: numeric('monto_compromiso', { precision: 18, scale: 2 }),
    estado: estadoAcuerdoEnum('estado').notNull().default('pendiente'),
    contexto: text('contexto'),
    erogacionId: bigint('erogacion_id', { mode: 'number' }).references(
      () => erogaciones.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    fechaResolucion: timestamp('fecha_resolucion', { withTimezone: true }),
  },
  (t) => [
    index('acuerdos_proveedor_idx').on(t.proveedorId),
    index('acuerdos_estado_fecha_idx').on(t.estado, t.fechaCompromiso),
  ],
);

export type Acuerdo = typeof acuerdos.$inferSelect;
export type NuevoAcuerdo = typeof acuerdos.$inferInsert;
