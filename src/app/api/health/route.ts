import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.from('_health_check_').select('id').limit(1);

    const tableMissing =
      error?.code === 'PGRST205' ||
      error?.code === '42P01' ||
      error?.message?.toLowerCase().includes('does not exist') ||
      error?.message?.toLowerCase().includes('could not find the table');

    if (error && !tableMissing) {
      return Response.json(
        {
          ok: false,
          message: 'No se pudo conectar con Supabase',
          error: error.message,
          code: error.code,
        },
        { status: 502 },
      );
    }

    return Response.json({
      ok: true,
      message: 'Supabase conectado correctamente.',
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
