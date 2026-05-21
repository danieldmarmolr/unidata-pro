ALTER TABLE "erogaciones" ADD COLUMN "prioridad_atraso" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "erogaciones" ADD COLUMN "fecha_sugerida_tentativa" date;--> statement-breakpoint
CREATE INDEX "erogaciones_tentativa_idx" ON "erogaciones" USING btree ("fecha_sugerida_tentativa");