import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createProductionServer } from '../src/server/production.ts';
import { createAuditLogger } from '../src/server/logging.ts';
import { AlphaAccess } from '../src/server/access.ts';
import type { ProductionSettings } from '../src/server/config.ts';
import { fixture } from './fixtures.ts';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import type { SessionRecord } from '../src/server/persistence/model.ts';

const settings: ProductionSettings = { webPublicUrl: 'https://alpha.example.test', gameServerPublicUrl: 'wss://alpha.example.test/ws', allowedOrigins: ['https://alpha.example.test'],
  sessionSecret: 'test-signing-secret-'.repeat(4), alphaAccessSecret: 'test-alpha-access-'.repeat(4), trustProxy: false, alphaTtlSeconds: 3600 };
async function start(ready: () => Promise<void> = async () => {}) {
  const lines: string[] = [], { content, options } = fixture();
  let sessions = 0;
  class ObservedStore extends MemoryStore { override async createSession(record: SessionRecord) { sessions++; return super.createSession(record); } }
  const server = await createProductionServer({ content, matchOptions: () => options, port: 0, host: '127.0.0.1', config: settings,
    staticRoot: new URL('../dist/', import.meta.url), ready, store: new ObservedStore(), logger: createAuditLogger('debug', line => lines.push(line)) });
  return { ...server, lines, sessions: () => sessions, base: `http://127.0.0.1:${server.port}` };
}
const headers = { Origin: settings.webPublicUrl, 'Content-Type': 'application/json' };
function rejectedUpgrade(port: number, origin?: string, cookie?: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { ...(origin ? { origin } : {}), headers: cookie ? { Cookie: cookie } : {} });
    socket.on('unexpected-response', (_req, res) => { res.resume(); socket.terminate(); resolve(res.statusCode!); });
    socket.on('open', () => { socket.terminate(); reject(new Error('Unexpected successful upgrade')); }); socket.on('error', () => {});
  });
}

test('production health/readiness are minimal and DB failure returns a safe structured error', async () => {
  let unavailable = false;
  const app = await start(async () => { if (unavailable) throw Error(`postgresql://private-user:private-password@host/db ${settings.sessionSecret}`); });
  try {
    for (const path of ['/health', '/live', '/ready']) {
      const response = await fetch(`${app.base}${path}`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
    }
    unavailable = true;
    const response = await fetch(`${app.base}/ready`); assert.equal(response.status, 503);
    const body = await response.text(); assert(body.includes('DATABASE_UNAVAILABLE')); assert(!body.includes('private-password'));
    assert(!app.lines.join('').includes(settings.sessionSecret)); assert(!app.lines.join('').includes('private-password'));
  } finally { await app.close(); }
});

test('production exact CORS policy and alpha gate protect upgrade before PlayerSession creation', async () => {
  const app = await start();
  try {
    const publicConfig = await fetch(`${app.base}/api/public-config`, { headers });
    assert.equal(publicConfig.headers.get('access-control-allow-origin'), settings.webPublicUrl);
    assert.deepEqual(await publicConfig.json(), { webPublicUrl: settings.webPublicUrl, gameServerPublicUrl: settings.gameServerPublicUrl, alphaRequired: true });
    const preflight = await fetch(`${app.base}/api/alpha`, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(preflight.status, 204); assert.notEqual(preflight.headers.get('access-control-allow-origin'), '*');
    const hostile = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify({ code: settings.alphaAccessSecret }) });
    assert.equal(hostile.status, 403); assert.equal(hostile.headers.get('access-control-allow-origin'), null);
    assert.equal(await rejectedUpgrade(app.port, settings.webPublicUrl), 401);
    const cookie = new AlphaAccess(settings).issueCookie().split(';')[0]!;
    assert.equal(await rejectedUpgrade(app.port, 'https://evil.example', cookie), 403);
    assert.equal(await rejectedUpgrade(app.port, undefined, cookie), 403);
    assert.equal(app.sessions(), 0);
    const noOrigin = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: settings.alphaAccessSecret }) });
    assert.equal(noOrigin.status, 403);
  } finally { await app.close(); }
});

async function authorizedPeer(port: number) {
  const cookie = new AlphaAccess(settings).issueCookie().split(';')[0]!;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: settings.webPublicUrl, headers: { Cookie: cookie } });
  const messages: any[] = []; socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  async function wait(type: string) {
    for (let i = 0; i < 200; i++) { const index = messages.findIndex(m => m.type === type); if (index >= 0) return messages.splice(index, 1)[0]; await new Promise(r => setTimeout(r, 5)); }
    throw Error(`Missing message type ${type}`);
  }
  const credential = await wait('SESSION');
  return { socket, messages, wait, credential, send: (message: unknown) => socket.send(JSON.stringify(message)) };
}

for (const [type, limit, fields] of [
  ['CREATE_ROOM', 6, {}], ['JOIN_ROOM', 20, { roomCode: 'UNKNOWN1' }],
  ['RESUME_MATCH', 30, { playerSessionId: 'unavailable', resumeToken: 'x'.repeat(64) }],
  ['GAME_COMMAND', 600, { matchId: 'unavailable', expectedVersion: 0, commandId: 'spam', payload: { kind: 'END_MAIN' } }],
] as const) test(`production bounds ${type} attempts before manager execution`, async () => {
  const app = await start(), peer = await authorizedPeer(app.port);
  try {
    for (let i = 0; i < limit; i++) {
      peer.send({ type, ...fields });
      const result = await peer.wait(type === 'CREATE_ROOM' && i === 0 ? 'ROOM_STATE' : 'COMMAND_REJECTED');
      assert.notEqual(result.code, 'RATE_LIMITED');
    }
    peer.send({ type, ...fields }); assert.equal((await peer.wait('COMMAND_REJECTED')).code, 'RATE_LIMITED');
    assert(app.lines.some(line => line.includes('rate.limited')));
  } finally { peer.socket.terminate(); await app.close(); }
});

test('alpha admission leaves room, match and private decision authorization intact', async () => {
  const app = await start(), a = await authorizedPeer(app.port), b = await authorizedPeer(app.port), outsider = await authorizedPeer(app.port);
  try {
    a.send({ type: 'CREATE_ROOM' }); const room = (await a.wait('ROOM_STATE')).room;
    b.send({ type: 'JOIN_ROOM', roomCode: room.roomCode }); await b.wait('ROOM_STATE');
    a.send({ type: 'READY' }); b.send({ type: 'READY' });
    const ap = (await a.wait('MATCH_STARTED')).packet, bp = (await b.wait('MATCH_STARTED')).packet;
    assert(ap.view.players.B.zones.HAND.every((card: unknown) => JSON.stringify(card) === '{"hidden":true}'));
    assert(bp.view.players.A.zones.HAND.every((card: unknown) => JSON.stringify(card) === '{"hidden":true}'));
    const nonOwner = ap.decision.playerId === 'A' ? b : a;
    const command = { type: 'RESOLVE_DECISION', commandId: 'private-choice', matchId: ap.matchId, expectedVersion: 0, payload: { kind: 'MULLIGAN', choiceId: ap.decision.id, cardIds: [] } };
    nonOwner.send(command); assert.equal((await nonOwner.wait('COMMAND_REJECTED')).code, 'NOT_DECISION_OWNER');
    outsider.send(command); assert.equal((await outsider.wait('COMMAND_REJECTED')).code, 'NOT_IN_ROOM');
    a.send({ ...command, playerId: 'B' }); assert.equal((await a.wait('COMMAND_REJECTED')).code, 'INVALID_MESSAGE');
    outsider.send({ type: 'RESUME_MATCH', playerSessionId: a.credential.playerSessionId, resumeToken: b.credential.resumeToken });
    assert.equal((await outsider.wait('COMMAND_REJECTED')).code, 'INVALID_SESSION');
    const owner = nonOwner === a ? b : a; owner.send(command); await owner.wait('COMMAND_ACCEPTED');
    const before = app.manager.inspectMatch(ap.matchId); owner.send(command); assert.equal((await owner.wait('COMMAND_ACCEPTED')).duplicate, true);
    assert.deepEqual(app.manager.inspectMatch(ap.matchId), before);
    for (const privateValue of [a.credential.resumeToken, b.credential.resumeToken, settings.alphaAccessSecret, settings.sessionSecret]) assert(!app.lines.join('').includes(privateValue));
    for (const event of ['room.created', 'room.joined', 'match.started', 'command.accepted', 'command.duplicate', 'command.rejected']) assert(app.lines.some(line => JSON.parse(line).event === event));
  } finally { for (const peer of [a, b, outsider]) peer.socket.terminate(); await app.close(); }
});

test('alpha login issues HttpOnly credential without echoing secret; failures and malformed body are bounded', async () => {
  const app = await start();
  try {
    const wrong = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: JSON.stringify({ code: 'incorrect' }) }); assert.equal(wrong.status, 401);
    const ok = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: JSON.stringify({ code: settings.alphaAccessSecret }) });
    assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { authenticated: true });
    const cookie = ok.headers.get('set-cookie')!; assert(cookie.includes('HttpOnly')); assert(cookie.includes('Secure')); assert(!cookie.includes(settings.alphaAccessSecret));
    const status = await fetch(`${app.base}/api/alpha`, { headers: { ...headers, Cookie: cookie.split(';')[0]! } }); assert.deepEqual(await status.json(), { authenticated: true });
    const malformed = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: '{' }); assert.equal(malformed.status, 400);
    const huge = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: 'x'.repeat(8193) }); assert.equal(huge.status, 413);
    for (let i = 0; i < 12; i++) await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: JSON.stringify({ code: 'wrong' }) });
    const limited = await fetch(`${app.base}/api/alpha`, { method: 'POST', headers, body: JSON.stringify({ code: 'wrong' }) }); assert.equal(limited.status, 429);
    assert(!app.lines.join('').includes(settings.alphaAccessSecret)); assert(!app.lines.join('').includes(cookie));
  } finally { await app.close(); }
});

test('audit logger uses an allowlist instead of logging private payloads or raw errors', () => {
  const lines: string[] = [], log = createAuditLogger('info', line => lines.push(line));
  log('info', 'command.accepted', { connectionId: 'connection-1', matchId: 'match-1', stateVersion: 4, payload: { hand: 'hidden' }, resumeToken: 'token-secret', error: new Error('db-secret') } as never);
  const row = JSON.parse(lines[0]!); assert.equal(row.event, 'command.accepted'); assert.equal(row.stateVersion, 4);
  for (const secret of ['hidden', 'token-secret', 'db-secret', 'payload', 'resumeToken']) assert(!lines[0]!.includes(secret));
  log('debug', 'request.completed', {}); assert.equal(lines.length, 1);
});
