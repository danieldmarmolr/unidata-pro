-- Habilita Row Level Security en las 4 tablas transaccionales.
-- Sin politicas: solo la secret key y la conexion directa de Drizzle pueden leer/escribir.

ALTER TABLE "recurrencias" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "erogaciones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "facturacion_diaria" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "saldos_iniciales" ENABLE ROW LEVEL SECURITY;
