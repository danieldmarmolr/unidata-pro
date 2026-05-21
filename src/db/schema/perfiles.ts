import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { rolUsuarioEnum } from './enums';

// Tabla perfiles vinculada 1-a-1 con auth.users de Supabase.
// El FK a auth.users(id) y el trigger que la auto-popula se agregan
// en la migracion 0005 custom (Drizzle no introspecta el schema 'auth').
export const perfiles = pgTable('perfiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  nombre: text('nombre'),
  rol: rolUsuarioEnum('rol').notNull().default('user'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Perfil = typeof perfiles.$inferSelect;
export type NuevoPerfil = typeof perfiles.$inferInsert;
