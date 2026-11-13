import { beforeEach, describe, expect, it } from 'vitest';
import { globals } from '../globals.js';
import { customAuth } from './custom.js';
import { passwordAuth } from './password.js';

const env = { secret: 'a-site-secret-that-is-long-enough' };
const url = 'https://example.test/api/nextpluggable/login';
const attempt = (auth: ReturnType<typeof passwordAuth>, password: unknown, ip = '203.0.113.1', target = url) =>
  auth.login!(new Request(target, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ password }) }), env);
const withCookie = (cookie: string) => new Request(url, { headers: { cookie } });

beforeEach(() => globals().loginAttempts.clear());

describe('passwordAuth', () => {
  it('signs in with the right password and sets a locked-down cookie', async () => {
    const auth = passwordAuth({ password: 'correct horse' });
    const res = await attempt(auth, 'correct horse');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^np_session=/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure', 'Max-Age=604800']) expect(cookie).toContain(flag);
    expect(await auth.getUser(withCookie(cookie.split(';')[0]!), env)).toEqual({ id: 'admin', name: 'Site owner' });
  });

  it('omits Secure on plain http (local development) and honours the proxy header', async () => {
    const auth = passwordAuth({ password: 'pw' });
    expect((await attempt(auth, 'pw', '1.1.1.1', 'http://localhost:3000/x')).headers.get('set-cookie')).not.toContain('Secure');
    const proxied = await auth.login!(new Request('http://internal:3000/x', { method: 'POST', headers: { 'x-forwarded-proto': 'https' }, body: '{"password":"pw"}' }), env);
    expect(proxied.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects wrong, empty and non-text passwords without setting a cookie', async () => {
    const auth = passwordAuth({ password: 'pw' });
    for (const bad of ['nope', '', null, 123, { $ne: '' }]) {
      const res = await attempt(auth, bad, `198.51.100.${String(bad).length}`);
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('is unusable until a password exists', async () => {
    const auth = passwordAuth({ password: '' });
    expect(auth.configured).toBe(false);
    expect((await attempt(auth, '')).status).toBe(503);
    expect(await auth.getUser(withCookie('np_session=anything'), env)).toBeNull();
  });

  it('slows down guessing per address, without locking out others', async () => {
    const auth = passwordAuth({ password: 'pw' });
    for (let i = 0; i < 8; i++) expect((await attempt(auth, 'guess', '203.0.113.9')).status).toBe(401);
    expect((await attempt(auth, 'pw', '203.0.113.9')).status).toBe(429); // even the right password must wait
    expect((await attempt(auth, 'pw', '203.0.113.10')).status).toBe(200);
  });

  it('rejects forged or foreign cookies', async () => {
    const auth = passwordAuth({ password: 'pw' });
    const cookie = (await attempt(auth, 'pw')).headers.get('set-cookie')!.split(';')[0]!;
    expect(await auth.getUser(withCookie(cookie.slice(0, -3) + 'abc'), env)).toBeNull();
    expect(await auth.getUser(withCookie(cookie), { secret: 'a-different-site-secret-entirely' })).toBeNull();
    expect(await auth.getUser(new Request(url), env)).toBeNull();
  });

  it('signs everyone out when the password changes', async () => {
    let password = 'first';
    const auth = passwordAuth({ get password() { return password; } } as { password: string });
    const cookie = (await attempt(auth, 'first')).headers.get('set-cookie')!.split(';')[0]!;
    expect(await auth.getUser(withCookie(cookie), env)).not.toBeNull();
    password = 'second';
    expect(await auth.getUser(withCookie(cookie), env)).toBeNull();
  });

  it('clears the cookie on sign-out', async () => {
    const res = await passwordAuth({ password: 'pw' }).logout!(new Request(url, { method: 'POST' }), env);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('customAuth', () => {
  it('defers to the site and only trusts a well-formed user', async () => {
    const auth = customAuth({ getUser: (req) => (req.headers.get('x-user') ? { id: req.headers.get('x-user')!, name: 'N', role: 'ignored' } as never : null), loginUrl: '/login' });
    expect(auth.loginUrl).toBe('/login');
    expect(await auth.getUser(new Request(url), env)).toBeNull();
    expect(await auth.getUser(new Request(url, { headers: { 'x-user': 'u1' } }), env)).toEqual({ id: 'u1', name: 'N' });
    expect(await customAuth({ getUser: () => ({}) as never }).getUser(new Request(url), env)).toBeNull();
  });
});
