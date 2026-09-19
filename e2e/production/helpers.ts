import { fork, execFile } from 'node:child_process';
import type { ForkOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, unlink, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';
import { ServerMessageSchema } from '../../packages/protocol/index.ts';
import type { PlayerPacket, ServerMessage, ClientMessage } from '../../packages/protocol/index.ts';

export async function productionBrowsers(browser: Browser, splitOrigins = false) {
  if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL required for production-like recovery tests');
  const schema = `prod_${randomUUID().replaceAll('-', '')}`, store = new PostgresStore({ connectionString: process.env.TEST_DATABASE_URL, schema });
  await store.migrate();
  const tempRoot = resolve('tmp/phase6'); await mkdir(tempRoot, { recursive: true }); const directory = await mkdtemp(join(tempRoot, 'tls-'));
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  const openssl = process.env.OPENSSL_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');
  await promisify(execFile)(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=alpha.example.com', '-addext', 'subjectAltName=DNS:alpha.example.com,DNS:game.example.net', '-keyout', key, '-out', cert], { windowsHide: true });
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(r => probe.close(() => r()));
  const webProbe = createServer(); await new Promise<void>(r => webProbe.listen(0, '127.0.0.1', r));
  const webPort = splitOrigins ? (webProbe.address() as { port: number }).port : port; await new Promise<void>(r => webProbe.close(() => r()));
  const base = `https://alpha.example.com:${webPort}`, gameBase = splitOrigins ? `https://game.example.net:${port}` : base;
  const gameUrl = gameBase.replace('https:', 'wss:') + '/ws', alphaCode = randomBytes(32).toString('hex'), sessionSecret = randomBytes(32).toString('hex');
  const logs: string[] = [];
  async function start() {
    const options: ForkOptions & { windowsHide: boolean } = { execArgv: [], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_ENV: 'production', MATCH_STORAGE: 'postgres', DATABASE_URL: process.env.TEST_DATABASE_URL!, DATABASE_SCHEMA: schema,
        HOST: '127.0.0.1', PORT: String(port), WEB_PUBLIC_URL: base, GAME_SERVER_PUBLIC_URL: gameUrl, CORS_ORIGINS: base, ALPHA_TRANSPORT: splitOrigins ? 'TICKET' : 'COOKIE',
        SESSION_SECRET: sessionSecret, ALPHA_ACCESS_SECRET: alphaCode, TRUST_PROXY: 'false', LOG_LEVEL: 'info', TLS_KEY_FILE: key, TLS_CERT_FILE: cert } };
    const child = fork(fileURLToPath(new URL('../../apps/server/index.ts', import.meta.url)), [], options);
    child.stdout?.on('data', data => logs.push(String(data))); child.stderr?.on('data', () => {});
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Production service readiness timeout')); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Production service exited before ready')); });
      child.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'SERVER_READY') { clearTimeout(timer); resolveReady(); } });
    });
    return { async stop() { if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>(r => child.once('exit', () => r())); child.kill('SIGKILL'); await exited; } };
  }
  let server = await start();
  let stopWeb: (() => Promise<void>) | undefined;
  const lookupPath = join(directory, 'test-dns.cjs');
  if (splitOrigins) {
    // Only test DNS is mapped; the real Web process uses normal CA validation and real HTTPS responses.
    await writeFile(lookupPath, `const dns = require('node:dns'); const original = dns.lookup;
dns.lookup = function(host, opts, callback) {
 if (!['game.example.net', 'alpha.example.com'].includes(host)) return original.apply(this, arguments);
 if (typeof opts === 'function') { callback = opts; opts = {}; }
 process.nextTick(() => opts && opts.all ? callback(null, [{address:'127.0.0.1',family:4}]) : callback(null,'127.0.0.1',4));
};`);
    const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));
    const web = fork(fileURLToPath(new URL('../../apps/web/index.ts', import.meta.url)), [], {
      execArgv: ['--require', lookupPath], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...inherited, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(webPort), WEB_PUBLIC_URL: base,
        GAME_SERVER_PUBLIC_URL: gameUrl, LOG_LEVEL: 'info', TLS_KEY_FILE: key, TLS_CERT_FILE: cert, NODE_EXTRA_CA_CERTS: cert },
    } as ForkOptions & { windowsHide: boolean });
    web.stdout?.on('data', data => logs.push(String(data))); web.stderr?.on('data', () => {});
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => { web.kill('SIGKILL'); reject(Error('Web service readiness timeout')); }, 15000);
      web.once('error', () => { clearTimeout(timer); reject(Error('Web service launch failure')); });
      web.once('exit', () => { clearTimeout(timer); reject(Error('Web service exited')); });
      web.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'WEB_READY') { clearTimeout(timer); ready(); } });
    });
    stopWeb = async () => { if (web.exitCode !== null || web.signalCode !== null) return;
      const exit = new Promise<void>(done => web.once('exit', () => done())); web.kill('SIGKILL'); await exit; };
  }
  const contexts = [await browser.newContext({ ignoreHTTPSErrors: true }), await browser.newContext({ ignoreHTTPSErrors: true })];
  const pages = [await contexts[0]!.newPage(), await contexts[1]!.newPage()] as [Page, Page];
  const packets = new Map<Page, PlayerPacket>(), messages = new Map<Page, ServerMessage[]>(), commands = new Map<Page, ClientMessage[]>(), sockets: string[] = [], browserErrors: string[] = [];
  for (const page of pages) {
    messages.set(page, []); commands.set(page, []);
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /mixed content|content security policy/i.test(message.text())) browserErrors.push(message.text()); });
    page.on('websocket', socket => {
      sockets.push(socket.url());
      socket.on('framereceived', ({ payload }) => { const message = ServerMessageSchema.parse(JSON.parse(String(payload))); messages.get(page)!.push(message); if ('packet' in message) packets.set(page, message.packet); });
      socket.on('framesent', ({ payload }) => commands.get(page)!.push(JSON.parse(String(payload))));
    });
    // Capture the native socket for explicit duplicate/error probes; do not reroute or replace any server response.
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as unknown as { testSocket: WebSocket }).testSocket = this; } };
    });
  }
  const [a, b] = pages;
  async function access(page: Page) {
    await page.goto(base); await expect(page.getByRole('region', { name: 'Alpha access', exact: true })).toBeVisible();
    await reauthorize(page);
    await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeEnabled();
  }
  async function reauthorize(page: Page) {
    await page.getByLabel('Alpha 通行碼', { exact: true }).fill(alphaCode); await page.getByRole('button', { name: '進入 Alpha', exact: true }).click();
  }
  async function joinRoom() {
    await access(a); await access(b);
    await a.getByRole('button', { name: 'Create Room', exact: true }).click(); const code = await a.getByTestId('room-code').innerText();
    await b.getByLabel('Room Code', { exact: true }).fill(code); await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await a.getByRole('button', { name: 'Room Ready', exact: true }).click(); await b.getByRole('button', { name: 'Room Ready', exact: true }).click();
    for (const page of pages) await expect(page.getByTestId('game-board')).toBeVisible();
  }
  const owner = () => { const packet = packets.get(a)!; return (packet.decision?.playerId ?? packet.view.turn.playerId) === 'A' ? a : b; };
  async function waitVersion(version: number) { for (const page of pages) await expect(page.getByTestId('state-version')).toHaveText(String(version)); }
  let played = false;
  async function step() {
    const page = owner(), packet = packets.get(page)!; const actions = (packet.decision?.actions ?? packet.legalActions).filter(action => action.available);
    const action = packet.decision ? actions.find(a => /^(Keep hand|Pass Mislead|No guard|Pass|Decline)$/.test(a.label)) ?? actions[0]
      : (!played ? actions.find(a => a.intent.kind === 'PLAY_CARD' && packet.view.players[packet.view.viewerId]!.zones.HAND.some(c => !c.hidden && c.id === a.sourceId && c.type === 'CHARACTER')) : undefined)
        ?? actions.find(a => a.intent.kind === 'DEDUCE' && a.label.startsWith('Deduce: FIXTURE Partner')) ?? actions.find(a => a.intent.kind === 'END_MAIN');
    if (!action) throw Error(`No production fixture action at ${packet.decision?.kind}`);
    if (action.intent.kind === 'PLAY_CARD') played = true;
    const panel = page.getByTestId(packet.decision ? 'decision-panel' : 'legal-actions');
    const sameLabel = (packet.decision?.actions ?? packet.legalActions).filter(candidate => candidate.label === action.label);
    await panel.getByRole('button', { name: action.label, exact: true }).nth(sameLabel.findIndex(candidate => candidate.id === action.id)).click();
    await waitVersion(packet.stateVersion + 1);
  }
  async function restart(renewAccessFor?: Page) {
    const before = pages.map(page => structuredClone(packets.get(page)!)); const durable = await store.loadMatch(before[0]!.matchId);
    await server.stop(); for (const page of pages) await expect(page.getByTestId('online-connection')).toHaveText('DISCONNECTED');
    server = await start();
    for (const page of pages) await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    if (renewAccessFor) { await expect(renewAccessFor.getByRole('region', { name: 'Alpha access', exact: true })).toBeVisible(); await reauthorize(renewAccessFor); }
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!; await expect(page.getByTestId('online-connection')).toHaveText('CONNECTED');
      await expect.poll(() => packets.get(page)).toEqual(before[i]); await expect(page.getByTestId('online-seat')).toHaveText(i === 0 ? 'A' : 'B');
    }
    expect(await store.loadMatch(before[0]!.matchId)).toEqual(durable);
  }
  async function raw(page: Page, command: ClientMessage) { await page.evaluate(message => (window as unknown as { testSocket: WebSocket }).testSocket.send(JSON.stringify(message)), command); }
  async function close() {
    for (const context of contexts) await context.close(); await server.stop();
    await stopWeb?.();
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`); await store.close();
    await unlink(key); await unlink(cert); if (splitOrigins) await unlink(lookupPath); await rmdir(directory);
  }
  async function smoke() {
    const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));
    let output: string;
    try {
      const result = await promisify(execFile)(process.execPath, ['--require', lookupPath, 'scripts/deployment-smoke.ts'], {
        windowsHide: true, timeout: 20000, env: { ...inherited, WEB_PUBLIC_URL: base, GAME_SERVER_PUBLIC_URL: gameUrl, ALPHA_TEST_CODE: alphaCode, NODE_EXTRA_CA_CERTS: cert },
      }); output = result.stdout;
    } catch { throw Error('Deployment smoke failed against real split HTTPS services'); }
    const result = JSON.parse(output); expect(result.type).toBe('DEPLOYMENT_SMOKE_PASSED');
    expect(result.webOrigin).toBe(base); expect(result.gameOrigin).toBe(gameBase);
    expect(result.crossNetworkMatchVerified).toBe(false); expect(result.restartVerified).toBe(false);
    expect(output).not.toContain(alphaCode);
  }
  return { base, gameUrl, contexts, pages, a, b, packets, commands, messages, sockets, browserErrors, logs, store, access, joinRoom, owner, step, waitVersion, restart, raw, close, smoke,
    assertNoSecrets() { const text = logs.join(''); for (const value of [alphaCode, sessionSecret]) expect(text).not.toContain(value);
      for (const list of messages.values()) for (const message of list) if (message.type === 'SESSION') expect(text).not.toContain(message.resumeToken); } };
}
