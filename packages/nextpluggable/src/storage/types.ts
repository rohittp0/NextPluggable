/**
 * Where NextPluggable keeps everything: connected sources, installed plugins,
 * their bundles, settings and data. A flat string key-value store is all it
 * needs, so any database can back it.
 *
 * Keys are `/`-separated paths whose segments use only `A-Z a-z 0-9 . _ @ % ~ -`.
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** All keys that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

const SEGMENT = /^[A-Za-z0-9_@%~-][A-Za-z0-9._@%~-]*$/;

export function assertKey(key: string): void {
  if (!key || key.length > 900 || !key.split('/').every((s) => SEGMENT.test(s))) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
}

/** Encode an arbitrary string as a single safe key segment. */
export function encodeSegment(value: string): string {
  const out = encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/^\./, '%2E');
  if (!out) throw new Error('Storage keys cannot be empty');
  return out;
}

export const decodeSegment = (segment: string): string => decodeURIComponent(segment);
