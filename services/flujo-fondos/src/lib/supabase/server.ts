// Cliente de Supabase para uso en SERVER COMPONENTS, SERVER ACTIONS y
// ROUTE HANDLERS. Se ejecuta en el servidor y lee/escribe cookies via
// el API de next/headers.
//
// Para componentes cliente usar './client.ts'.
// Para middleware usar './middleware.ts'.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local',
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Llamado desde un Server Component que no puede setear cookies.
          // Esto esta OK: el middleware se encarga de refrescar la sesion.
        }
      },
    },
  });
}
