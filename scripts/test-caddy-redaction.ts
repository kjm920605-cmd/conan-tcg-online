import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

// Local proxy regression. Requires an explicitly installed Caddy; never contacts a public host.
const binary = process.env.CADDY_BIN;
if (!binary) throw Error('CADDY_BIN_REQUIRED');
const probe = createServer();
await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
const port = (probe.address() as { port: number }).port;
await new Promise<void>(done => probe.close(() => done()));
const directory = await mkdtemp(resolve('tmp/phase6/caddy-check-'));
const config = JSON.parse(execFileSync(binary, ['adapt', '--adapter', 'caddyfile', '--config', 'deploy/Caddyfile'], {
  windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PUBLIC_HOST: `http://127.0.0.1:${port}` },
}));
// Test-only transport substitutions; use the repository's actual logging configuration.
config.admin = { disabled: true, config: { persist: false } };
for (const server of Object.values(config.apps.http.servers) as { routes: { handle: { upstreams?: { dial: string }[] }[] }[] }[]) {
  for (const route of server.routes) for (const handler of route.handle) {
    if (handler.upstreams) handler.upstreams = [{ dial: '127.0.0.1:1' }];
  }
}
const path = join(directory, 'config.json'); await writeFile(path, JSON.stringify(config));
const child = spawn(binary, ['run', '--config', path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory } });
let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 50)); }
  }
  assert(ready, 'Caddy did not start');
  const canaries = ['SYNTHETIC_QUERY_CANARY', 'SYNTHETIC_COOKIE_CANARY', 'SYNTHETIC_HEADER_CANARY'];
  const response = await fetch(`http://127.0.0.1:${port}/?alpha=${canaries[0]}`, {
    headers: { Cookie: `__Host-alpha=${canaries[1]}`, 'User-Agent': canaries[2]! }, signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 502);
  await new Promise(done => setTimeout(done, 100));
  const logs = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const errors = logs.filter(line => line.logger === 'http.log.error');
  assert(errors.length > 0, 'Must preserve operational proxy error logs');
  for (const value of canaries) assert(!output.includes(value), 'Proxy log exposed request data');
  for (const error of errors) assert(!Object.hasOwn(error, 'request'), 'Proxy error still contains a request object');
  process.stdout.write(JSON.stringify({ test: 'caddy-error-redaction', passed: true, status: response.status }) + '\n');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(done => child.once('exit', () => done())); child.kill(); await exited;
  }
  // Only the directory returned by mkdtemp under this workspace is removed.
  assert.equal(dirname(resolve(directory)), resolve('tmp/phase6'));
  await rm(directory, { recursive: true, force: true });
}
