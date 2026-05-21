import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

try {
  const rows = await sql`
    SELECT
      c.relname AS tabla,
      c.relrowsecurity AS rls_habilitado,
      (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.relname) AS columnas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE '\\_%' ESCAPE '\\'
    ORDER BY c.relname
  `;
  console.log('Tablas en schema public:\n');
  console.table(rows);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await sql.end({ timeout: 2 });
}
