import { fork } from 'node:child_process';
import type { ForkOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';
import { ServerMessageSchema } from '../../packages/protocol/index.ts';
import type { PlayerPacket, ClientMessage, ServerMessage } from '../../packages/protocol/index.ts';

export async function persistentBrowsers(browser: Browser) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required for real PostgreSQL restart E2E');
  const schema = `e2e_${randomUUID().replaceAll('-', '')}`;
  const store = new PostgresStore({ connectionString: process.env.TEST_DATABASE_URL, schema });
  await store.migrate();
  async function start(port = 0) {
    const processOptions: ForkOptions & { windowsHide: boolean } = {
      execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, DATABASE_SCHEMA: schema, MATCH_STORAGE: 'postgres', HOST: '127.0.0.1', PORT: String(port) },
    };
    const child = fork(fileURLToPath(new URL('../../apps/server/index.ts', import.meta.url)), [], processOptions);
    let errorOutput = ''; child.stderr?.on('data', data => { errorOutput += String(data); });
    const actualPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server readiness timed out')); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${errorOutput}`)); });
      child.on('message', message => {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'SERVER_READY' && 'port' in message && typeof message.port === 'number') { clearTimeout(timer); resolve(message.port); }
      });
    });
    return { port: actualPort, async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGKILL'); await exited;
    } };
  }
  let server = await start();
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = [await contexts[0]!.newPage(), await contexts[1]!.newPage()] as [Page, Page];
  const packets = new Map<Page, PlayerPacket>(), commands = new Map<Page, ClientMessage[]>(), messages = new Map<Page, ServerMessage[]>();
  for (const page of pages) {
    // Test-only routing of the real browser socket to this test's actual child process.
    await page.addInitScript(({ port }) => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          const target = new URL(String(url)); const game = target.port === '8787';
          if (game) target.port = String(port);
          super(target, protocols);
          if (game) (window as unknown as { testGameSocket: WebSocket }).testGameSocket = this;
        }
      };
    }, { port: server.port });
    commands.set(page, []); messages.set(page, []);
    page.on('websocket', socket => {
      if (new URL(socket.url()).port !== String(server.port)) return;
      socket.on('framereceived', ({ payload }) => {
        const message = ServerMessageSchema.parse(JSON.parse(String(payload))); messages.get(page)!.push(message);
        if ('packet' in message) packets.set(page, message.packet);
      });
      socket.on('framesent', ({ payload }) => { commands.get(page)!.push(JSON.parse(String(payload))); });
    });
  }
  const [a, b] = pages;
  async function join() {
    await a.goto('/?mode=online'); await b.goto('/?mode=online');
    await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    const code = await a.getByTestId('room-code').innerText();
    await b.getByLabel('Room Code', { exact: true }).fill(code); await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await a.getByRole('button', { name: 'Room Ready', exact: true }).click(); await b.getByRole('button', { name: 'Room Ready', exact: true }).click();
    for (const page of pages) await expect(page.getByTestId('game-board')).toBeVisible();
  }
  function owner() { const p = packets.get(a)!; return (p.decision?.playerId ?? p.view.turn.playerId) === 'A' ? a : b; }
  async function waitVersion(version: number) { for (const page of pages) await expect(page.getByTestId('state-version')).toHaveText(String(version)); }
  async function step() {
    const page = owner(), packet = packets.get(page)!;
    const options = (packet.decision?.actions ?? packet.legalActions).filter(a => a.available);
    const action = packet.decision
      ? options.find(a => /^(Keep hand|Pass Mislead|No guard|Pass|Decline)$/.test(a.label)) ?? options[0]
      : options.find(a => a.intent.kind === 'DEDUCE' && a.label.startsWith('Deduce: FIXTURE Partner')) ?? options.find(a => a.intent.kind === 'END_MAIN');
    if (!action) throw new Error(`No fixture command at ${packet.view.status}/${packet.decision?.kind}`);
    await page.getByRole('button', { name: action.label, exact: true }).click(); await waitVersion(packet.stateVersion + 1);
  }
  async function raw(page: Page, command: ClientMessage) {
    await page.evaluate(message => (window as unknown as { testGameSocket: WebSocket }).testGameSocket.send(JSON.stringify(message)), command);
  }
  async function restart() {
    const before = pages.map(p => structuredClone(packets.get(p)!)); const version = before[0]!.stateVersion;
    await server.stop();
    for (const page of pages) await expect(page.getByTestId('online-connection')).toHaveText('DISCONNECTED');
    server = await start(server.port);
    for (const page of pages) await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]!;
      await expect.poll(() => commands.get(page)!.filter(m => m.type === 'RESUME_MATCH').length).toBeGreaterThan(0);
      await expect.poll(() => messages.get(page)!.filter(m => m.type === 'RESYNC_STATE').length).toBeGreaterThan(0);
      await expect(page.getByTestId('online-connection')).toHaveText('CONNECTED');
      await expect(page.getByTestId('state-version')).toHaveText(String(version));
      expect(packets.get(page)).toEqual(before[index]);
      await expect(page.getByTestId('online-seat')).toHaveText(index === 0 ? 'A' : 'B');
    }
  }
  async function close() {
    for (const context of contexts) await context.close(); await server.stop();
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`); await store.close();
  }
  return { pages, a, b, packets, commands, messages, store, join, step, owner, restart, raw, waitVersion, close };
}
