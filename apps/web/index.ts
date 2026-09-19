import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readWebConfig } from '../../src/web/config.ts';
import { createWebServer } from '../../src/web/server.ts';
import { createAuditLogger } from '../../src/server/logging.ts';

async function start() {
  const config = readWebConfig(process.env), logger = createAuditLogger(config.logLevel);
  const keyPath = process.env.TLS_KEY_FILE, certPath = process.env.TLS_CERT_FILE;
  if (!!keyPath !== !!certPath) throw Error('INVALID_TLS_FILES');
  const tls = keyPath && certPath ? { key: await readFile(keyPath), cert: await readFile(certPath) } : undefined;
  const staticRoot = process.env.WEB_DIST_PATH ? pathToFileURL(resolve(process.env.WEB_DIST_PATH) + '/') : new URL('../../dist/', import.meta.url);
  await readFile(new URL('index.html', staticRoot));
  const app = await createWebServer({ config, logger, staticRoot, ...(tls ? { tls } : {}) });
  logger('info', 'server.started'); process.send?.({ type: 'WEB_READY', port: app.port });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
    void app.close().then(() => { clearTimeout(timer); logger('info', 'server.stopped'); process.exitCode = 0; });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
void start().catch(error => {
  const code = error instanceof Error && /^INVALID_[A-Z_]+$/.test(error.message) ? error.message : 'STARTUP_FAILED';
  process.stderr.write(JSON.stringify({ event: 'web.startup.failed', code }) + '\n'); process.exitCode = 1;
});
