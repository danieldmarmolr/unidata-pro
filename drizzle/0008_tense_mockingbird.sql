CREATE TABLE "ingresos_puntuales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"descripcion" text NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"empresa_id" bigint NOT NULL,
	"banco_id" bigint,
	"categoria" text,
	"notas" text,
	"origen" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingresos_puntuales" ADD CONSTRAINT "ingresos_puntuales_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingresos_puntuales" ADD CONSTRAINT "ingresos_puntuales_banco_id_bancos_medios_pago_id_fk" FOREIGN KEY ("banco_id") REFERENCES "public"."bancos_medios_pago"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingresos_puntuales_fecha_idx" ON "ingresos_puntuales" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "ingresos_puntuales_empresa_fecha_idx" ON "ingresos_puntuales" USING btree ("empresa_id","fecha");--> statement-breakpoint
ALTER TABLE "ingresos_puntuales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "Usuarios autenticados acceso total"
  ON "ingresos_puntuales" FOR ALL TO authenticated USING (true) WITH CHECK (true);