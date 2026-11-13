import { globals } from '../globals.js';
import { encodeSegment, type StorageAdapter } from '../storage/types.js';
import type { Catalog, FileKind, Installs, SourceRecord, StoredFile } from './types.js';

const FILE_NAMES: Record<FileKind, string> = { client: 'client.js', server: 'server.js', style: 'style.css' };

async function readJson<T>(storage: StorageAdapter, key: string, fallback: T): Promise<T> {
  const raw = await storage.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`[nextpluggable] Stored record "${key}" is corrupted.`);
  }
}

export const getSources = (s: StorageAdapter) => readJson<SourceRecord[]>(s, 'sources.json', []);
export const saveSources = (s: StorageAdapter, sources: SourceRecord[]) => s.set('sources.json', JSON.stringify(sources));

export const getInstalls = (s: StorageAdapter) => readJson<Installs>(s, 'installs.json', {});
export const saveInstalls = (s: StorageAdapter, installs: Installs) => s.set('installs.json', JSON.stringify(installs));

export const getCatalog = (s: StorageAdapter, sourceId: string) => readJson<Catalog | null>(s, `catalogs/${sourceId}.json`, null);
export const saveCatalog = (s: StorageAdapter, catalog: Catalog) => s.set(`catalogs/${catalog.sourceId}.json`, JSON.stringify(catalog));
export const deleteCatalog = (s: StorageAdapter, sourceId: string) => s.delete(`catalogs/${sourceId}.json`);

export const fileKey = (pluginId: string, kind: FileKind, sha256: string) => `files/${pluginId}/${sha256}.${FILE_NAMES[kind]}`;

export async function putFile(s: StorageAdapter, pluginId: string, kind: FileKind, sha256: string, content: string): Promise<void> {
  const key = fileKey(pluginId, kind, sha256);
  await s.set(key, content);
  globals().files.set(key, content);
}

/** Plugin files are content-addressed and never change, so they are cached in memory for the life of the process. */
export async function getFile(s: StorageAdapter, pluginId: string, kind: FileKind, sha256: string): Promise<string | null> {
  const key = fileKey(pluginId, kind, sha256);
  const cache = globals().files;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const content = await s.get(key);
  if (content !== null) cache.set(key, content);
  return content;
}

/** Delete stored files of a plugin except the ones listed. */
export async function pruneFiles(s: StorageAdapter, pluginId: string, keep: Partial<Record<FileKind, StoredFile>>[]): Promise<void> {
  const keepKeys = new Set<string>();
  for (const set of keep) for (const [kind, f] of Object.entries(set)) if (f) keepKeys.add(fileKey(pluginId, kind as FileKind, f.sha256));
  for (const key of await s.list(`files/${pluginId}/`)) {
    if (keepKeys.has(key)) continue;
    await s.delete(key);
    globals().files.delete(key);
  }
}

export const dataKey = (pluginId: string, key: string) => `data/${pluginId}/${encodeSegment(key)}`;

export async function deletePluginData(s: StorageAdapter, pluginId: string): Promise<void> {
  for (const key of await s.list(`data/${pluginId}/`)) await s.delete(key);
}
