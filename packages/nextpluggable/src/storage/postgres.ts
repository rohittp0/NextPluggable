import { assertKey, type StorageAdapter } from './types.js';

export interface PostgresStorageOptions {
  /**
   * Runs a parameterised query (`$1`, `$2`, …) and resolves to the rows, or to an
   * object with a `rows` array. Matches `pg`'s `pool.query`, Neon's `sql.query`,
   * and is a one-liner to adapt for other clients.
   */
  query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] } | unknown[]>;
  /** Table name. Default `nextpluggable_kv`. Created automatically. */
  table?: string;
}

/** Stores everything in one Postgres table. Works with any client you already use. */
export function postgresStorage(options: PostgresStorageOptions): StorageAdapter {
  const table = options.table ?? 'nextpluggable_kv';
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(table)) throw new Error(`Invalid table name: ${table}`);
  let ready: Promise<unknown> | undefined;

  async function run(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    ready ??= options
      .query(`CREATE TABLE IF NOT EXISTS ${table} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`, [])
      .catch((e) => {
        ready = undefined;
        throw e;
      });
    await ready;
    const result = await options.query(text, params);
    return (Array.isArray(result) ? result : result.rows) as Record<string, unknown>[];
  }

  return {
    async get(key) {
      assertKey(key);
      const rows = await run(`SELECT value FROM ${table} WHERE key = $1`, [key]);
      return rows.length ? String(rows[0]!.value) : null;
    },
    async set(key, value) {
      assertKey(key);
      await run(
        `INSERT INTO ${table} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value],
      );
    },
    async delete(key) {
      assertKey(key);
      await run(`DELETE FROM ${table} WHERE key = $1`, [key]);
    },
    async list(prefix) {
      const pattern = prefix.replace(/[\\%_]/g, '\\$&') + '%';
      const rows = await run(`SELECT key FROM ${table} WHERE key LIKE $1 ESCAPE '\\' ORDER BY key COLLATE "C"`, [pattern]);
      return rows.map((r) => String(r.key));
    },
  };
}
