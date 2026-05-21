-- Habilita Row Level Security en las 4 tablas base.
-- Sin politicas: la publishable key no puede leer ni escribir.
-- La secret key (service_role) y la conexion directa (Drizzle) siguen pudiendo todo.
-- Cuando agreguemos login, definimos politicas para usuarios autenticados.

ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "unidades_negocio" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bancos_medios_pago" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proveedores" ENABLE ROW LEVEL SECURITY;
