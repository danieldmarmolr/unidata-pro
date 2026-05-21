-- RLS en la tabla acuerdos. Politica simple "authenticated full access"
-- como en el resto de las tablas.

ALTER TABLE "acuerdos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "acuerdos" FOR ALL TO authenticated USING (true) WITH CHECK (true);
