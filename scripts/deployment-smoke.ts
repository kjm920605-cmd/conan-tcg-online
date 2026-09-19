import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { ServerMessageSchema } from '../packages/protocol/index.ts';
import { publicUrl } from '../src/server/config.ts';

/** Uses normal certificate verification. Do not run with NODE_TLS_REJECT_UNAUTHORIZED=0. */
async function smoke() {
  const supplied = process.env.WEB_PUBLIC_URL, alphaCode = process.env.ALPHA_TEST_CODE;
  assert(supplied && alphaCode, 'WEB_PUBLIC_URL and ALPHA_TEST_CODE required');
  const base = new URL(publicUrl(supplied, 'https:', 'WEB_PUBLIC_URL'));
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'Public smoke requires normal TLS validation');
  const request = (path: string, init?: RequestInit) => fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
  for (const path of ['/health', '/live', '/ready']) {
    const response = await request(path); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
  }
  const web = await request('/'); assert.equal(web.status, 200); assert(web.headers.get('content-type')?.includes('text/html'));
  const cfg: any = await (await request('/api/public-config')).json(); assert.equal(cfg.webPublicUrl, base.origin);
  const gameUrl = publicUrl(cfg.gameServerPublicUrl, 'wss:', 'GAME_SERVER_PUBLIC_URL').href;
  const gameBase = new URL(gameUrl.replace(/^wss:/, 'https:')).origin;
  if (process.env.GAME_SERVER_PUBLIC_URL) assert.equal(gameUrl, publicUrl(process.env.GAME_SERVER_PUBLIC_URL, 'wss:', 'GAME_SERVER_PUBLIC_URL').href);
  if (cfg.alphaTransport !== 'TICKET') { assert.equal(cfg.alphaTransport, undefined); assert.equal(gameBase, base.origin); }
  assert.equal(cfg.alphaRequired, true);
  for (const path of ['/health', '/live', '/ready']) {
    const response = await fetch(gameBase + path, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
  }
  const denied = await request('/api/alpha', { method: 'POST', headers: { Origin: 'https://forbidden.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'invalid' }) });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const login = await request('/api/alpha', { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: alphaCode }) });
  assert.equal(login.status, 200); assert.deepEqual(await login.json(), { authenticated: true });
  const cookie = login.headers.get('set-cookie'); assert(cookie?.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict'));
  let protocols: string[] | undefined;
  if (cfg.alphaTransport === 'TICKET') {
    const issued = await request('/api/alpha/socket-ticket', { method: 'POST', headers: { Origin: base.origin,
      'Content-Type': 'application/json', Cookie: cookie!.split(';')[0]! }, body: '{}' });
    assert.equal(issued.status, 200); assert.equal(issued.headers.get('cache-control'), 'no-store');
    const value: any = await issued.json(); assert(typeof value.ticket === 'string' && /^ws1\.[A-Za-z0-9._-]{1,252}$/.test(value.ticket));
    protocols = ['conan-alpha.v1', value.ticket];
  }
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(gameUrl, protocols, { origin: base.origin, ...(protocols ? {} : { headers: { Cookie: cookie!.split(';')[0]! } }) });
    const timeout = setTimeout(() => { socket.terminate(); reject(Error('WSS_TIMEOUT')); }, 10000);
    socket.on('error', () => { clearTimeout(timeout); reject(Error('WSS_CONNECTION_FAILED')); });
    socket.on('message', data => {
      try { const message = ServerMessageSchema.parse(JSON.parse(data.toString()));
        if (message.type === 'SESSION') {
          if (protocols) assert.equal(socket.protocol, 'conan-alpha.v1');
          clearTimeout(timeout); socket.close(); resolve();
        }
        if (message.type === 'COMMAND_REJECTED') throw Error('WSS_SESSION_REJECTED');
      } catch { clearTimeout(timeout); socket.terminate(); reject(Error('WSS_PROTOCOL_FAILED')); }
    });
  });
  console.log(JSON.stringify({ type: 'DEPLOYMENT_SMOKE_PASSED', webOrigin: base.origin, gameOrigin: gameBase, https: true, wss: true, alpha: true, ready: true,
    crossNetworkMatchVerified: false, restartVerified: false }));
}
void smoke().catch(() => { console.error(JSON.stringify({ type: 'DEPLOYMENT_SMOKE_FAILED', correlationId: randomUUID(), code: 'SMOKE_FAILED' })); process.exitCode = 1; });
