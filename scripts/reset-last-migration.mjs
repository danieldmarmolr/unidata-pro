// Borra el registro de la ultima migracion aplicada en drizzle.__drizzle_migrations
// para que la proxima corrida de db:migrate la vuelva a aplicar.
// Util cuando se edita el contenido de una migracion ya registrada como aplicada.
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const sql = postgres(process.env.DIRECT_URL, { prepare: false });

try {
  const before = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5`;
  console.log('Antes (top 5):');
  console.table(before);

  const deleted = await sql`
    DELETE FROM drizzle.__drizzle_migrations
    WHERE id = (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1)
    RETURNING id, hash
  `;
  console.log(`\nBorradas ${deleted.length} fila(s):`, deleted);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await sql.end({ timeout: 2 });
}
