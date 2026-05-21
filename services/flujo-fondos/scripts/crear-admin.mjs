// Crea un usuario admin usando la SECRET_KEY de Supabase.
//
// Uso (en una sola linea para que las env vars no queden en history):
//
//   ADMIN_EMAIL=tu@mail.com ADMIN_PASSWORD=tu_pass_temporal ADMIN_NOMBRE="Tu Nombre" node scripts/crear-admin.mjs
//
// Pasos que ejecuta:
//   1. Crea el usuario en auth.users con el mail ya confirmado (no requiere verificacion).
//   2. El trigger handle_new_user() crea automaticamente la fila en public.perfiles
//      con rol 'user'.
//   3. Promueve el perfil a rol 'admin'.
//
// IMPORTANTE: usa la SECRET_KEY que ignora RLS. No correr este script en CI o exponerlo.

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const nombre = process.env.ADMIN_NOMBRE ?? email?.split('@')[0];

if (!email || !password) {
  console.error('Error: Definir ADMIN_EMAIL y ADMIN_PASSWORD como env vars al llamar el script.');
  console.error('Ej:');
  console.error('  ADMIN_EMAIL=tu@mail.com ADMIN_PASSWORD=tu_pass node scripts/crear-admin.mjs');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`\n--- Creando admin ---`);
console.log(`Email:  ${email}`);
console.log(`Nombre: ${nombre}`);

console.log(`\n[1/3] Creando usuario en auth.users...`);
const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { nombre },
});

if (createErr) {
  console.error('  ERROR:', createErr.message);
  process.exit(1);
}
const userId = createData.user.id;
console.log(`  OK. user id: ${userId}`);

console.log(`\n[2/3] Verificando que el trigger creo el perfil...`);
const { data: perfil, error: getErr } = await supabase
  .from('perfiles')
  .select('id, email, nombre, rol, activo')
  .eq('id', userId)
  .single();

if (getErr || !perfil) {
  console.error('  ERROR: el trigger no creo el perfil. Detalle:', getErr?.message);
  process.exit(1);
}
console.log(`  OK. Perfil creado con rol '${perfil.rol}'.`);

if (perfil.rol === 'admin') {
  console.log(`\n[3/3] Ya tiene rol admin, no hace falta promover.`);
} else {
  console.log(`\n[3/3] Promoviendo a admin...`);
  const { error: updateErr } = await supabase
    .from('perfiles')
    .update({ rol: 'admin' })
    .eq('id', userId);

  if (updateErr) {
    console.error('  ERROR:', updateErr.message);
    process.exit(1);
  }
  console.log(`  OK. Promovido a admin.`);
}

console.log(`\nListo. Pedro puede entrar a /login con ${email} y la password que pasaste.\n`);
