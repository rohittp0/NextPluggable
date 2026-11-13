import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncrypted, safeEqual, signToken, verifyToken } from './crypto.js';

const SECRET = 'a-site-secret-that-is-long-enough';

describe('encryption at rest', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = encrypt(SECRET, 'sk_live_123');
    const b = encrypt(SECRET, 'sk_live_123');
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toContain('sk_live_123');
    expect(a).not.toBe(b);
    expect(decrypt(SECRET, a)).toBe('sk_live_123');
    expect(decrypt(SECRET, b)).toBe('sk_live_123');
  });

  it('refuses a wrong secret, tampering and plain values', () => {
    const value = encrypt(SECRET, 'hello');
    expect(decrypt('another-secret-entirely-different', value)).toBeNull();
    const flipped = value.slice(0, -2) + (value.endsWith('A') ? 'B' : 'A') + value.slice(-1);
    expect(decrypt(SECRET, flipped)).toBeNull();
    expect(decrypt(SECRET, 'hello')).toBeNull();
    expect(decrypt(SECRET, 'enc:v1:only-one-part')).toBeNull();
  });
});

describe('signed tokens', () => {
  it('verifies its own tokens and returns the payload', () => {
    const token = signToken(SECRET, { exp: Date.now() + 60_000, who: 'admin' });
    expect(verifyToken<{ exp: number; who: string }>(SECRET, token)?.who).toBe('admin');
  });

  it('rejects expired, forged and malformed tokens', () => {
    expect(verifyToken(SECRET, signToken(SECRET, { exp: Date.now() - 1 }))).toBeNull();
    expect(verifyToken('some-other-secret-value', signToken(SECRET, { exp: Date.now() + 60_000 }))).toBeNull();
    const [, sig] = signToken(SECRET, { exp: Date.now() + 60_000 }).split('.');
    const forged = `${Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url')}.${sig}`;
    expect(verifyToken(SECRET, forged)).toBeNull();
    for (const bad of [undefined, null, '', 'abc', '.', 'a.b.c']) expect(verifyToken(SECRET, bad)).toBeNull();
  });

  it('compares strings without caring about length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
