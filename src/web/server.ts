import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { ServerOptions as TlsOptions } from 'node:https';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from '../server/rate-limit.ts';
import { clientAddress } from '../server/proxy.ts';
import { silentLogger } from '../server/logging.ts';
import type { AuditLogger } from '../server/logging.ts';
import type { WebConfig } from './config.ts';

type Options = { config: WebConfig; staticRoot: string | URL; logger?: AuditLogger; tls?: TlsOptions; fetcher?: typeof fetch };
class WebError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
};
function alphaCookie(header: string | undefined): string | undefined {
  if (!header || header.length > 8192) return;
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith('__Host-alpha='));
  if (values.length === 1 && /^__Host-alpha=[A-Za-z0-9._-]{1,256}$/.test(values[0]!)) return values[0];
}
function safeSetCookie(header: string): boolean {
  if (header.length > 512 || !/^__Host-alpha=[A-Za-z0-9._-]+;/.test(header)) return false;
  const parts = header.split(';').map(part => part.trim());
  const attributes = parts.slice(1);
  return attributes.length === 5 && new Set(attributes.map(part => part.split('=')[0]!.toLowerCase())).size === 5
    && attributes.some(part => /^Max-Age=\d{1,5}$/i.test(part) && +part.split('=')[1]! <= 86400)
    && attributes.some(part => /^Path=\/$/i.test(part)) && attributes.some(part => /^Secure$/i.test(part))
    && attributes.some(part => /^HttpOnly$/i.test(part)) && attributes.some(part => /^SameSite=Strict$/i.test(part));
}
async function requestBody(request: IncomingMessage, ticket: boolean): Promise<string> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new WebError(415, 'INVALID_MESSAGE');
  if (Number(request.headers['content-length'] ?? 0) > 8192) { request.resume(); throw new WebError(413, 'PAYLOAD_TOO_LARGE'); }
  let body = '', length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 8192) throw new WebError(413, 'PAYLOAD_TOO_LARGE'); body += chunk.toString(); }
  let value: unknown; try { value = JSON.parse(body); } catch { throw new WebError(400, 'INVALID_MESSAGE'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebError(400, 'INVALID_MESSAGE');
  if (ticket ? Object.keys(value).length !== 0 : Object.keys(value).length !== 1 || !('code' in value)
    || typeof value.code !== 'string' || !value.code || value.code.length > 512) throw new WebError(400, 'INVALID_MESSAGE');
  return JSON.stringify(value);
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (Number(response.headers.get('content-length') ?? 0) > 8192) { await response.body?.cancel(); throw Error(); }
  const reader = response.body?.getReader(); if (!reader) throw Error();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 8192) throw Error(); chunks.push(value); } }
  catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  return value as Record<string, unknown>;
}

/** Static Web + fixed Alpha API bridge only. No Game Engine, database or WS proxy. */
export async function createWebServer(options: Options) {
  const { config } = options, fetcher = options.fetcher ?? fetch, log = options.logger ?? silentLogger, limits = new RateLimiter();
  const root = options.staticRoot instanceof URL ? fileURLToPath(options.staticRoot) : options.staticRoot;
  const upstream = new URL(config.gameServerPublicUrl.replace(/^wss:/, 'https:')).origin;
  let outstanding = 0;
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID(), started = Date.now();
    const forwarded = config.trustProxy && config.proxyIpHeader !== 'X_REAL_IP' ? request.headers['x-forwarded-for'] : undefined;
    const candidate = typeof forwarded === 'string' ? forwarded.split(',').at(-1)!.trim() : '';
    const trustedIp = isIP(candidate) ? candidate : undefined, ip = clientAddress(request, config);
    const consume = (category: string, limit: number) => limits.consume(`${category}:${ip}`, { limit, windowMs: 60000 });
    response.setHeader('X-Request-Id', requestId); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${config.gameServerPublicUrl}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    response.on('finish', () => log('info', 'request.completed', { requestId, status: response.statusCode, durationMs: Date.now() - started }));
    void (async () => {
      const path = request.url ?? '/';
      if (request.headers.origin && request.headers.origin !== config.webPublicUrl) throw new WebError(403, 'ORIGIN_FORBIDDEN');
      const health = ['/health', '/live', '/ready'].includes(path);
      if (!consume(health ? 'health' : 'http', health ? 120 : 300)) throw new WebError(429, 'RATE_LIMITED');
      if (['/health', '/live'].includes(path) && request.method === 'GET') { json(response, 200, { status: 'ok' }); return; }
      if (path === '/api/public-config' && request.method === 'GET') {
        json(response, 200, { webPublicUrl: config.webPublicUrl, gameServerPublicUrl: config.gameServerPublicUrl, alphaRequired: true, alphaTransport: 'TICKET' }); return;
      }
      const alpha = path === '/api/alpha', ticket = path === '/api/alpha/socket-ticket', ready = path === '/ready';
      if (alpha || ticket || ready) {
        if (!(request.method === 'POST' && (alpha || ticket) || request.method === 'GET' && (alpha || ready))) throw new WebError(405, 'METHOD_NOT_ALLOWED');
        let body: string | undefined;
        if (request.method === 'POST') {
          if (request.headers.origin !== config.webPublicUrl) throw new WebError(403, 'ORIGIN_FORBIDDEN');
          body = await requestBody(request, ticket);
          if (!consume(ticket ? 'ticket' : 'alpha', ticket ? 30 : 10)) throw new WebError(429, 'RATE_LIMITED');
        }
        if (outstanding >= 32) throw new WebError(503, 'UPSTREAM_UNAVAILABLE');
        outstanding++;
        const headers: Record<string, string> = { Origin: config.webPublicUrl };
        const cookie = alphaCookie(request.headers.cookie); if (cookie && !ready) headers.Cookie = cookie;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (trustedIp) headers['X-Forwarded-For'] = trustedIp;
        try {
          const result = await fetcher(upstream + path, { method: request.method, headers, ...(body === undefined ? {} : { body }),
            redirect: 'manual', signal: AbortSignal.timeout(5000) });
          if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); throw Error(); }
          const value = await boundedJson(result);
          if (ready) {
            if (!result.ok || value.status !== 'ok') throw new WebError(503, 'UPSTREAM_UNAVAILABLE');
            json(response, 200, { status: 'ok' }); return;
          }
          if (!result.ok) {
            const detail = value.error;
            const code = detail && typeof detail === 'object' && 'code' in detail ? detail.code : null;
            const statuses: Record<string, number> = { ALPHA_ACCESS_REQUIRED: 401, RATE_LIMITED: 429, ORIGIN_FORBIDDEN: 403,
              INVALID_MESSAGE: 400, PAYLOAD_TOO_LARGE: 413, DATABASE_UNAVAILABLE: 503, SERVER_ERROR: 500 };
            if (typeof code !== 'string' || !Object.hasOwn(statuses, code) || statuses[code] !== result.status) throw Error();
            throw new WebError(result.status, code);
          }
          let safe: object;
          if (ticket) {
            if (typeof value.ticket !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(value.ticket)) throw Error();
            safe = { ticket: value.ticket };
          } else {
            if (typeof value.authenticated !== 'boolean') throw Error();
            safe = { authenticated: value.authenticated };
          }
          const cookies = result.headers.getSetCookie();
          if (!ticket && cookies.length === 1 && safeSetCookie(cookies[0]!)) response.setHeader('Set-Cookie', cookies[0]!);
          json(response, 200, safe); return;
        } catch (error) { throw error instanceof WebError ? error : new WebError(ready ? 503 : 502, 'UPSTREAM_UNAVAILABLE'); }
        finally { outstanding--; }
      }
      if (path !== '/' && !/^\/assets\/[\w.-]+\.(?:js|css|svg|png|woff2)$/.test(path)) throw new WebError(404, 'NOT_FOUND');
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new WebError(405, 'METHOD_NOT_ALLOWED');
      const relative = path === '/' ? 'index.html' : path.slice(1);
      let content: Buffer; try { content = await readFile(join(root, relative)); } catch { throw new WebError(404, 'NOT_FOUND'); }
      const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
      response.writeHead(200, { 'Content-Type': types[relative.split('.').at(-1)!]!, 'Content-Length': content.byteLength,
        'Cache-Control': path === '/' ? 'no-store' : 'public, max-age=31536000, immutable' });
      response.end(request.method === 'HEAD' ? undefined : content);
    })().catch(error => {
      const status = error instanceof WebError ? error.status : 500, code = error instanceof WebError ? error.code : 'SERVER_ERROR';
      log(status >= 500 ? 'error' : 'warn', 'request.failed', { requestId, status, code });
      if (!response.headersSent && !response.destroyed) { if (status === 429) response.setHeader('Retry-After', '60'); json(response, status, { error: { code, requestId } }); }
      else if (!response.destroyed) response.end();
    });
  };
  const server = options.tls ? createHttpsServer({ ...options.tls, minVersion: 'TLSv1.2' }, handler) : createHttpServer(handler);
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 40;
  server.on('upgrade', (_request, socket) => { socket.on('error', () => {}); socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); });
  server.on('clientError', (_error, socket) => { if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('WEB_ADDRESS');
  return { port: address.port, close: async () => {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  } };
}
