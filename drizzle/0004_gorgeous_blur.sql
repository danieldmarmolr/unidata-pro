CREATE TYPE "public"."rol_usuario" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "perfiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nombre" text,
	"rol" "rol_usuario" DEFAULT 'user' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
