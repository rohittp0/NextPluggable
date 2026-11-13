import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SourceReader } from './reader.js';

/** Reads plugins from a folder on the server. For plugin development. */
export function localReader(dir: string): SourceReader {
  const root = path.resolve(/* turbopackIgnore: true */ dir);
  return {
    async resolveRevision() {
      return 'local';
    },
    async read(file) {
      const target = path.resolve(/* turbopackIgnore: true */ root, file);
      if (target !== root && !target.startsWith(root + path.sep)) return null;
      try {
        return new Uint8Array(await readFile(target));
      } catch {
        return null;
      }
    },
  };
}
