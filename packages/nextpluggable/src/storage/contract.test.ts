/**
 * One contract, every adapter: whatever a host stores its data in must behave
 * identically. Postgres runs when TEST_POSTGRES_URL is set.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileStorage } from './file.js';
import { memoryStorage } from './memory.js';
import { postgresStorage } from './postgres.js';
import { decodeSegment, encodeSegment, type StorageAdapter } from './types.js';
import { upstashStorage } from './upstash.js';

/** In-memory stand-in for the Upstash Redis REST API (GET / SET / DEL / SCAN with MATCH). */
function fakeUpstash() {
  const db = new Map<string, string>();
  const globToRegex = (glob: string) => new RegExp('^' + glob.replace(/\\(.)|\*|\?|[.+^${}()|[\]]/g, (m, escaped) => (escaped ? escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '*' ? '.*' : m === '?' ? '.' : `\\${m}`)) + '$', 's');
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer test-token') return new Response('{"error":"Unauthorized"}', { status: 401 });
    const [command, ...args] = JSON.parse(String(init?.body)) as string[];
    let result: unknown;
    if (command === 'GET') result = db.get(args[0]!) ?? null;
    else if (command === 'SET') (db.set(args[0]!, args[1]!), (result = 'OK'));
    else if (command === 'DEL') result = db.delete(args[0]!) ? 1 : 0;
    else if (command === 'SCAN') {
      // Return results in two pages to exercise cursor handling.
      const all = [...db.keys()].filter((k) => globToRegex(args[2]!).test(k));
      const half = Math.ceil(all.length / 2);
      result = args[0] === '0' && all.length > 1 ? ['1', all.slice(0, half)] : ['0', args[0] === '0' ? all : all.slice(half)];
    } else return new Response(JSON.stringify({ error: `ERR unknown command ${command}` }), { status: 400 });
    return new Response(JSON.stringify({ result }));
  }) as typeof fetch;
  return { fetchImpl, db };
}

interface Subject {
  storage: StorageAdapter;
  cleanup?: () => Promise<void>;
}

function contract(name: string, make: () => Promise<Subject>) {
  describe(`storage contract: ${name}`, () => {
    let s: StorageAdapter;
    let cleanup: (() => Promise<void>) | undefined;
    beforeAll(async () => ({ storage: s, cleanup } = await make()));
    afterAll(async () => cleanup?.());

    it('returns null for a key that was never set', async () => {
      expect(await s.get('missing/key.json')).toBeNull();
    });

    it('stores, overwrites and deletes values exactly', async () => {
      const value = JSON.stringify({ text: 'ünïcødé ✓ "quotes" \\ back\nnew', n: 1 });
      await s.set('a/one.json', value);
      expect(await s.get('a/one.json')).toBe(value);
      await s.set('a/one.json', 'second');
      expect(await s.get('a/one.json')).toBe('second');
      await s.delete('a/one.json');
      expect(await s.get('a/one.json')).toBeNull();
      await s.delete('a/one.json'); // deleting twice is fine
    });

    it('keeps an empty string distinct from "missing"', async () => {
      await s.set('a/empty', '');
      expect(await s.get('a/empty')).toBe('');
      await s.delete('a/empty');
    });

    it('holds a plugin-bundle-sized value', async () => {
      const big = 'x'.repeat(400_000);
      await s.set('files/big.js', big);
      expect((await s.get('files/big.js'))?.length).toBe(400_000);
      await s.delete('files/big.js');
    });

    it('lists by prefix, sorted, without leaking into sibling prefixes', async () => {
      for (const k of ['data/shop/b', 'data/shop/a', 'data/shop/sub/c', 'data/shopping/x', 'data/other/y', 'top.json']) await s.set(k, k);
      expect(await s.list('data/shop/')).toEqual(['data/shop/a', 'data/shop/b', 'data/shop/sub/c']);
      expect(await s.list('data/shop')).toEqual(['data/shop/a', 'data/shop/b', 'data/shop/sub/c', 'data/shopping/x']);
      expect(await s.list('data/none/')).toEqual([]);
      expect((await s.list('')).length).toBeGreaterThanOrEqual(6);
      for (const k of await s.list('data/')) await s.delete(k);
      await s.delete('top.json');
      expect(await s.list('data/')).toEqual([]);
    });

    it('treats pattern characters in keys literally', async () => {
      // `%` and `_` are wildcards in SQL LIKE; `*` `?` `[` are wildcards in Redis MATCH.
      const tricky = ['x/100%25', 'x/a_b', 'x/aXb', `x/${encodeSegment('q*[a]?')}`];
      for (const k of tricky) await s.set(k, k);
      expect(await s.list('x/a_')).toEqual(['x/a_b']);
      expect(await s.list('x/100%')).toEqual(['x/100%25']);
      expect(await s.get(`x/${encodeSegment('q*[a]?')}`)).toBe(`x/${encodeSegment('q*[a]?')}`);
      for (const k of tricky) await s.delete(k);
    });

    it('refuses keys that could escape its namespace', async () => {
      for (const bad of ['', '../outside', 'a/../b', 'a//b', '/abs', 'a/./b', 'a b', 'a\\b', 'a/b\u0000']) {
        await expect(s.set(bad, 'x')).rejects.toThrow();
        await expect(s.get(bad)).rejects.toThrow();
      }
    });
  });
}

contract('memory', async () => ({ storage: memoryStorage() }));

contract('file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'np-storage-'));
  return { storage: fileStorage({ dir }), cleanup: () => rm(dir, { recursive: true, force: true }) };
});

contract('upstash (REST)', async () => {
  const { fetchImpl } = fakeUpstash();
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return {
    storage: upstashStorage({ url: 'https://fake.upstash.io/', token: 'test-token' }),
    cleanup: async () => {
      globalThis.fetch = real;
    },
  };
});

const pgUrl = process.env.TEST_POSTGRES_URL;
if (pgUrl) {
  contract('postgres', async () => {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: pgUrl });
    const table = `np_test_${Date.now()}`;
    return {
      storage: postgresStorage({ query: (text, params) => pool.query(text, params), table }),
      cleanup: async () => {
        await pool.query(`DROP TABLE IF EXISTS ${table}`);
        await pool.end();
      },
    };
  });
} else {
  describe.skip('storage contract: postgres (set TEST_POSTGRES_URL to run)', () => it('skipped', () => {}));
}

describe('adapters', () => {
  it('upstash reports failures with the command that failed', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = fakeUpstash().fetchImpl;
    try {
      await expect(upstashStorage({ url: 'https://fake', token: 'wrong' }).get('k')).rejects.toThrow('Upstash GET failed: Unauthorized');
      const saved = { ...process.env };
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.KV_REST_API_URL;
      await expect(upstashStorage().get('k')).rejects.toThrow('needs a REST URL and token');
      process.env = saved;
    } finally {
      globalThis.fetch = real;
    }
  });

  it('upstash goes around the fetch wrapper Next.js installs, so storage reads never stop a page being prerendered', async () => {
    const real = globalThis.fetch;
    const { fetchImpl } = fakeUpstash();
    const wrapped = (async () => {
      throw new Error('Dynamic server usage');
    }) as unknown as typeof fetch & { _nextOriginalFetch?: typeof fetch };
    wrapped._nextOriginalFetch = fetchImpl;
    globalThis.fetch = wrapped;
    try {
      const storage = upstashStorage({ url: 'https://fake.upstash.io', token: 'test-token' });
      await storage.set('k', 'v');
      expect(await storage.get('k')).toBe('v');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('postgres refuses a table name that is not an identifier', () => {
    expect(() => postgresStorage({ query: async () => [], table: 'kv; DROP TABLE users' })).toThrow('Invalid table name');
  });

  it('postgres accepts clients that resolve to rows or to { rows }', async () => {
    const seen: string[] = [];
    const asArray = postgresStorage({ query: async (t) => (seen.push(t), t.startsWith('SELECT') ? [{ value: 'v' }] : []) });
    expect(await asArray.get('k')).toBe('v');
    expect(seen[0]).toContain('CREATE TABLE IF NOT EXISTS nextpluggable_kv');
    const asObject = postgresStorage({ query: async (t) => ({ rows: t.startsWith('SELECT') ? [{ value: 'w' }] : [] }) });
    expect(await asObject.get('k')).toBe('w');
  });

  it('encodes arbitrary text into one safe key segment and back', () => {
    for (const raw of ['simple', 'with/slash', '../../etc/passwd', '.hidden', 'spa ce', "q*[a]?!'()", 'ünï', '100%']) {
      const seg = encodeSegment(raw);
      expect(seg).toMatch(/^[A-Za-z0-9_@%~-][A-Za-z0-9._@%~-]*$/);
      expect(decodeSegment(seg)).toBe(raw);
    }
    expect(() => encodeSegment('')).toThrow();
  });
});
