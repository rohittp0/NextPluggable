import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertKey, type StorageAdapter } from './types.js';

export interface FileStorageOptions {
  /** Directory to store data in. Default: `NEXTPLUGGABLE_DATA_DIR`, else `.nextpluggable` in the project root. */
  dir?: string;
}

/**
 * Stores everything as files in a directory. Right for local development and
 * for a single long-running server (VPS, Docker with a volume). Not for
 * serverless hosts such as Vercel, whose filesystem is read-only and not shared
 * between instances — use a database adapter there.
 */
export function fileStorage(options: FileStorageOptions = {}): StorageAdapter {
  const root = path.resolve(/* turbopackIgnore: true */ options.dir ?? process.env.NEXTPLUGGABLE_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.nextpluggable'));
  const file = (key: string) => {
    assertKey(key);
    return path.join(root, ...key.split('/'));
  };
  let seq = 0;

  async function walk(dir: string, prefix: string, out: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.endsWith('.tmp')) continue;
      const key = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), key, out);
      else out.push(key);
    }
  }

  return {
    async get(key) {
      try {
        return await readFile(file(key), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
        throw e;
      }
    },
    async set(key, value) {
      const target = file(key);
      await mkdir(path.dirname(target), { recursive: true });
      // Write-then-rename so a crash never leaves a half-written record.
      const tmp = `${target}.${process.pid}.${++seq}.tmp`;
      await writeFile(tmp, value, 'utf8');
      await rename(tmp, target);
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
    async list(prefix) {
      const slash = prefix.lastIndexOf('/');
      const dirKey = slash === -1 ? '' : prefix.slice(0, slash);
      if (dirKey) assertKey(dirKey);
      const out: string[] = [];
      await walk(dirKey ? path.join(root, ...dirKey.split('/')) : root, dirKey, out);
      return out.filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
