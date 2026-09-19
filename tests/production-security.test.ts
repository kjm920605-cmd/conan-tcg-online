import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

// Synthetic, deliberately public test values. Never load deployment .env files.
const sessionSecret = '9d34c7690ff952716cea402ad78cbadcf48ab938f7d40560bfdbdfe9a24083e1';
const alphaAccessSecret = 'b95da7319c764d11f9281350ba98e48759bf7c30e2a6038553049176fcab415d';
const env = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production', MATCH_STORAGE: 'postgres',
  DATABASE_URL: 'postgresql://test_user:test_password@127.0.0.1:5432/alpha_test',
  DATABASE_SCHEMA: 'alpha_test', WEB_PUBLIC_URL: 'https://alpha.example.com',
  GAME_SERVER_PUBLIC_URL: 'wss://alpha.example.com/ws',
  CORS_ORIGINS: 'https://alpha.example.com',
  SESSION_SECRET: sessionSecret, ALPHA_ACCESS_SECRET: alphaAccessSecret, ...overrides,
});

async function configuration() {
  assert(existsSync(new URL('../src/server/config.ts', import.meta.url)), 'production configuration must be implemented');
  return import('../src/server/config.ts');
}
async function access() {
  assert(existsSync(new URL('../src/server/access.ts', import.meta.url)), 'alpha access gate must be implemented');
  return import('../src/server/access.ts');
}
async function rateLimits() {
  assert(existsSync(new URL('../src/server/rate-limit.ts', import.meta.url)), 'bounded rate limiter must be implemented');
  return import('../src/server/rate-limit.ts');
}

test('production config exposes exact typed settings for a single HTTPS/WSS origin', async () => {
  const { readServerConfig } = await configuration();
  assert.deepEqual(readServerConfig(env()), {
    mode: 'production', host: '0.0.0.0', port: 8787, storage: 'postgres',
    databaseUrl: env().DATABASE_URL, databaseSchema: 'alpha_test', logLevel: 'info',
    production: {
      webPublicUrl: 'https://alpha.example.com', gameServerPublicUrl: 'wss://alpha.example.com/ws',
      allowedOrigins: ['https://alpha.example.com'], sessionSecret, alphaAccessSecret,
      trustProxy: false, alphaTtlSeconds: 28800,
    },
  });
  const custom = readServerConfig(env({ HOST: '127.0.0.1', PORT: '8080', LOG_LEVEL: 'warn', TRUST_PROXY: 'true',
    ALPHA_TTL_SECONDS: '120', WEB_PUBLIC_URL: 'https://alpha.example.com:8443/',
    GAME_SERVER_PUBLIC_URL: 'wss://alpha.example.com:8443/ws', CORS_ORIGINS: 'https://alpha.example.com:8443' }));
  assert.equal(custom.host, '127.0.0.1');
  assert.equal(custom.port, 8080);
  assert.equal(custom.logLevel, 'warn');
  assert.equal(custom.production?.trustProxy, true);
  assert.equal(custom.production?.alphaTtlSeconds, 120);
  assert.equal(custom.production?.webPublicUrl, 'https://alpha.example.com:8443');
});

test('production config rejects missing, short, repetitive, placeholder and reused secrets without echoing them', async () => {
  const { readServerConfig } = await configuration();
  for (const key of ['SESSION_SECRET', 'ALPHA_ACCESS_SECRET']) {
    for (const value of [undefined, '', 'tiny', 'a'.repeat(64), 'abcd'.repeat(16),
      'replace-with-a-random-secret-at-least-32-characters', 'change_me_before_deploying_1234567890',
      'your-production-secret-0123456789abcdefgh', 'with space ' + sessionSecret, sessionSecret.repeat(9)]) {
      assert.throws(() => readServerConfig(env({ [key]: value })), error => {
        assert(error instanceof Error);
        assert.match(error.message, /SECRET/);
        if (value) assert(!error.message.includes(value));
        return true;
      });
    }
  }
  assert.throws(() => readServerConfig(env({ ALPHA_ACCESS_SECRET: sessionSecret })), /SECRET/);
});

test('production configuration fails closed for invalid storage, DB, schema, mode and scalar settings', async () => {
  const { readServerConfig } = await configuration();
  const invalid: Record<string, (string | undefined)[]> = {
    NODE_ENV: ['prod', ''], MATCH_STORAGE: ['memory', 'other', ''],
    DATABASE_URL: [undefined, '', 'not-a-url', 'https://db.example.com/db', 'postgresql:///db',
      'postgresql://db.example.com', 'postgresql://db.example.com:0/db', 'postgresql://db.example.com/db#fragment'],
    DATABASE_SCHEMA: ['BadSchema', 'bad-schema', 'public;DROP', '', 'a'.repeat(64)],
    PORT: ['0', '-1', '65536', '1.2', '1e3', '', 'Infinity', '8080junk'],
    LOG_LEVEL: ['verbose', '', 'INFO'], TRUST_PROXY: ['1', 'yes', '', 'TRUE'],
    ALPHA_TTL_SECONDS: ['0', '59', '86401', '1e3', '-5', 'NaN'],
  };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    assert.throws(() => readServerConfig(env({ [key]: value })), Error, `${key} rejects ${value ?? 'missing'}`);
  }
  const badDb = 'postgresql://user:private_canary@db.example.com:99999/db';
  assert.throws(() => readServerConfig(env({ DATABASE_URL: badDb })), error => {
    assert(error instanceof Error); assert(!error.message.includes('private_canary')); return true;
  });
});

test('public URLs reject unsafe schemes, local hosts, credentials, query, fragments and paths', async () => {
  const { readServerConfig } = await configuration();
  for (const key of ['WEB_PUBLIC_URL', 'GAME_SERVER_PUBLIC_URL']) {
    const scheme = key === 'WEB_PUBLIC_URL' ? 'https' : 'wss';
    const path = key === 'WEB_PUBLIC_URL' ? '' : '/ws';
    const invalid = [undefined, '', `${scheme === 'https' ? 'http' : 'ws'}://alpha.example.com${path}`,
      ...['localhost', 'a.localhost', '127.0.0.1', '127.1', '0.0.0.0', '10.0.0.1', '172.16.0.1',
        '192.168.1.2', '169.254.1.2', '[::1]', '[::]', '[fc00::1]', '[fe80::1]', '[::ffff:127.0.0.1]',
        'internal', 'host.local', 'host.internal'].map(host => `${scheme}://${host}${path}`),
      `${scheme}://user:private_canary@alpha.example.com${path}`, `${scheme}://alpha.example.com${path}?x=1`,
      `${scheme}://alpha.example.com${path}?`, `${scheme}://alpha.example.com${path}#`,
      `${scheme}://alpha.example.com${path}#fragment`, `${scheme}://alpha.example.com/other`,
      ` ${scheme}://alpha.example.com${path}`, `${scheme}://alpha.example.com${path}\n`,
    ];
    for (const value of invalid) assert.throws(() => readServerConfig(env({ [key]: value })), Error, key);
  }
});

test('production requires matching public host and port and an exact same-origin allowlist', async () => {
  const { readServerConfig } = await configuration();
  for (const value of ['wss://game.example.com/ws', 'wss://alpha.example.com:8443/ws',
    'wss://alpha.example.com', 'wss://alpha.example.com/ws/', 'wss://alpha.example.com/a/../ws']) {
    assert.throws(() => readServerConfig(env({ GAME_SERVER_PUBLIC_URL: value })));
  }
  for (const value of [undefined, '', '*', 'https://*.example.com', 'null', 'http://alpha.example.com',
    'https://alpha.example.com/path', 'https://alpha.example.com/', 'https://alpha.example.com?x=1',
    'https://other.example.com', 'https://alpha.example.com,https://other.example.com',
    'https://alpha.example.com,', 'https://alpha.example.com https://other.example.com']) {
    assert.throws(() => readServerConfig(env({ CORS_ORIGINS: value })));
  }
  assert.deepEqual(readServerConfig(env({ CORS_ORIGINS: 'https://alpha.example.com, https://alpha.example.com' }))
    .production?.allowedOrigins, ['https://alpha.example.com']);
});

test('development and test preserve explicit ephemeral storage and default Postgres requirements', async () => {
  const { readServerConfig } = await configuration();
  assert.deepEqual(readServerConfig({ MATCH_STORAGE: 'memory' }), {
    mode: 'development', host: '127.0.0.1', port: 8787, storage: 'memory', databaseSchema: 'public', logLevel: 'info',
  });
  const testConfig = readServerConfig({ NODE_ENV: 'test', MATCH_STORAGE: 'memory', PORT: '0' });
  assert.equal(testConfig.port, 0); assert.equal(testConfig.production, undefined);
  assert.throws(() => readServerConfig({}), /DATABASE_URL/);
  const persistent = readServerConfig({ DATABASE_URL: env().DATABASE_URL });
  assert.equal(persistent.storage, 'postgres'); assert.equal(persistent.production, undefined);
});

test('alpha code comparison only accepts the exact bounded code', async () => {
  const { AlphaAccess } = await access();
  const { readServerConfig } = await configuration();
  const gate = new AlphaAccess(readServerConfig(env()).production!);
  assert.equal(gate.acceptCode(alphaAccessSecret), true);
  for (const code of [undefined, null, false, 123, {}, [alphaAccessSecret], '', sessionSecret,
    alphaAccessSecret + ' ', alphaAccessSecret.toUpperCase(), 'x'.repeat(10000)]) assert.equal(gate.acceptCode(code), false);
});

test('alpha cookie has browser protection flags, fresh opaque values and no code/session identity', async () => {
  const { AlphaAccess } = await access(); const { readServerConfig } = await configuration();
  const gate = new AlphaAccess(readServerConfig(env()).production!, () => 1_800_000_000_000);
  const cookie = gate.issueCookie();
  assert.match(cookie, /^__Host-[A-Za-z0-9_-]+=/);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert(cookie.split('; ').includes(flag));
  assert(!cookie.includes('Domain=')); assert(!cookie.includes(alphaAccessSecret)); assert(!cookie.includes(sessionSecret));
  assert(!cookie.includes('playerSessionId')); assert(!cookie.includes('resumeToken'));
  assert.notEqual(gate.issueCookie(), cookie);
  assert.equal(gate.verifyCookie(cookie.split(';')[0]), true);
});

test('signed alpha cookie survives same-secret restart, rejects tamper and expires exactly at TTL', async () => {
  const { AlphaAccess } = await access(); const { readServerConfig } = await configuration();
  const settings = readServerConfig(env({ ALPHA_TTL_SECONDS: '60' })).production!;
  let now = 1_800_000_000_000;
  const gate = new AlphaAccess(settings, () => now);
  const cookie = gate.issueCookie().split(';')[0]!;
  assert.equal(new AlphaAccess(settings, () => now).verifyCookie(cookie), true);
  const start = cookie.indexOf('=') + 1;
  for (let index = start; index < cookie.length; index++) {
    const mutated = cookie.slice(0, index) + (cookie[index] === 'a' ? 'b' : 'a') + cookie.slice(index + 1);
    assert.equal(gate.verifyCookie(mutated), false, `cookie character ${index} must be authenticated`);
  }
  now += 59_999; assert.equal(gate.verifyCookie(cookie), true);
  now += 1; assert.equal(gate.verifyCookie(cookie), false);
});

test('rotating either deployment secret revokes old alpha cookies', async () => {
  const { AlphaAccess } = await access(); const { readServerConfig } = await configuration();
  const settings = readServerConfig(env()).production!;
  const gate = new AlphaAccess(settings); const cookie = gate.issueCookie().split(';')[0]!;
  for (const key of ['sessionSecret', 'alphaAccessSecret'] as const) {
    const rotated = new AlphaAccess({ ...settings, [key]: '7318c095764e9fb3e25c12a6d5043287a99b79eac3c01a4e553f021ab654f829' });
    assert.equal(rotated.verifyCookie(cookie), false);
  }
});

test('cookie parsing rejects duplicates, malformed values and oversized headers without throwing', async () => {
  const { AlphaAccess } = await access(); const { readServerConfig } = await configuration();
  const gate = new AlphaAccess(readServerConfig(env()).production!);
  const cookie = gate.issueCookie().split(';')[0]!; const name = cookie.split('=')[0]!;
  assert.equal(gate.verifyCookie(`unrelated=abc; ${cookie}; other=value`), true);
  for (const header of [undefined, '', 'garbage', `${name}=`, `${name}=%invalid`, cookie + '=',
    cookie + '; ' + cookie, `${name}=bad; ${cookie}`, `${cookie}; ${name}=bad`,
    `${name}="${cookie.slice(name.length + 1)}"`, `${cookie}\r\n`, cookie + '; padding=' + 'x'.repeat(8192)]) {
    assert.equal(gate.verifyCookie(header), false);
  }
});

test('rate limiter isolates keys, denies excess use and resets at the window boundary', async () => {
  const { RateLimiter } = await rateLimits(); let now = 1_000;
  const limiter = new RateLimiter(() => now); const policy = { limit: 2, windowMs: 1000 };
  assert.equal(limiter.consume('alpha:a', policy), true); assert.equal(limiter.consume('alpha:a', policy), true);
  assert.equal(limiter.consume('alpha:a', policy), false); assert.equal(limiter.consume('alpha:b', policy), true);
  now += 999; assert.equal(limiter.consume('alpha:a', policy), false);
  now += 1; assert.equal(limiter.consume('alpha:a', policy), true);
});

test('rate limiter rejects invalid policies and unbounded keys without consuming capacity', async () => {
  const { RateLimiter } = await rateLimits(); const limiter = new RateLimiter(() => 1_000);
  for (const policy of [{ limit: 0, windowMs: 1000 }, { limit: 1.5, windowMs: 1000 },
    { limit: 1, windowMs: 0 }, { limit: 1, windowMs: Infinity }, { limit: NaN, windowMs: 1000 },
    { limit: 1, windowMs: Number.MAX_SAFE_INTEGER }]) assert.equal(limiter.consume('invalid', policy), false);
  for (const key of ['', 'x'.repeat(513)]) assert.equal(limiter.consume(key, { limit: 1, windowMs: 1000 }), false);
  assert.equal(limiter.consume('invalid', { limit: 1, windowMs: 1000 }), true);
});

test('rate limiter saturation fails closed, keeps live protections and reclaims expired buckets', async () => {
  const { RateLimiter } = await rateLimits(); let now = 10_000;
  const limiter = new RateLimiter(() => now); const policy = { limit: 1, windowMs: 1_000 };
  let accepted = 0;
  for (let index = 0; index < 25_000; index++) if (limiter.consume(`ip:${index}`, policy)) accepted++;
  assert(accepted > 0 && accepted <= 10_000, 'memory must stop growing at a bounded capacity');
  assert.equal(limiter.consume('another-new-ip', policy), false);
  assert.equal(limiter.consume('ip:0', policy), false, 'saturation must not evict a live rate protection');
  now += 1_000;
  assert.equal(limiter.consume('another-new-ip', policy), true, 'expired buckets must release capacity');
  assert.equal(limiter.consume('ip:0', policy), true);
});

test('changing a live key policy does not reset its consumed quota or shorten protection', async () => {
  const { RateLimiter } = await rateLimits(); let now = 1_000;
  const limiter = new RateLimiter(() => now);
  assert.equal(limiter.consume('same', { limit: 1, windowMs: 10_000 }), true);
  now += 2_000;
  assert.equal(limiter.consume('same', { limit: 100, windowMs: 1_000 }), false);
  now += 8_000;
  assert.equal(limiter.consume('same', { limit: 100, windowMs: 1_000 }), true);
});

