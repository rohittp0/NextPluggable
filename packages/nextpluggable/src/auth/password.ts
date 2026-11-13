import { hmac, safeEqual, signToken, verifyToken } from '../crypto.js';
import { jsonResponse } from '../errors.js';
import { globals } from '../globals.js';
import type { AuthAdapter } from './types.js';

export interface PasswordAuthOptions {
  /** The dashboard password. Default: the `NEXTPLUGGABLE_PASSWORD` environment variable. */
  password?: string;
  /** How long a sign-in lasts. Default 7 days. */
  sessionDays?: number;
  cookieName?: string;
}

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;

function clientAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function isHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto ? proto === 'https' : new URL(request.url).protocol === 'https:';
}

/** One shared password for the dashboard, with a signed, http-only session cookie. */
export function passwordAuth(options: PasswordAuthOptions = {}): AuthAdapter {
  const cookieName = options.cookieName ?? 'np_session';
  const days = options.sessionDays ?? 7;
  const password = () => options.password ?? process.env.NEXTPLUGGABLE_PASSWORD ?? '';
  // Sessions carry a fingerprint of the password, so changing it signs everyone out.
  const fingerprint = (secret: string) => hmac(secret, `pw:${password()}`).slice(0, 16);
  const cookie = (request: Request, value: string, maxAge: number) =>
    `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(request) ? '; Secure' : ''}`;

  return {
    kind: 'password',
    get configured() {
      return password().length > 0;
    },
    async getUser(request, env) {
      if (!password()) return null;
      const session = verifyToken<{ exp: number; fp: string }>(env.secret, readCookie(request, cookieName));
      return session && session.fp === fingerprint(env.secret) ? { id: 'admin', name: 'Site owner' } : null;
    },
    async login(request, env) {
      if (!password()) return jsonResponse({ error: 'No dashboard password has been set up yet.' }, 503);
      const attempts = globals().loginAttempts;
      const who = clientAddress(request);
      const now = Date.now();
      const recent = (attempts.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
      if (recent.length >= MAX_ATTEMPTS) {
        attempts.set(who, recent);
        return jsonResponse({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
      }
      const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
      const given = typeof body?.password === 'string' ? body.password : '';
      if (!given || !safeEqual(given, password())) {
        recent.push(now);
        attempts.set(who, recent);
        return jsonResponse({ error: 'That password is not right.' }, 401);
      }
      attempts.delete(who);
      const token = signToken(env.secret, { exp: now + days * 86_400_000, fp: fingerprint(env.secret) });
      return jsonResponse({ user: { id: 'admin', name: 'Site owner' } }, 200, { 'set-cookie': cookie(request, token, days * 86_400) });
    },
    async logout(request) {
      return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie(request, '', 0) });
    },
  };
}
