'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type LoginState = {
  error?: string;
} | null;

export async function iniciarSesion(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Datos invalidos' };
  }

  if (!email.trim() || !password) {
    return { error: 'Email y contraseña son obligatorios' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return { error: traducirError(error.message) };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function cerrarSesion() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

function traducirError(mensajeEn: string): string {
  if (mensajeEn.includes('Invalid login credentials')) {
    return 'Email o contraseña incorrectos.';
  }
  if (mensajeEn.includes('Email not confirmed')) {
    return 'Tenes que confirmar tu email antes de entrar.';
  }
  return mensajeEn;
}
