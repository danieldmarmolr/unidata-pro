import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

try {
  const rows = await sql`
    SELECT schemaname, tablename, policyname, cmd, roles::text AS roles
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;
  console.log(`Politicas RLS en schema public (${rows.length} total):\n`);
  console.table(rows);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await sql.end({ timeout: 2 });
}
