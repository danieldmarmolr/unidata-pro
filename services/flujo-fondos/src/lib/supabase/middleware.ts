// Helper para el middleware de Next.js (src/middleware.ts).
// - Refresca el token de Supabase Auth en cada request.
// - Si el usuario no esta logueado y trata de entrar a una ruta privada,
//   lo redirige a /login.
//
// Para server components / server actions usar './server.ts'.
// Para componentes cliente usar './client.ts'.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const RUTAS_PUBLICAS = ['/login'];
const PREFIJOS_PUBLICOS = ['/api', '/_next', '/favicon'];

function esRutaPublica(pathname: string): boolean {
  if (RUTAS_PUBLICAS.includes(pathname)) return true;
  return PREFIJOS_PUBLICOS.some((prefijo) => pathname.startsWith(prefijo));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local',
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !esRutaPublica(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}
