import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';

test('production readiness checks a reproducibly migrated empty DB and rejects an incomplete schema', async () => {
  assert(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL required');
  const schema = `ready_${randomUUID().replaceAll('-', '')}`, store = new PostgresStore({ connectionString: process.env.TEST_DATABASE_URL, schema });
  try {
    await assert.rejects(() => store.ready());
    await store.migrate(); await store.ready();
    await store.migrate(); await store.ready();
    await store.pool.query('DROP TABLE match_commands');
    await assert.rejects(() => store.ready(), { message: 'DATABASE_UNAVAILABLE' });
  } finally { await store.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await store.close(); }
});
