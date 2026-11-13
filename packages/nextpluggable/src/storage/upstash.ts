import { assertKey, type StorageAdapter } from './types.js';

export interface UpstashStorageOptions {
  /** REST URL. Default: `UPSTASH_REDIS_REST_URL` or `KV_REST_API_URL`. */
  url?: string;
  /** REST token. Default: `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_TOKEN`. */
  token?: string;
  /** Prefix for every key, so one database can be shared. Default `np:`. */
  prefix?: string;
}

/**
 * Stores everything in Upstash Redis over its REST API (also what Vercel's
 * "Upstash for Redis" marketplace integration provisions). Works on serverless
 * hosts and needs no extra dependency.
 */
export function upstashStorage(options: UpstashStorageOptions = {}): StorageAdapter {
  const prefix = options.prefix ?? 'np:';
  const creds = () => {
    const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token)
      throw new Error('upstashStorage needs a REST URL and token (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
    return { url: url.replace(/\/+$/, ''), token };
  };

  async function command<T>(...args: (string | number)[]): Promise<T> {
    const { url, token } = creds();
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!res.ok || !body || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body?.error ?? `HTTP ${res.status}`}`);
    return body.result as T;
  }

  // Redis glob characters in a prefix must be escaped for SCAN MATCH.
  const escapeGlob = (s: string) => s.replace(/[\\*?[\]]/g, '\\$&');

  return {
    async get(key) {
      assertKey(key);
      return command<string | null>('GET', prefix + key);
    },
    async set(key, value) {
      assertKey(key);
      await command('SET', prefix + key, value);
    },
    async delete(key) {
      assertKey(key);
      await command('DEL', prefix + key);
    },
    async list(keyPrefix) {
      const out = new Set<string>();
      let cursor = '0';
      do {
        const [next, keys] = await command<[string, string[]]>('SCAN', cursor, 'MATCH', `${escapeGlob(prefix + keyPrefix)}*`, 'COUNT', 1000);
        for (const k of keys) out.add(k.slice(prefix.length));
        cursor = next;
      } while (cursor !== '0');
      return [...out].sort();
    },
  };
}
