import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createAuditLogger } from '../src/server/logging.ts';

const environment = (extra: Record<string, string | undefined> = {}) => ({
  WEB_PUBLIC_URL: 'https://web.example.com', GAME_SERVER_PUBLIC_URL: 'wss://game.example.com/ws', ...extra,
});
async function configuration() {
  assert(existsSync(new URL('../src/web/config.ts', import.meta.url)), 'standalone Web config must exist');
  return import('../src/web/config.ts');
}
async function implementation() {
  assert(existsSync(new URL('../src/web/server.ts', import.meta.url)), 'standalone Web server must exist');
  return import('../src/web/server.ts');
}
type FakeFetch = typeof fetch;
const goodCookie = '__Host-alpha=v1.2000000000.public_cookie.signature; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Strict';
async function fixture(fetcher: FakeFetch = async () => Response.json({ authenticated: true }), trustProxy = false) {
  const { readWebConfig } = await configuration(), { createWebServer } = await implementation();
  const root = await mkdtemp(join(tmpdir(), 'conan-web-test-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Alpha</title>');
  await writeFile(join(root, 'assets', 'index-a1.js'), 'export const ready = true;');
  await writeFile(join(root, '.env'), 'private_canary');
  const logs: string[] = [];
  const server = await createWebServer({ config: { ...readWebConfig(environment({ TRUST_PROXY: String(trustProxy) })), host: '127.0.0.1', port: 0 },
    staticRoot: root, fetcher, logger: createAuditLogger('debug', line => logs.push(line)) });
  return { url: `http://127.0.0.1:${server.port}`, port: server.port, logs,
    close: async () => {
      await server.close();
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert(basename(root).startsWith('conan-web-test-'));
      await rm(root, { recursive: true, force: true });
    } };
}
const post = (body: unknown = {}, extra: Record<string, string> = {}): RequestInit => ({ method: 'POST',
  headers: { Origin: 'https://web.example.com', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('Web configuration requires only public settings and discards every secret and DB field', async () => {
  const { readWebConfig } = await configuration();
  assert.deepEqual(readWebConfig(environment()), { host: '0.0.0.0', port: 8080, webPublicUrl: 'https://web.example.com',
    gameServerPublicUrl: 'wss://game.example.com/ws', trustProxy: false, logLevel: 'info' });
  assert.deepEqual(readWebConfig(environment({ SESSION_SECRET: 'private_canary', ALPHA_ACCESS_SECRET: 'private_canary',
    DATABASE_URL: 'private_canary' })), readWebConfig(environment()));
  assert.equal(readWebConfig(environment({ WEB_PUBLIC_URL: 'https://web.example.com/', TRUST_PROXY: 'true', PORT: '9000' })).webPublicUrl,
    'https://web.example.com');
});

test('Web configuration rejects unsafe or implicit endpoints and invalid scalar values without echoing values', async () => {
  const { readWebConfig } = await configuration();
  for (const [key, values] of Object.entries({ WEB_PUBLIC_URL: [undefined, 'http://web.example.com', 'https://127.0.0.1',
    'https://user:private_canary@web.example.com', 'https://web.example.com/path', 'https://web.example.com?private_canary'],
    GAME_SERVER_PUBLIC_URL: [undefined, 'ws://game.example.com/ws', 'wss://10.0.0.1/ws', 'wss://game.example.com',
      'wss://game.example.com/ws?private_canary', 'wss://game.example.com/a/../ws'],
    TRUST_PROXY: ['1', 'TRUE'], PORT: ['0', '-1', '65536', '1e3'], HOST: ['', 'a/b'], LOG_LEVEL: ['verbose'] })) {
    for (const value of values) assert.throws(() => readWebConfig(environment({ [key]: value })), error => {
      assert(error instanceof Error); assert.match(error.message, /^INVALID_[A-Z_]+$/); assert(!error.message.includes('private_canary')); return true;
    });
  }
});

test('Web serves only built assets, safe public ticket config and security headers', async () => {
  let upstreamCalls = 0;
  const web = await fixture(async () => { upstreamCalls++; return Response.json({ status: 'ok' }); });
  try {
    const index = await fetch(web.url);
    assert.equal(index.status, 200); assert.match(await index.text(), /Alpha/);
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.equal(index.headers.get('x-frame-options'), 'DENY');
    assert.match(index.headers.get('content-security-policy')!, /connect-src 'self' wss:\/\/game.example.com\/ws;/);
    const asset = await fetch(web.url + '/assets/index-a1.js', { method: 'HEAD' });
    assert.equal(asset.status, 200); assert.equal(await asset.text(), '');
    for (const path of ['/.env', '/src/web/server.ts', '/assets/index-a1.js.map', '/ws', '/api/arbitrary', '/assets/%2e%2e/.env']) {
      assert.equal((await fetch(web.url + path)).status, 404, path);
    }
    const config = await fetch(web.url + '/api/public-config');
    assert.equal(config.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await config.json(), { webPublicUrl: 'https://web.example.com', gameServerPublicUrl: 'wss://game.example.com/ws',
      alphaRequired: true, alphaTransport: 'TICKET' });
    assert.equal(upstreamCalls, 0);
  } finally { await web.close(); }
});

test('Web proxies only fixed Alpha endpoints with stripped headers, configured Origin and first-party cookie', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const web = await fixture(async (url, init) => { calls.push({ url: String(url), init: init! });
    return Response.json(String(url).endsWith('socket-ticket') ? { ticket: 'v1.public.ticket', secret: 'private_canary' }
      : { authenticated: true, secret: 'private_canary' }, { headers: { 'Set-Cookie': goodCookie, 'X-Upstream-Secret': 'private_canary' } }); });
  try {
    const response = await fetch(web.url + '/api/alpha', post({ code: 'transient_code' }, {
      Cookie: '__Host-alpha=old.token; irrelevant=private_canary', Authorization: 'Bearer private_canary',
      'X-Forwarded-For': '1.2.3.4', 'X-Forwarded-Host': 'evil.example.com' }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { authenticated: true });
    assert.equal(response.headers.get('set-cookie'), goodCookie); assert.equal(response.headers.get('x-upstream-secret'), null);
    const ticket = await fetch(web.url + '/api/alpha/socket-ticket', post());
    assert.deepEqual(await ticket.json(), { ticket: 'v1.public.ticket' });
    await fetch(web.url + '/api/alpha');
    assert.deepEqual(calls.map(c => c.url), ['https://game.example.com/api/alpha', 'https://game.example.com/api/alpha/socket-ticket', 'https://game.example.com/api/alpha']);
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get('origin'), 'https://web.example.com');
      assert.equal(headers.get('authorization'), null); assert.equal(headers.get('x-forwarded-for'), null);
      assert.equal(headers.get('x-forwarded-host'), null); assert.equal(call.init.redirect, 'manual');
      assert(call.init.signal instanceof AbortSignal);
    }
    assert.equal(new Headers(calls[0]!.init.headers).get('cookie'), '__Host-alpha=old.token');
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { code: 'transient_code' });
    assert(!web.logs.join('\n').includes('private_canary')); assert(!web.logs.join('\n').includes('transient_code'));
  } finally { await web.close(); }
});

test('Web rejects nonexact Origin, query targets, methods and malformed bodies before upstream I/O', async () => {
  let count = 0;
  const web = await fixture(async () => { count++; return Response.json({ authenticated: true }); });
  try {
    for (const origin of ['', 'null', 'https://web.example.com/', 'https://evil.example.com']) {
      const request = post({ code: 'x' }); request.headers = { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) };
      assert.equal((await fetch(web.url + '/api/alpha', request)).status, 403);
    }
    for (const path of ['/api/alpha?url=https://evil.example.com', '/api/alpha/socket-ticket?x=1', '/api/alpha/../alpha', '/api/alpha/socket-ticket/']) {
      // Raw HTTP preserves dot segments that fetch normalizes client-side.
      const status = await new Promise<number>((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port: web.port, path, method: 'POST',
        headers: { Origin: 'https://web.example.com', 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode!); }); req.on('error', reject); req.end('{}'); });
      assert.equal(status, 404, path);
    }
    assert.equal((await fetch(web.url + '/api/alpha', { method: 'PUT' })).status, 405);
    assert.equal((await fetch(web.url + '/api/alpha/socket-ticket')).status, 405);
    assert.equal((await fetch(web.url + '/api/alpha', { ...post(), headers: { Origin: 'https://web.example.com', 'Content-Type': 'text/plain' } })).status, 415);
    for (const body of [{}, [], { code: 10 }, { code: 'x', url: 'https://evil.example.com' }]) {
      assert.equal((await fetch(web.url + '/api/alpha', post(body))).status, 400);
    }
    assert.equal((await fetch(web.url + '/api/alpha/socket-ticket', post({ url: 'https://evil.example.com' }))).status, 400);
    assert.equal((await fetch(web.url + '/api/alpha', post({ code: 'a'.repeat(9000) }))).status, 413);
    assert.equal(count, 0);
  } finally { await web.close(); }
});

test('Web strips every unsafe upstream cookie and only forwards its own Alpha cookie', async () => {
  let cookie = goodCookie;
  const web = await fixture(async () => Response.json({ authenticated: true }, { headers: { 'Set-Cookie': cookie } }));
  try {
    for (const unsafe of [goodCookie + '; Domain=web.example.com', goodCookie.replace('Secure;', ''), goodCookie.replace('HttpOnly;', ''),
      goodCookie.replace('Strict', 'None'), goodCookie.replace('Path=/', 'Path=/api'), goodCookie.replace('__Host-alpha', 'other'),
      goodCookie + '; SameSite=None', goodCookie + ', other=private_canary', goodCookie + '; Unknown=value']) {
      cookie = unsafe;
      const response = await fetch(web.url + '/api/alpha');
      assert.equal(response.headers.get('set-cookie'), null, unsafe);
    }
  } finally { await web.close(); }
});

test('Web hides arbitrary upstream errors, redirects, invalid successes and oversized response bodies', async () => {
  let upstream: () => Response = () => Response.json({ authenticated: true });
  const web = await fixture(async () => upstream());
  try {
    const cases = [() => Response.redirect('https://evil.example.com/private_canary'),
      () => new Response('private_canary', { status: 500 }),
      () => Response.json({ error: { code: 'private_canary', message: 'private_canary' } }, { status: 401 }),
      () => Response.json({ authenticated: 'true' }),
      () => Response.json({ authenticated: true, padding: 'private_canary'.repeat(1000) })];
    for (const example of cases) {
      upstream = example;
      const response = await fetch(web.url + '/api/alpha');
      assert.equal(response.status, 502); assert.equal(response.headers.get('location'), null);
      const body = await response.text(); assert.match(body, /UPSTREAM_UNAVAILABLE/); assert(!body.includes('private_canary'));
    }
    upstream = () => Response.json({ error: { code: 'ALPHA_ACCESS_REQUIRED', message: 'private_canary' } }, { status: 401 });
    const denied = await fetch(web.url + '/api/alpha'); assert.equal(denied.status, 401);
    const body = await denied.text(); assert.match(body, /ALPHA_ACCESS_REQUIRED/); assert(!body.includes('private_canary'));
    assert(!web.logs.join('\n').includes('private_canary'));
  } finally { await web.close(); }
});

test('Web liveness is independent and readiness only probes a fixed upstream path', async () => {
  const calls: string[] = []; let ready = true;
  const web = await fixture(async url => { calls.push(String(url)); return Response.json(ready ? { status: 'ok' } : { error: 'private_canary' }, { status: ready ? 200 : 503 }); });
  try {
    for (const path of ['/health', '/live']) assert.equal((await fetch(web.url + path)).status, 200);
    assert.equal(calls.length, 0); assert.equal((await fetch(web.url + '/ready')).status, 200);
    ready = false; const failed = await fetch(web.url + '/ready'); assert.equal(failed.status, 503);
    assert(!(await failed.text()).includes('private_canary'));
    assert.deepEqual(calls, ['https://game.example.com/ready', 'https://game.example.com/ready']);
  } finally { await web.close(); }
});

test('Web only honors a valid proxy source IP when TRUST_PROXY is explicitly enabled', async () => {
  const addresses: (string | null)[] = [];
  const web = await fixture(async (_url, init) => { addresses.push(new Headers(init?.headers).get('x-forwarded-for')); return Response.json({ authenticated: true }); }, true);
  try {
    await fetch(web.url + '/api/alpha', { headers: { 'X-Forwarded-For': 'private_canary, 203.0.113.40' } });
    await fetch(web.url + '/api/alpha', { headers: { 'X-Forwarded-For': 'bad-address' } });
    assert.deepEqual(addresses, ['203.0.113.40', null]);
  } finally { await web.close(); }
});

test('Web bounds Alpha admission request rates', async () => {
  let calls = 0;
  const web = await fixture(async () => { calls++; return Response.json({ authenticated: false }); });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await fetch(web.url + '/api/alpha', post({ code: 'x' }))).status, 200);
    const limited = await fetch(web.url + '/api/alpha', post({ code: 'x' }));
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(calls, 10);
  } finally { await web.close(); }
});

test('Web bounds outstanding upstream requests and releases reservations on completion', async () => {
  const releases: (() => void)[] = [];
  const web = await fixture(async () => { await new Promise<void>(resolve => releases.push(resolve)); return Response.json({ authenticated: true }); });
  const requests: Promise<Response>[] = [];
  try {
    for (let i = 0; i < 32; i++) requests.push(fetch(web.url + '/api/alpha'));
    const deadline = Date.now() + 2000;
    while (releases.length < 32 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(releases.length, 32);
    assert.equal((await fetch(web.url + '/api/alpha')).status, 503);
    releases.splice(0).forEach(release => release());
    assert((await Promise.all(requests)).every(response => response.status === 200));
  } finally { releases.splice(0).forEach(release => release()); await Promise.allSettled(requests); await web.close(); }
});

test('Web upstream timeout cancels the request and cannot expose diagnostics', async () => {
  let signal: AbortSignal | undefined;
  const web = await fixture(async (_url, init) => { signal = init!.signal!;
    await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(Error('private_canary')), { once: true }));
    throw Error('unreachable'); });
  try {
    const start = Date.now(), response = await fetch(web.url + '/api/alpha');
    assert.equal(response.status, 502); assert.equal(signal?.aborted, true);
    assert(Date.now() - start < 8000); assert(!(await response.text()).includes('private_canary'));
  } finally { await web.close(); }
});

test('Web entry is native Node TypeScript and only starts the standalone Web host', async () => {
  assert(existsSync(new URL('../apps/web/index.ts', import.meta.url)), 'standalone Web entry must exist');
  const source = await readFile(new URL('../apps/web/index.ts', import.meta.url), 'utf8');
  assert.match(source, /readWebConfig/); assert.match(source, /createWebServer/); assert.match(source, /SIGTERM/);
  assert.doesNotMatch(source, /PostgresStore|compileContent|readCardCatalog|readServerConfig|ALPHA_ACCESS_SECRET|SESSION_SECRET|DATABASE_URL/);
});
