CREATE TYPE "public"."estado_acuerdo" AS ENUM('pendiente', 'cumplido', 'incumplido');--> statement-breakpoint
CREATE TYPE "public"."tipo_acuerdo" AS ENUM('diferimiento', 'pago_parcial', 'plan_cuotas', 'otro');--> statement-breakpoint
CREATE TABLE "acuerdos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proveedor_id" bigint NOT NULL,
	"tipo" "tipo_acuerdo" NOT NULL,
	"compromiso" text NOT NULL,
	"fecha_compromiso" date,
	"monto_compromiso" numeric(18, 2),
	"estado" "estado_acuerdo" DEFAULT 'pendiente' NOT NULL,
	"contexto" text,
	"erogacion_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_resolucion" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "acuerdos" ADD CONSTRAINT "acuerdos_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acuerdos" ADD CONSTRAINT "acuerdos_erogacion_id_erogaciones_id_fk" FOREIGN KEY ("erogacion_id") REFERENCES "public"."erogaciones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acuerdos_proveedor_idx" ON "acuerdos" USING btree ("proveedor_id");--> statement-breakpoint
CREATE INDEX "acuerdos_estado_fecha_idx" ON "acuerdos" USING btree ("estado","fecha_compromiso");