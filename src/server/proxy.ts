import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export type ProxySettings = { trustProxy: boolean; proxyIpHeader?: 'X_REAL_IP' };

export function readProxySettings(env: Record<string, string | undefined>): ProxySettings {
  const trust = env.TRUST_PROXY ?? 'false', header = env.PROXY_IP_HEADER ?? 'X_FORWARDED_FOR';
  if (!['true', 'false'].includes(trust)) throw Error('INVALID_TRUST_PROXY');
  if (!['X_FORWARDED_FOR', 'X_REAL_IP'].includes(header) || header === 'X_REAL_IP' && trust !== 'true') throw Error('INVALID_PROXY_IP_HEADER');
  return { trustProxy: trust === 'true', ...(header === 'X_REAL_IP' ? { proxyIpHeader: 'X_REAL_IP' as const } : {}) };
}

/** Enable only behind an edge that overwrites the selected header; no public bypass port. */
export function clientAddress(request: IncomingMessage, config: ProxySettings): string {
  if (config.trustProxy) {
    const value = request.headers[config.proxyIpHeader === 'X_REAL_IP' ? 'x-real-ip' : 'x-forwarded-for'];
    const candidate = typeof value === 'string' ? (config.proxyIpHeader === 'X_REAL_IP' ? value.trim() : value.split(',').at(-1)!.trim()) : '';
    if (isIP(candidate)) return candidate;
  }
  return request.socket.remoteAddress ?? 'unknown';
}
