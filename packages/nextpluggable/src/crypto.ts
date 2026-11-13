import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const b64u = (buf: Uint8Array): string => Buffer.from(buf).toString('base64url');

export function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Constant-time string comparison (compares digests so length is not leaked). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'nextpluggable', purpose, 32));
}

const ENC_PREFIX = 'enc:v1:';

export const isEncrypted = (value: unknown): value is string => typeof value === 'string' && value.startsWith(ENC_PREFIX);

/** AES-256-GCM with a key derived from the site secret. Used for plugin secrets and source tokens at rest. */
export function encrypt(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, 'settings'), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${ENC_PREFIX}${b64u(iv)}:${b64u(body)}`;
}

/** Returns null when the value cannot be decrypted (wrong secret or tampering). */
export function decrypt(secret: string, value: string): string | null {
  if (!isEncrypted(value)) return null;
  const [ivPart, bodyPart] = value.slice(ENC_PREFIX.length).split(':');
  if (!ivPart || !bodyPart) return null;
  try {
    const body = Buffer.from(bodyPart, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(secret, 'settings'), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A signed, expiring token: `<payload>.<signature>`. */
export function signToken(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifyToken<T extends { exp: number }>(secret: string, token: string | undefined | null): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!safeEqual(hmac(secret, body), token.slice(dot + 1))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
