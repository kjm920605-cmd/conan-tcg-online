import { isIP } from 'node:net';
import { readProxySettings } from './proxy.ts';

export type ProductionSettings = {
  webPublicUrl: string;
  gameServerPublicUrl: string;
  allowedOrigins: string[];
  sessionSecret: string;
  alphaAccessSecret: string;
  trustProxy: boolean;
  proxyIpHeader?: 'X_REAL_IP';
  alphaTtlSeconds: number;
  alphaTransport?: 'TICKET';
};

export type ServerConfig = {
  mode: 'development' | 'test' | 'production';
  host: string;
  port: number;
  storage: 'postgres' | 'memory';
  databaseUrl?: string;
  databaseSchema: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  production?: ProductionSettings;
};

// Configuration errors name fields only. URLs and values may contain credentials.
function invalid(field: string): never { throw new Error(`INVALID_${field}`); }

function integer(value: string, field: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) invalid(field);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalid(field);
  return parsed;
}

function secret(value: string | undefined, field: string): string {
  if (!value || value.length < 32 || value.length > 512 || /\s/.test(value)
    || /change[_-]?me|replace|placeholder|example|your[_-]|test[_-]?secret|<|>/i.test(value)
    || new Set(value).size < 8 || /^(.{1,32})\1+$/.test(value)) invalid(field);
  return value;
}

function publicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number, number, number];
    return a !== 0 && a !== 10 && a !== 127 && a < 224
      && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0)) && !(a === 198 && (b === 18 || b === 19));
  }
  if (isIP(host) === 6) {
    // Global unicast only; excludes loopback, link-local, ULA and mapped local IPv4.
    const prefix = Number.parseInt(host.split(':')[0]!, 16);
    return prefix >= 0x2000 && prefix <= 0x3fff;
  }
  return host.length <= 253 && host.includes('.')
    && !/(^|\.)(localhost|local|internal|invalid|test)$/.test(host)
    && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function publicUrl(value: string | undefined, protocol: 'https:' | 'wss:', field: string): URL {
  if (!value || /[\s?#\\]/.test(value)) invalid(field);
  let parsed: URL;
  try { parsed = new URL(value); } catch { invalid(field); }
  if (parsed.protocol !== protocol || parsed.username || parsed.password || !publicHost(parsed.hostname)
    || parsed.port === '0') invalid(field);
  // Canonical forms also reject hidden authority, encoded/dot paths and empty query markers.
  const canonical = protocol === 'https:' ? parsed.origin : `${parsed.origin}/ws`;
  if (value !== canonical && !(protocol === 'https:' && value === `${canonical}/`)) invalid(field);
  return parsed;
}

function databaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL_REQUIRED');
  if (/[\s#]/.test(value)) invalid('DATABASE_URL');
  let parsed: URL;
  try { parsed = new URL(value); } catch { invalid('DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname
    || parsed.port === '0' || parsed.pathname.length < 2 || parsed.pathname.slice(1).includes('/')) invalid('DATABASE_URL');
  try {
    if (/[\x00-\x1f\x7f]/.test(decodeURIComponent(parsed.pathname))) invalid('DATABASE_URL');
    decodeURIComponent(parsed.username); decodeURIComponent(parsed.password);
  } catch { invalid('DATABASE_URL'); }
  return value;
}

/** Reads an explicitly supplied environment; it never reads files or process.env. */
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const mode = env.NODE_ENV ?? 'development';
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') invalid('NODE_ENV');
  const storage = env.MATCH_STORAGE ?? 'postgres';
  if (storage !== 'postgres' && storage !== 'memory') invalid('MATCH_STORAGE');
  if (mode === 'production' && storage !== 'postgres') invalid('MATCH_STORAGE');
  const host = env.HOST ?? (mode === 'production' ? '0.0.0.0' : '127.0.0.1');
  if (!host || /[\s/\\?#@]/.test(host)) invalid('HOST');
  const port = integer(env.PORT ?? '8787', 'PORT', mode === 'production' ? 1 : 0, 65535);
  const schema = env.DATABASE_SCHEMA ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) invalid('DATABASE_SCHEMA');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) invalid('LOG_LEVEL');
  const config: ServerConfig = {
    mode, host, port, storage, databaseSchema: schema, logLevel: logLevel as ServerConfig['logLevel'],
    ...(storage === 'postgres' ? { databaseUrl: databaseUrl(env.DATABASE_URL) } : {}),
  };
  if (mode !== 'production') return config;
  const sessionSecret = secret(env.SESSION_SECRET, 'SESSION_SECRET');
  const alphaAccessSecret = secret(env.ALPHA_ACCESS_SECRET, 'ALPHA_ACCESS_SECRET');
  if (sessionSecret === alphaAccessSecret) invalid('REUSED_SECRET');
  const web = publicUrl(env.WEB_PUBLIC_URL, 'https:', 'WEB_PUBLIC_URL');
  const game = publicUrl(env.GAME_SERVER_PUBLIC_URL, 'wss:', 'GAME_SERVER_PUBLIC_URL');
  const transport = env.ALPHA_TRANSPORT ?? 'COOKIE';
  if (transport !== 'COOKIE' && transport !== 'TICKET') invalid('ALPHA_TRANSPORT');
  if (web.host !== game.host && transport !== 'TICKET') invalid('PUBLIC_ORIGIN');
  if (!env.CORS_ORIGINS) invalid('CORS_ORIGINS');
  const allowedOrigins = [...new Set(env.CORS_ORIGINS.split(',').map(value => value.trim()))];
  if (allowedOrigins.some(value => value !== web.origin)) invalid('CORS_ORIGINS');
  config.production = {
    webPublicUrl: web.origin, gameServerPublicUrl: `${game.origin}/ws`, allowedOrigins,
    sessionSecret, alphaAccessSecret, ...readProxySettings(env),
    alphaTtlSeconds: integer(env.ALPHA_TTL_SECONDS ?? '28800', 'ALPHA_TTL_SECONDS', 60, 86400),
    ...(transport === 'TICKET' ? { alphaTransport: 'TICKET' as const } : {}),
  };
  return config;
}
