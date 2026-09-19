import { publicUrl } from '../server/config.ts';
import { readProxySettings } from '../server/proxy.ts';

export type WebConfig = { host: string; port: number; webPublicUrl: string; gameServerPublicUrl: string;
  trustProxy: boolean; proxyIpHeader?: 'X_REAL_IP'; logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent' };

export function readWebConfig(env: Record<string, string | undefined>): WebConfig {
  const web = publicUrl(env.WEB_PUBLIC_URL, 'https:', 'WEB_PUBLIC_URL');
  const game = publicUrl(env.GAME_SERVER_PUBLIC_URL, 'wss:', 'GAME_SERVER_PUBLIC_URL');
  const host = env.HOST ?? '0.0.0.0', port = env.PORT ?? '8080', logLevel = env.LOG_LEVEL ?? 'info';
  if (!host || /[\s/\\?#@]/.test(host)) throw Error('INVALID_HOST');
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) throw Error('INVALID_PORT');
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) throw Error('INVALID_LOG_LEVEL');
  return { host, port: +port, webPublicUrl: web.origin, gameServerPublicUrl: `${game.origin}/ws`,
    ...readProxySettings(env), logLevel: logLevel as WebConfig['logLevel'] };
}
