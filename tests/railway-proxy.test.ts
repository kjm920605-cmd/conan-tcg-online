import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { readWebConfig } from '../src/web/config.ts';
import { createWebServer } from '../src/web/server.ts';
import { readServerConfig } from '../src/server/config.ts';
import { createProductionServer } from '../src/server/production.ts';
import { fixture } from './fixtures.ts';

const env = { NODE_ENV: 'production', WEB_PUBLIC_URL: 'https://web.example.com', GAME_SERVER_PUBLIC_URL: 'wss://server.example.com/ws',
  ALPHA_TRANSPORT: 'TICKET', CORS_ORIGINS: 'https://web.example.com', DATABASE_URL: 'postgresql://synthetic@db.example.com/test',
  SESSION_SECRET: '19ca3b421cace60761fae2f0982ff08dcb4a86b0cb184266911df06b5eb48f33',
  ALPHA_ACCESS_SECRET: '793bae04b05e2e896207cf7826c4abaccc7847a52ba2a45f7ba566859bd529c86',
  TRUST_PROXY: 'true', PROXY_IP_HEADER: 'X_REAL_IP' };

test('Railway proxy mode is explicit, validated and shared by Web and game configuration', () => {
  for (const read of [readWebConfig, (value: typeof env) => readServerConfig(value).production!]) {
    assert.equal((read(env) as { proxyIpHeader?: string }).proxyIpHeader, 'X_REAL_IP');
    assert.throws(() => read({ ...env, PROXY_IP_HEADER: 'anything' }), /INVALID_PROXY_IP_HEADER/);
    assert.throws(() => read({ ...env, TRUST_PROXY: 'false' }), /INVALID_PROXY_IP_HEADER/);
  }
});

test('proxy identity uses only the configured edge header and rejects malformed or multiple IP values', async () => {
  assert(existsSync(new URL('../src/server/proxy.ts', import.meta.url)));
  const { clientAddress } = await import('../src/server/proxy.ts');
  const request = (headers: IncomingMessage['headers']) => ({ headers, socket: { remoteAddress: '127.0.0.1' } }) as IncomingMessage;
  const config = { trustProxy: true, proxyIpHeader: 'X_REAL_IP' as const };
  assert.equal(clientAddress(request({ 'x-real-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.2' }), config), '203.0.113.1');
  assert.equal(clientAddress(request({ 'x-real-ip': '2001:db8::1' }), config), '2001:db8::1');
  for (const value of ['', 'bad', '203.0.113.1, 203.0.113.2', ['203.0.113.1', '203.0.113.2']]) {
    assert.equal(clientAddress(request({ 'x-real-ip': value, 'x-forwarded-for': '198.51.100.2' }), config), '127.0.0.1');
  }
  assert.equal(clientAddress(request({ 'x-real-ip': '203.0.113.1' }), { trustProxy: false }), '127.0.0.1');
  assert.equal(clientAddress(request({ 'x-forwarded-for': 'untrusted, 203.0.113.2' }), { trustProxy: true }), '203.0.113.2');
});

test('Railway Web rate buckets use edge client IP but never forward visitor identity to the public server', async () => {
  let calls = 0;
  const app = await createWebServer({ config: { ...readWebConfig(env), host: '127.0.0.1', port: 0 }, staticRoot: new URL('../dist/', import.meta.url),
    fetcher: async (_url, init) => { calls++; const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-forwarded-for'), null); assert.equal(headers.get('x-real-ip'), null);
      return Response.json({ authenticated: false }); } });
  const request = (ip: string, spoof: number) => fetch(`http://127.0.0.1:${app.port}/api/alpha`, { method: 'POST', body: '{"code":"invalid"}',
    headers: { Origin: env.WEB_PUBLIC_URL, 'Content-Type': 'application/json', 'X-Real-IP': ip, 'X-Forwarded-For': `198.51.100.${spoof}` } });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await request('203.0.113.1', i)).status, 200);
    assert.equal((await request('203.0.113.1', 11)).status, 429);
    assert.equal((await request('203.0.113.2', 12)).status, 200); assert.equal(calls, 11);
  } finally { await app.close(); }
});

test('Railway server Alpha quota uses its edge peer IP and ignores arbitrary forwarded visitor identities', async () => {
  const app = await createProductionServer({ content: fixture().content, config: readServerConfig(env).production!, host: '127.0.0.1', port: 0,
    staticRoot: new URL('../dist/', import.meta.url), ready: async () => {} });
  const request = (ip: string, spoof: number) => fetch(`http://127.0.0.1:${app.port}/api/alpha`, { method: 'POST', body: '{"code":"invalid"}',
    headers: { Origin: env.WEB_PUBLIC_URL, 'Content-Type': 'application/json', 'X-Real-IP': ip, 'X-Forwarded-For': `198.51.100.${spoof}` } });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await request('203.0.113.1', i)).status, 401);
    assert.equal((await request('203.0.113.1', 11)).status, 429);
    assert.equal((await request('203.0.113.2', 12)).status, 401);
  } finally { await app.close(); }
});
