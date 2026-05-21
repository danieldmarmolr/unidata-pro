CREATE TYPE "public"."canal_unidad_negocio" AS ENUM('directo', 'marketplace', 'dropshipping', 'otro');--> statement-breakpoint
CREATE TYPE "public"."prioridad_proveedor" AS ENUM('alta', 'media', 'baja');--> statement-breakpoint
CREATE TYPE "public"."tipo_banco" AS ENUM('banco', 'billetera_digital', 'efectivo', 'otro');--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "unidades_negocio" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"canal" "canal_unidad_negocio" DEFAULT 'otro' NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"config_ingesta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidades_negocio_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "bancos_medios_pago" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_banco" DEFAULT 'banco' NOT NULL,
	"saldo_actual" numeric(18, 2),
	"moneda" text DEFAULT 'ARS' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bancos_medios_pago_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text,
	"prioridad" "prioridad_proveedor" DEFAULT 'media' NOT NULL,
	"saldo_pendiente" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notas" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"contacto" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
