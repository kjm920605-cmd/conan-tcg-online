import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProductionSettings } from './config.ts';

const COOKIE_NAME = '__Host-alpha';

/** Shared alpha admission is separate from authenticated game PlayerSessions. */
export class AlphaAccess {
  private readonly signingKey: Buffer;
  private readonly codeHash: Buffer;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly ticketAudience: string;

  constructor(settings: ProductionSettings, now: () => number = Date.now) {
    // Both secret rotations revoke cookies; domain separation prevents cross-protocol reuse.
    this.signingKey = createHmac('sha256', settings.sessionSecret)
      .update('conan-tcg:alpha-cookie:v1\0').update(settings.alphaAccessSecret).digest();
    this.codeHash = createHash('sha256').update(settings.alphaAccessSecret).digest();
    this.ttl = settings.alphaTtlSeconds;
    this.now = now;
    this.ticketAudience = `${settings.webPublicUrl}\0${settings.gameServerPublicUrl}`;
  }

  acceptCode(code: unknown): boolean {
    if (typeof code !== 'string' || code.length === 0 || code.length > 512) return false;
    return timingSafeEqual(this.codeHash, createHash('sha256').update(code).digest());
  }

  issueCookie(): string {
    const expires = Math.floor(this.now() / 1000) + this.ttl;
    const payload = `v1.${expires}.${randomBytes(24).toString('base64url')}`;
    const signature = createHmac('sha256', this.signingKey).update(payload).digest('base64url');
    return `${COOKIE_NAME}=${payload}.${signature}; Max-Age=${this.ttl}; Path=/; Secure; HttpOnly; SameSite=Strict`;
  }

  verifyCookie(header: string | undefined): boolean {
    return this.cookieExpiry(header) !== null;
  }

  /** Authenticated Unix expiry in seconds; null for any invalid or expired cookie. */
  cookieExpiry(header: string | undefined): number | null {
    if (!header || header.length > 8192 || /[\x00-\x1f\x7f]/.test(header)) return null;
    let value: string | undefined;
    for (const part of header.split(';')) {
      const pair = part.trim();
      if (!pair.startsWith(`${COOKIE_NAME}=`)) continue;
      if (value !== undefined) return null;
      value = pair.slice(COOKIE_NAME.length + 1);
    }
    if (!value) return null;
    const match = /^(v1\.([1-9]\d{0,12})\.[A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return null;
    const expires = Number(match[2]);
    const now = Math.floor(this.now() / 1000);
    if (!Number.isSafeInteger(expires) || !Number.isFinite(now) || expires <= now || expires > now + this.ttl) return null;
    const supplied = Buffer.from(match[3]!, 'base64url');
    // Node accepts noncanonical base64 trailing bits; enforce one representation per signature.
    if (supplied.toString('base64url') !== match[3]) return null;
    const expected = createHmac('sha256', this.signingKey).update(match[1]!).digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? expires : null;
  }

  private ticketSignature(payload: string): Buffer {
    return createHmac('sha256', this.signingKey).update('conan-tcg:alpha-ws:v1\0').update(this.ticketAudience).update('\0').update(payload).digest();
  }

  issueSocketTicket(cookie: string | undefined): string | null {
    const expires = this.cookieExpiry(cookie); if (expires === null) return null;
    const deadline = Math.min(expires, Math.floor(this.now() / 1000) + 30);
    const payload = `ws1.${deadline}.${expires}.${randomBytes(24).toString('base64url')}`;
    return `${payload}.${this.ticketSignature(payload).toString('base64url')}`;
  }

  /** The short deadline limits new handshakes; established sockets retain only the original access lifetime. */
  verifySocketTicket(ticket: string | undefined, admission = true): boolean {
    if (!ticket || ticket.length > 256) return false;
    const match = /^(ws1\.([1-9]\d{0,12})\.([1-9]\d{0,12})\.[A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!match) return false;
    const deadline = Number(match[2]), expires = Number(match[3]), now = Math.floor(this.now() / 1000);
    if (!Number.isFinite(now) || !Number.isSafeInteger(deadline) || !Number.isSafeInteger(expires)
      || expires <= now || expires > now + this.ttl || deadline > expires || deadline > now + 30 || admission && deadline <= now) return false;
    const signature = Buffer.from(match[4]!, 'base64url'), expected = this.ticketSignature(match[1]!);
    return signature.toString('base64url') === match[4] && signature.length === expected.length && timingSafeEqual(signature, expected);
  }

  socketExpiry(ticket: string | undefined): number | null {
    return this.verifySocketTicket(ticket, false) ? Number(ticket!.split('.')[2]) : null;
  }
}
