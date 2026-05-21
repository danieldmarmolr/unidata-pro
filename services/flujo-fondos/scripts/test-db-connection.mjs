import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const directUrl = process.env.DIRECT_URL;
const databaseUrl = process.env.DATABASE_URL;

console.log('--- Test de conexion a Supabase ---');
console.log('DIRECT_URL host:', directUrl ? new URL(directUrl).host : '(no definida)');
console.log('DATABASE_URL host:', databaseUrl ? new URL(databaseUrl).host : '(no definida)');

async function testConnection(label, urlStr) {
  if (!urlStr) {
    console.log(`\n[${label}] no definida, salteando`);
    return;
  }
  console.log(`\n[${label}] intentando conectar...`);
  const sql = postgres(urlStr, { connect_timeout: 15 });
  try {
    const rows = await sql`SELECT current_database() as db, current_user as user, version() as version`;
    console.log(`[${label}] OK`);
    console.log(`  database: ${rows[0].db}`);
    console.log(`  user:     ${rows[0].user}`);
    console.log(`  version:  ${rows[0].version.split(',')[0]}`);
  } catch (e) {
    console.error(`[${label}] ERROR: ${e.message}`);
    if (e.code) console.error(`  code: ${e.code}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

await testConnection('DIRECT_URL  (5432)', directUrl);
await testConnection('DATABASE_URL (6543)', databaseUrl);
