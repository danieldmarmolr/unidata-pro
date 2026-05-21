CREATE TYPE "public"."estado_erogacion" AS ENUM('pendiente', 'en_curso', 'pagado', 'cancelado', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."frecuencia_recurrencia" AS ENUM('mensual', 'semanal', 'quincenal', 'trimestral', 'anual', 'custom');--> statement-breakpoint
CREATE TYPE "public"."fuente_saldo" AS ENUM('manual', 'api_banco', 'extracto_csv');--> statement-breakpoint
CREATE TABLE "recurrencias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"descripcion" text NOT NULL,
	"monto_base" numeric(18, 2),
	"frecuencia" "frecuencia_recurrencia" NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin" date,
	"cuotas_totales" integer,
	"proveedor_id" bigint,
	"empresa_id" bigint,
	"banco_id" bigint,
	"indexacion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erogaciones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha_pago" date NOT NULL,
	"fecha_carga" timestamp with time zone DEFAULT now() NOT NULL,
	"descripcion" text NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"moneda" text DEFAULT 'ARS' NOT NULL,
	"tipo_cambio" numeric(14, 4),
	"empresa_id" bigint NOT NULL,
	"proveedor_id" bigint,
	"banco_id" bigint NOT NULL,
	"estado" "estado_erogacion" DEFAULT 'pendiente' NOT NULL,
	"categoria" text,
	"subcategoria" text,
	"recurrencia_id" bigint,
	"es_recurrente" boolean DEFAULT false NOT NULL,
	"es_critico" boolean DEFAULT false NOT NULL,
	"adjuntos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notas" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pagado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "facturacion_diaria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"unidad_negocio_id" bigint NOT NULL,
	"empresa_id" bigint,
	"es_real" boolean DEFAULT true NOT NULL,
	"es_evento_puntual" boolean DEFAULT false NOT NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saldos_iniciales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"banco_id" bigint NOT NULL,
	"saldo" numeric(18, 2) NOT NULL,
	"fuente" "fuente_saldo" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_banco_id_bancos_medios_pago_id_fk" FOREIGN KEY ("banco_id") REFERENCES "public"."bancos_medios_pago"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erogaciones" ADD CONSTRAINT "erogaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erogaciones" ADD CONSTRAINT "erogaciones_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erogaciones" ADD CONSTRAINT "erogaciones_banco_id_bancos_medios_pago_id_fk" FOREIGN KEY ("banco_id") REFERENCES "public"."bancos_medios_pago"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erogaciones" ADD CONSTRAINT "erogaciones_recurrencia_id_recurrencias_id_fk" FOREIGN KEY ("recurrencia_id") REFERENCES "public"."recurrencias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturacion_diaria" ADD CONSTRAINT "facturacion_diaria_unidad_negocio_id_unidades_negocio_id_fk" FOREIGN KEY ("unidad_negocio_id") REFERENCES "public"."unidades_negocio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facturacion_diaria" ADD CONSTRAINT "facturacion_diaria_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos_iniciales" ADD CONSTRAINT "saldos_iniciales_banco_id_bancos_medios_pago_id_fk" FOREIGN KEY ("banco_id") REFERENCES "public"."bancos_medios_pago"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erogaciones_fecha_estado_idx" ON "erogaciones" USING btree ("fecha_pago","estado");--> statement-breakpoint
CREATE INDEX "erogaciones_empresa_fecha_idx" ON "erogaciones" USING btree ("empresa_id","fecha_pago");--> statement-breakpoint
CREATE INDEX "erogaciones_proveedor_idx" ON "erogaciones" USING btree ("proveedor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facturacion_fecha_unidad_empresa_uq" ON "facturacion_diaria" USING btree ("fecha","unidad_negocio_id","empresa_id");--> statement-breakpoint
CREATE INDEX "facturacion_fecha_idx" ON "facturacion_diaria" USING btree ("fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "saldos_fecha_banco_uq" ON "saldos_iniciales" USING btree ("fecha","banco_id");