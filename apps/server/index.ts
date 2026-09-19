import { readCardCatalog, compileContent } from '../../src/cards/index.ts';
import { createGameServer } from '../../src/server/index.ts';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readServerConfig } from '../../src/server/config.ts';
import { createProductionServer } from '../../src/server/production.ts';
import { createAuditLogger } from '../../src/server/logging.ts';

async function main() {
  const config = readServerConfig(process.env), log = createAuditLogger(config.logLevel);
  const store = config.storage === 'postgres' ? new PostgresStore({ connectionString: config.databaseUrl!, schema: config.databaseSchema }) : null;
  const content = compileContent(await readCardCatalog(new URL('../../data/', import.meta.url)));
  const options = { content, host: config.host, port: config.port, logger: log, ...(store ? { store } : {}) };
  const keyFile = process.env.TLS_KEY_FILE, certFile = process.env.TLS_CERT_FILE;
  if (!!keyFile !== !!certFile) throw Error('INVALID_TLS_FILES');
  const tls = keyFile && certFile ? { key: await readFile(keyFile), cert: await readFile(certFile) } : undefined;
  const server = config.production ? await createProductionServer({ ...options, config: config.production,
    staticRoot: resolve(process.env.WEB_DIST_PATH ?? 'dist'), ready: () => store!.ready(), ...(tls ? { tls } : {}) }) : await createGameServer(options);
  if (!config.production) console.log(`Game server listening on port ${server.port} (${config.storage})`);
  log('info', 'server.started', {});
  // Trusted process supervisor readiness signal, not a public endpoint or claim of database readiness.
  process.send?.({ type: 'SERVER_READY', port: server.port });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20000); deadline.unref();
    void server.close().then(() => store?.close()).then(() => { log('info', 'server.stopped', {}); process.exit(0); }).catch(() => process.exit(1));
  });
}
void main().catch(error => {
  // Only configuration field codes are diagnostics; unknown exceptions/credentials/stacks stay off stdout.
  const code = error instanceof Error && /^(INVALID_[A-Z_]+|DATABASE_URL_REQUIRED)$/.test(error.message) ? error.message : 'STARTUP_FAILED';
  createAuditLogger('error')('error', 'request.failed', { code }); process.exit(1);
});
