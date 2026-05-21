import { pgEnum } from 'drizzle-orm/pg-core';

export const canalUnidadNegocioEnum = pgEnum('canal_unidad_negocio', [
  'directo',
  'marketplace',
  'dropshipping',
  'otro',
]);

export const tipoBancoEnum = pgEnum('tipo_banco', [
  'banco',
  'billetera_digital',
  'efectivo',
  'otro',
]);

export const prioridadProveedorEnum = pgEnum('prioridad_proveedor', [
  'alta',
  'media',
  'baja',
]);

export const estadoErogacionEnum = pgEnum('estado_erogacion', [
  'pendiente',
  'en_curso',
  'pagado',
  'cancelado',
  'rechazado',
]);

export const frecuenciaRecurrenciaEnum = pgEnum('frecuencia_recurrencia', [
  'mensual',
  'semanal',
  'quincenal',
  'trimestral',
  'anual',
  'custom',
]);

export const fuenteSaldoEnum = pgEnum('fuente_saldo', [
  'manual',
  'api_banco',
  'extracto_csv',
]);

export const rolUsuarioEnum = pgEnum('rol_usuario', ['admin', 'user']);

export const tipoAcuerdoEnum = pgEnum('tipo_acuerdo', [
  'diferimiento',
  'pago_parcial',
  'plan_cuotas',
  'otro',
]);

export const estadoAcuerdoEnum = pgEnum('estado_acuerdo', [
  'pendiente',
  'cumplido',
  'incumplido',
]);
