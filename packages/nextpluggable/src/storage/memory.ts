import { assertKey, type StorageAdapter } from './types.js';

/** Keeps everything in memory. For tests and demos — data is lost on restart. */
export function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    async get(key) {
      assertKey(key);
      return map.get(key) ?? null;
    },
    async set(key, value) {
      assertKey(key);
      map.set(key, value);
    },
    async delete(key) {
      assertKey(key);
      map.delete(key);
    },
    async list(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
