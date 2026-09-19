import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessageSchema, ServerMessageSchema } from '../../packages/protocol/index.ts';
import type { ClientMessage } from '../../packages/protocol/index.ts';
import { RoomManager } from './managers.ts';
import type { Connection, ServerOptions } from './managers.ts';
import { silentLogger } from './logging.ts';
export { RoomManager, MatchManager } from './managers.ts';
export type { ServerOptions } from './managers.ts';

export type SocketPolicy = { check: (request: IncomingMessage, message?: ClientMessage) => string | null;
  authorize?: (request: IncomingMessage) => boolean; maxPending: number };

/** Both development and production transports bind to this one authoritative manager. */
export function bindGameSockets(server: WebSocketServer, options: ServerOptions, policy?: SocketPolicy) {
  const manager = new RoomManager(options), log = options.logger ?? silentLogger;
  let totalPending = 0, closing = false;
  type Admission = { releaseConnect: () => void; releaseCleanup: () => void };
  const admissions = new WeakMap<IncomingMessage, Admission>();
  const releaseSlot = () => {
    let released = false;
    return () => { if (!released) { released = true; totalPending--; } };
  };
  // Reserve both connect and eventual cleanup before accepting an upgrade. Closing a
  // socket must not free its budget while database work remains in the authority queue.
  const reserveConnection = (request: IncomingMessage) => {
    if (admissions.has(request)) return true;
    if (closing || policy && totalPending + 2 > policy.maxPending) return false;
    totalPending += 2;
    admissions.set(request, { releaseConnect: releaseSlot(), releaseCleanup: releaseSlot() });
    return true;
  };
  const cancelAdmission = (request: IncomingMessage) => {
    const admission = admissions.get(request); if (!admission) return;
    admissions.delete(request); admission.releaseConnect(); admission.releaseCleanup();
  };
  const alive = new WeakMap<WebSocket, boolean>();
  server.on('connection', (socket, request) => {
    if (!reserveConnection(request)) { socket.close(1013, 'RATE_LIMITED'); return; }
    const admission = admissions.get(request)!; admissions.delete(request);
    const connectionId = randomUUID(); let pending = 0;
    const connection: Connection = { id: connectionId,
      send: message => {
        if (socket.readyState !== WebSocket.OPEN) return;
        // Publication can follow a delayed database commit or an opponent's command.
        if (policy?.authorize && !policy.authorize(request)) { socket.close(1008, 'ALPHA_ACCESS_REQUIRED'); return; }
        socket.send(JSON.stringify(ServerMessageSchema.parse(message)));
      },
      close: () => socket.close(1000, 'Session detached') };
    const reject = (code: string, commandId: string | null = null) => connection.send({ type: 'COMMAND_REJECTED', commandId, code, message: code, stateVersion: null });
    log('info', 'connection.opened', { connectionId }); alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('message', (data, isBinary) => {
      try {
        const rawCode = policy?.check(request); if (rawCode) { reject(rawCode); socket.close(1008, rawCode); return; }
        if (isBinary) { manager.invalid(connection); return; }
        const parsed = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
        if (!parsed.success) { manager.invalid(connection); return; }
        const commandId = 'commandId' in parsed.data ? parsed.data.commandId : null;
        const code = policy?.check(request, parsed.data);
        if (code) { log('warn', 'rate.limited', { connectionId, code, commandType: parsed.data.type }); reject(code, commandId); return; }
        if (policy && (pending >= 16 || totalPending >= policy.maxPending)) { reject('RATE_LIMITED', commandId); return; }
        pending++; totalPending++;
        void manager.receive(connection, parsed.data).finally(() => { pending--; totalPending--; });
      } catch { manager.invalid(connection); }
    });
    let disconnected = false;
    const disconnect = () => {
      if (disconnected) return; disconnected = true;
      log('info', 'connection.closed', { connectionId }); void manager.disconnect(connection).finally(admission.releaseCleanup);
    };
    socket.on('close', disconnect); socket.on('error', disconnect);
    void manager.connect(connection).finally(admission.releaseConnect);
  });
  const heartbeat = policy ? setInterval(() => {
    for (const socket of server.clients) { if (!alive.get(socket)) socket.terminate(); else { alive.set(socket, false); socket.ping(); } }
  }, 30000) : null;
  heartbeat?.unref();
  return { manager, reserveConnection, cancelAdmission, close: async () => {
    closing = true;
    if (heartbeat) clearInterval(heartbeat);
    await new Promise<void>((resolve, reject) => { for (const socket of server.clients) socket.terminate(); server.close(error => error ? reject(error) : resolve()); });
    await manager.idle();
  } };
}

export async function createGameServer(options: ServerOptions) {
  const server = new WebSocketServer({ host: options.host ?? '127.0.0.1', port: options.port ?? 8787, maxPayload: 64 * 1024 });
  const runtime = bindGameSockets(server, options);
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SERVER_ADDRESS');
  return { port: address.port, ...runtime };
}
