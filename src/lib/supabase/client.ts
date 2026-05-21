// Cliente de Supabase para uso en COMPONENTES CLIENTE de React.
// Se ejecuta en el navegador del usuario. Lee y escribe cookies de sesion
// usando document.cookie.
//
// Para server components / server actions / route handlers usar
// './server.ts'. Para middleware usar './middleware.ts'.

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local',
    );
  }

  return createBrowserClient(url, key);
}
