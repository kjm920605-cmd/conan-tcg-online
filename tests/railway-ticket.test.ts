import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { AlphaAccess } from '../src/server/access.ts';
import { readServerConfig } from '../src/server/config.ts';
import type { ProductionSettings } from '../src/server/config.ts';
import { createProductionServer } from '../src/server/production.ts';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import type { SessionRecord } from '../src/server/persistence/model.ts';
import { fixture } from './fixtures.ts';

const settings: ProductionSettings = { webPublicUrl: 'https://web.example.com', gameServerPublicUrl: 'wss://server.example.com/ws',
  allowedOrigins: ['https://web.example.com'], sessionSecret: '19ca3b421cace60761fae2f0982ff08dcb4a86b0cb184266911df06b5eb48f33',
  alphaAccessSecret: '793bae04b05e2e896207cf7826c4abaccc7847a52ba2a45f7ba566859bd529c86', trustProxy: false, alphaTtlSeconds: 300,
  alphaTransport: 'TICKET' };

test('Railway split origins require explicit ticket transport and retain exact Web Origin policy', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://synthetic@db.example.com/test', WEB_PUBLIC_URL: settings.webPublicUrl,
    GAME_SERVER_PUBLIC_URL: settings.gameServerPublicUrl, CORS_ORIGINS: settings.webPublicUrl,
    SESSION_SECRET: settings.sessionSecret, ALPHA_ACCESS_SECRET: settings.alphaAccessSecret, ALPHA_TRANSPORT: 'TICKET', PORT: '9999' };
  const config = readServerConfig(env);
  assert.equal(config.production!.alphaTransport, 'TICKET'); assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 9999);
  assert.throws(() => readServerConfig({ ...env, ALPHA_TRANSPORT: 'COOKIE' }));
  assert.throws(() => readServerConfig({ ...env, ALPHA_TRANSPORT: 'bearer' }));
  assert.throws(() => readServerConfig({ ...env, CORS_ORIGINS: '*' }));
  assert.throws(() => readServerConfig({ ...env, CORS_ORIGINS: 'https://server.example.com' }));
});

test('socket ticket has a short admission deadline and retains original access expiry on live connections', () => {
  let now = 1000000;
  const access = new AlphaAccess(settings, () => now), cookie = access.issueCookie().split(';')[0]!;
  assert.equal(access.issueSocketTicket(undefined), null);
  const ticket = access.issueSocketTicket(cookie)!; assert(ticket); assert(!ticket.includes(settings.alphaAccessSecret));
  assert(access.verifySocketTicket(ticket));
  now += 31000; assert(!access.verifySocketTicket(ticket)); assert(access.verifySocketTicket(ticket, false));
  const renewed = access.issueSocketTicket(cookie)!; assert(access.verifySocketTicket(renewed));
  now += 270000; assert(!access.verifySocketTicket(ticket, false)); assert(!access.verifySocketTicket(renewed, false));
  assert.equal(access.issueSocketTicket(cookie), null);
});

test('socket tickets reject tampering, different origins, rotations, malformed or oversized values', () => {
  const access = new AlphaAccess(settings), cookie = access.issueCookie().split(';')[0]!, ticket = access.issueSocketTicket(cookie)!;
  for (const input of [undefined, '', ticket + 'a', ticket.slice(0, -1), 'x'.repeat(9000), cookie, ticket.replace('ws1', 'ws2')]) assert(!access.verifySocketTicket(input));
  for (const changed of [{ webPublicUrl: 'https://evil.example.com' }, { gameServerPublicUrl: 'wss://other.example.com/ws' },
    { sessionSecret: settings.sessionSecret + 'changed' }, { alphaAccessSecret: settings.alphaAccessSecret + 'changed' }]) {
    assert(!new AlphaAccess({ ...settings, ...changed }).verifySocketTicket(ticket));
  }
});

test('ticket endpoint validates cookie, Origin and body; WSS verifies ticket before Session and never echoes credential', async () => {
  const logs: string[] = []; let sessions = 0;
  class Store extends MemoryStore { override async createSession(record: SessionRecord) { sessions++; return super.createSession(record); } }
  const app = await createProductionServer({ content: fixture().content, port: 0, host: '127.0.0.1', config: settings,
    staticRoot: new URL('../dist/', import.meta.url), store: new Store(), ready: async () => {}, logger: (_level, event, context) => logs.push(JSON.stringify({ event, context })) });
  const base = `http://127.0.0.1:${app.port}`, cookie = new AlphaAccess(settings).issueCookie().split(';')[0]!;
  const headers = { Origin: settings.webPublicUrl, 'Content-Type': 'application/json', Cookie: cookie };
  async function upgrade(protocols?: string[], origin = settings.webPublicUrl, suffix = '') {
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws${suffix}`, protocols, { origin, headers: { Cookie: cookie } });
    const result = await new Promise<number>(resolve => {
      socket.on('error', () => {});
      socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode!); });
      socket.once('message', () => resolve(101));
    });
    const protocol = socket.protocol; socket.terminate(); return { result, protocol };
  }
  try {
    assert.equal((await fetch(base + '/api/alpha/socket-ticket', { method: 'POST', headers: { ...headers, Cookie: '' }, body: '{}' })).status, 401);
    assert.equal((await fetch(base + '/api/alpha/socket-ticket', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example.com' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/alpha/socket-ticket', { method: 'POST', headers, body: '{"url":"bad"}' })).status, 400);
    const response = await fetch(base + '/api/alpha/socket-ticket', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const { ticket } = await response.json() as { ticket: string }; assert(ticket);
    assert.equal((await upgrade()).result, 401, 'Cookie alone cannot bypass explicit split-origin transport');
    assert.equal((await upgrade(['conan-alpha.v1', 'invalid'])).result, 401);
    assert.equal((await upgrade(['conan-alpha.v1', ticket], 'https://evil.example.com')).result, 403);
    assert.equal((await upgrade(['conan-alpha.v1', ticket], settings.webPublicUrl, '?ticket=' + ticket)).result, 404);
    assert.equal(sessions, 0);
    assert.deepEqual(await upgrade(['conan-alpha.v1', ticket]), { result: 101, protocol: 'conan-alpha.v1' });
    assert.equal(sessions, 1); assert(!logs.join('').includes(ticket)); assert(!logs.join('').includes(cookie));
  } finally { await app.close(); }
});
