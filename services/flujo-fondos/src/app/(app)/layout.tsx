import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { db } from '@/db';
import { perfiles } from '@/db/schema';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Memoizamos la consulta de perfil por user.id dentro del mismo request,
// asi si otro server component la pide no re-pega a la base.
const cargarPerfil = cache(async (userId: string) => {
  const [perfil] = await db
    .select()
    .from(perfiles)
    .where(eq(perfiles.id, userId));
  return perfil;
});

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const perfil = await cargarPerfil(user.id);

  const perfilSidebar = {
    nombre: perfil?.nombre ?? user.email ?? 'sin nombre',
    email: user.email ?? '',
    rol: perfil?.rol ?? 'sin rol',
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar perfil={perfilSidebar} />
        <main className="flex-1 overflow-auto bg-muted/20">{children}</main>
        <CommandPalette />
        <Toaster richColors closeButton />
      </div>
    </TooltipProvider>
  );
}
