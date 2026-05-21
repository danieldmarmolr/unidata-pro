-- =====================================================================
-- Setup completo de autenticacion sobre Supabase Auth.
-- =====================================================================

-- 1) FK de perfiles.id -> auth.users(id). Si se borra el user, su perfil
--    se borra en cascada. Drizzle no introspecta el schema 'auth' asi
--    que el FK va a mano.
ALTER TABLE "perfiles"
  ADD CONSTRAINT "perfiles_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- 2) Funcion helper para chequear si el usuario actual es admin.
--    SECURITY DEFINER para que pueda leer perfiles aunque RLS este activo.
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfiles
    WHERE id = (SELECT auth.uid()) AND rol = 'admin' AND activo = true
  );
$$;
--> statement-breakpoint

-- 3) Trigger: cuando se crea un user en auth.users, crear su perfil.
--    El rol default es 'user'. Pedro promueve a 'admin' a mano.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.perfiles (id, email, nombre, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1)),
    'user'
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- 4) RLS en perfiles.
--    - Cada usuario lee su propio perfil.
--    - Cada usuario actualiza solo su propio perfil.
--    - Admins pueden hacer cualquier cosa.
CREATE POLICY "Usuarios leen su propio perfil"
  ON "perfiles" FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "Usuarios actualizan su propio perfil"
  ON "perfiles" FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "Admins acceso total a perfiles"
  ON "perfiles" FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());
--> statement-breakpoint

-- 5) Politicas RLS basicas en las 8 tablas existentes.
--    Cualquier usuario autenticado tiene acceso total (read/write).
--    En el futuro se restringe por rol (ej: 'user' no puede DELETE).
CREATE POLICY "Usuarios autenticados acceso total"
  ON "empresas" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "unidades_negocio" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "bancos_medios_pago" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "proveedores" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "recurrencias" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "erogaciones" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "facturacion_diaria" FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "Usuarios autenticados acceso total"
  ON "saldos_iniciales" FOR ALL TO authenticated USING (true) WITH CHECK (true);
