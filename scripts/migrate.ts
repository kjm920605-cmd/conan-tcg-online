import { PostgresStore } from '../src/server/persistence/postgres.ts';
async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const store = new PostgresStore({ connectionString: process.env.DATABASE_URL, schema: process.env.DATABASE_SCHEMA ?? 'public' });
  try { await store.migrate(); console.log(JSON.stringify({ event: 'migration.applied', version: '0001_persistent_matches' })); }
  finally { await store.close(); }
}
void migrate().catch(() => { console.error(JSON.stringify({ event: 'migration.failed', code: 'DATABASE_UNAVAILABLE' })); process.exitCode = 1; });
