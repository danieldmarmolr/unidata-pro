import { bigserial, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { prioridadProveedorEnum } from './enums';

type ContactoProveedor = {
  nombre?: string;
  email?: string;
  telefono?: string;
};

export const proveedores = pgTable('proveedores', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull(),
  cuit: text('cuit'),
  prioridad: prioridadProveedorEnum('prioridad').notNull().default('media'),
  saldoPendiente: numeric('saldo_pendiente', { precision: 18, scale: 2 }).notNull().default('0'),
  notas: text('notas'),
  tags: text('tags').array().notNull().default([]),
  contacto: jsonb('contacto').$type<ContactoProveedor>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Proveedor = typeof proveedores.$inferSelect;
export type NuevoProveedor = typeof proveedores.$inferInsert;
