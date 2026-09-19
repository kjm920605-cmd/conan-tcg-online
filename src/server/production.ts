import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { ServerOptions as TlsOptions } from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { clientAddress } from './proxy.ts';
import { WebSocketServer } from 'ws';
import { bindGameSockets } from './index.ts';
import type { ServerOptions } from './managers.ts';
import type { ProductionSettings } from './config.ts';
import { AlphaAccess } from './access.ts';
import { RateLimiter } from './rate-limit.ts';
import { silentLogger } from './logging.ts';
import { PersistenceError } from './persistence/model.ts';

type Options = ServerOptions & { config: ProductionSettings; staticRoot: string | URL; ready: () => Promise<void>; tls?: TlsOptions };
const minute = 60000;
const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
};
class HttpError extends Error { readonly status: number; readonly code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code; } }
async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'INVALID_MESSAGE');
  let body = '', size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk); if (size > 8192) throw new HttpError(413, 'PAYLOAD_TOO_LARGE'); body += chunk.toString();
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch { throw new HttpError(400, 'INVALID_MESSAGE'); }
}

export function productionFailureCode(error: unknown): string {
  if (error instanceof PersistenceError) return error.code;
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
    const code = 'code' in cause ? cause.code : null;
    if (typeof code === 'string' && (/^08[0-9A-Z]{3}$/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P02', '57P03', '53300'].includes(code))) return 'DATABASE_UNAVAILABLE';
    cause = 'cause' in cause ? cause.cause : null;
  }
  return 'SERVER_ERROR';
}

/** Deployment boundary only: admission, HTTP and observability. Gameplay stays in RoomManager/Engine. */
export async function createProductionServer(options: Options) {
  const { config } = options, access = new AlphaAccess(config), limits = new RateLimiter(), log = options.logger ?? silentLogger;
  const root = options.staticRoot instanceof URL ? fileURLToPath(options.staticRoot) : options.staticRoot;
  const originAllowed = (origin: string | undefined) => !!origin && config.allowedOrigins.includes(origin);
  const socketTicket = (request: IncomingMessage) => {
    const parts = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim());
    return parts?.length === 2 && parts[0] === 'conan-alpha.v1' ? parts[1] : undefined;
  };
  const authorized = (request: IncomingMessage, admission = false) => config.alphaTransport === 'TICKET'
    ? access.verifySocketTicket(socketTicket(request), admission) : access.verifyCookie(request.headers.cookie);
  const address = (request: IncomingMessage) => clientAddress(request, config);
  const consume = (request: IncomingMessage, category: string, limit: number) => limits.consume(`${category}:${address(request)}`, { limit, windowMs: minute });
  const requestHandler = (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID(), started = Date.now();
    response.setHeader('X-Request-Id', requestId); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${config.gameServerPublicUrl}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    response.on('finish', () => log('info', 'request.completed', { requestId, status: response.statusCode, durationMs: Date.now() - started }));
    void (async () => {
      const path = request.url?.split('?')[0] ?? '/';
      if (request.headers.origin && !originAllowed(request.headers.origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
      response.setHeader('Vary', 'Origin');
      if (originAllowed(request.headers.origin)) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin!); response.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (request.method === 'OPTIONS') {
        if (!originAllowed(request.headers.origin) || !['/api/alpha', '/api/alpha/socket-ticket'].includes(path) || request.headers['access-control-request-method'] !== 'POST'
          || (request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').some(h => !['', 'content-type'].includes(h.trim()))) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }); response.end(); return;
      }
      if (request.method === 'GET' && ['/health', '/live', '/ready'].includes(path)) {
        if (!consume(request, 'health', 120)) throw new HttpError(429, 'RATE_LIMITED');
        if (path === '/ready') {
          try { await options.ready(); }
          catch { log('error', 'request.failed', { requestId, code: 'DATABASE_UNAVAILABLE' }); throw new HttpError(503, 'DATABASE_UNAVAILABLE'); }
        }
        json(response, 200, { status: 'ok' }); return;
      }
      if (!consume(request, 'http', 300)) throw new HttpError(429, 'RATE_LIMITED');
      if (request.method === 'GET' && path === '/api/public-config') {
        json(response, 200, { webPublicUrl: config.webPublicUrl, gameServerPublicUrl: config.gameServerPublicUrl, alphaRequired: true,
          ...(config.alphaTransport ? { alphaTransport: config.alphaTransport } : {}) }); return;
      }
      if (path === '/api/alpha' && request.method === 'GET') { json(response, 200, { authenticated: access.verifyCookie(request.headers.cookie) }); return; }
      if (path === '/api/alpha' && request.method === 'POST') {
        if (!originAllowed(request.headers.origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
        if (!consume(request, 'alpha', 10)) throw new HttpError(429, 'RATE_LIMITED');
        if (Number(request.headers['content-length'] ?? 0) > 8192) { request.resume(); throw new HttpError(413, 'PAYLOAD_TOO_LARGE'); }
        const body = await readJson(request) as Record<string, unknown>;
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'code')) throw new HttpError(400, 'INVALID_MESSAGE');
        if (!access.acceptCode(body.code)) throw new HttpError(401, 'ALPHA_ACCESS_REQUIRED');
        response.setHeader('Set-Cookie', access.issueCookie()); json(response, 200, { authenticated: true }); return;
      }
      if (path === '/api/alpha/socket-ticket' && request.method === 'POST' && config.alphaTransport === 'TICKET') {
        if (!originAllowed(request.headers.origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
        if (!consume(request, 'ticket', 30)) throw new HttpError(429, 'RATE_LIMITED');
        const ticket = access.issueSocketTicket(request.headers.cookie);
        if (!ticket) throw new HttpError(401, 'ALPHA_ACCESS_REQUIRED');
        if (Number(request.headers['content-length'] ?? 0) > 8192) { request.resume(); throw new HttpError(413, 'PAYLOAD_TOO_LARGE'); }
        if (Object.keys(await readJson(request) as object).length) throw new HttpError(400, 'INVALID_MESSAGE');
        json(response, 200, { ticket }); return;
      }
      if (!['GET', 'HEAD'].includes(request.method ?? '')) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      // Only the build entry and flat hashed assets are public; no source, env, data, traversal or source maps.
      if (path !== '/' && !/^\/assets\/[\w.-]+\.(?:js|css|svg|png|woff2)$/.test(path)) throw new HttpError(404, 'NOT_FOUND');
      const relative = path === '/' ? 'index.html' : path.slice(1);
      let content: Buffer; try { content = await readFile(join(root, relative)); } catch { throw new HttpError(404, 'NOT_FOUND'); }
      const extension = relative.split('.').at(-1)!;
      const mime: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
      response.writeHead(200, { 'Content-Type': mime[extension]!, 'Cache-Control': path === '/' ? 'no-store' : 'public, max-age=31536000, immutable', 'Content-Length': content.byteLength });
      response.end(request.method === 'HEAD' ? undefined : content);
    })().catch(error => {
      const status = error instanceof HttpError ? error.status : 500, code = error instanceof HttpError ? error.code : 'SERVER_ERROR';
      log(status >= 500 ? 'error' : 'warn', 'request.failed', { requestId, status, code });
      if (!response.headersSent && !response.destroyed) { if (status === 429) response.setHeader('Retry-After', '60'); json(response, status, { error: { code, requestId } }); }
      else if (!response.destroyed) response.end();
    });
  };
  const http = options.tls ? createHttpsServer({ ...options.tls, minVersion: 'TLSv1.2' }, requestHandler) : createHttpServer(requestHandler);
  http.requestTimeout = 10000; http.headersTimeout = 10000; http.keepAliveTimeout = 5000; http.maxHeadersCount = 40;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has('conan-alpha.v1') ? 'conan-alpha.v1' : false });
  const runtime = bindGameSockets(sockets, { ...options, failureCode: productionFailureCode }, { maxPending: 256,
    authorize: authorized,
    check: (request, message) => {
      if (!authorized(request)) return 'ALPHA_ACCESS_REQUIRED';
      if (!message) return consume(request, 'wire', 1200) ? null : 'RATE_LIMITED';
      const category = message.type === 'CREATE_ROOM' ? 'create' : message.type === 'JOIN_ROOM' ? 'join' : message.type === 'RESUME_MATCH' ? 'resume' : 'command';
      const limit = category === 'create' ? 6 : category === 'join' ? 20 : category === 'resume' ? 30 : 600;
      return consume(request, category, limit) ? null : 'RATE_LIMITED';
    } });
  http.on('upgrade', (request, socket, head) => {
    const requestId = randomUUID();
    const deny = (status: number, code: string) => {
      log('warn', 'connection.rejected', { requestId, status, code });
      const body = JSON.stringify({ error: { code, requestId } });
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    };
    socket.on('error', () => {});
    if (request.url !== '/ws') { deny(404, 'NOT_FOUND'); return; }
    if (!originAllowed(request.headers.origin)) { deny(403, 'ORIGIN_FORBIDDEN'); return; }
    if (!consume(request, 'upgrade', 30) || sockets.clients.size >= 100) { deny(429, 'RATE_LIMITED'); return; }
    if (!authorized(request, true)) { deny(401, 'ALPHA_ACCESS_REQUIRED'); return; }
    if (!runtime.reserveConnection(request)) { deny(429, 'RATE_LIMITED'); return; }
    const abandon = () => runtime.cancelAdmission(request);
    socket.once('close', abandon);
    try {
      sockets.handleUpgrade(request, socket, head, ws => {
        socket.removeListener('close', abandon);
        const expires = config.alphaTransport === 'TICKET' ? access.socketExpiry(socketTicket(request)) : access.cookieExpiry(request.headers.cookie);
        const expiryTimer = setTimeout(() => ws.close(1008, 'ALPHA_ACCESS_REQUIRED'), Math.max(0, (expires ?? 0) * 1000 - Date.now()));
        expiryTimer.unref(); ws.once('close', () => clearTimeout(expiryTimer));
        sockets.emit('connection', ws, request);
      });
    } catch {
      socket.removeListener('close', abandon); abandon(); socket.destroy();
      log('warn', 'connection.rejected', { requestId, code: 'INVALID_MESSAGE' });
    }
  });
  http.on('clientError', (_error, socket) => { if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(options.port ?? 8787, options.host ?? '0.0.0.0', resolve); });
  const bound = http.address(); if (!bound || typeof bound === 'string') throw Error('SERVER_ADDRESS');
  return { port: bound.port, manager: runtime.manager, close: async () => {
    const closed = new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    await runtime.close(); http.closeAllConnections(); await closed;
  } };
}
