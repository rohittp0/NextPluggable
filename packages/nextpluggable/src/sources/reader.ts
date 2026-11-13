import { ManifestError, validateBuild, validateRepositoryIndex } from '@nextpluggable/plugin/manifest';
import type { ResolvedConfig } from '../config.js';
import { decrypt, sha256Hex } from '../crypto.js';
import { HttpError } from '../errors.js';
import type { Catalog, CatalogEntry, SourceRecord } from '../core/types.js';
import { githubReader } from './github.js';
import { localReader } from './local.js';

/** Read-only access to the files of a plugin source at a fixed revision. */
export interface SourceReader {
  /** The exact revision (commit SHA) the source currently points at. */
  resolveRevision(): Promise<string>;
  /** File contents, or null when the file does not exist. */
  read(path: string, revision: string): Promise<Uint8Array | null>;
}

export const joinPath = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('/');

export function readerFor(cfg: ResolvedConfig, source: SourceRecord): { reader: SourceReader; baseDir: string } {
  if (source.type === 'local' && source.local) {
    if (!cfg.allowLocalSources) throw new HttpError(400, 'Folder sources are turned off on this site.');
    return { reader: localReader(source.local.dir), baseDir: '' };
  }
  if (source.type === 'github' && source.github) {
    const own = source.github.token ? decrypt(cfg.secret, source.github.token) : null;
    if (source.github.token && own === null)
      throw new HttpError(400, `The saved access token for ${source.label} can no longer be read (the site secret changed). Remove the source and connect it again.`);
    return {
      reader: githubReader(source.github, { apiUrl: cfg.githubApiUrl, token: own ?? cfg.githubToken }),
      baseDir: source.github.dir ?? '',
    };
  }
  throw new HttpError(500, 'Unknown source type.');
}

const decoder = new TextDecoder('utf-8', { fatal: false });
export const decodeText = (bytes: Uint8Array) => decoder.decode(bytes);

/** List the plugins a source offers, at its current revision. */
export async function loadCatalog(source: SourceRecord, reader: SourceReader, baseDir: string): Promise<Catalog> {
  const revision = await reader.resolveRevision();
  const catalog: Catalog = { sourceId: source.id, revision, fetchedAt: new Date().toISOString(), plugins: [], problems: [] };

  const indexBytes = await reader.read(joinPath(baseDir, 'nextpluggable.json'), revision);
  let dirs: string[];
  if (indexBytes) {
    try {
      const index = validateRepositoryIndex(JSON.parse(decodeText(indexBytes)));
      catalog.name = index.name;
      catalog.description = index.description;
      dirs = [...new Set(index.plugins)];
    } catch (e) {
      throw new HttpError(422, `The file nextpluggable.json in ${source.label} could not be read: ${e instanceof ManifestError ? e.problems.join('; ') : 'it is not valid JSON'}.`);
    }
  } else {
    dirs = [''];
  }
  if (dirs.length > 100) throw new HttpError(422, `${source.label} lists more than 100 plugins.`);

  const seen = new Set<string>();
  const results = await Promise.all(
    dirs.map(async (dir): Promise<CatalogEntry | { path: string; message: string } | null> => {
      const bytes = await reader.read(joinPath(baseDir, dir, 'dist/build.json'), revision);
      if (!bytes) {
        if (!indexBytes) return null;
        return { path: dir, message: 'This plugin has not been built yet (dist/build.json is missing).' };
      }
      try {
        return { path: dir, build: validateBuild(JSON.parse(decodeText(bytes))), buildHash: sha256Hex(bytes) };
      } catch (e) {
        return { path: dir, message: e instanceof ManifestError ? e.problems.join('; ') : 'dist/build.json is not valid JSON.' };
      }
    }),
  );
  for (const r of results) {
    if (!r) continue;
    if ('message' in r) catalog.problems.push(r);
    else if (seen.has(r.build.manifest.id)) catalog.problems.push({ path: r.path, message: `Another plugin in this source already uses the id "${r.build.manifest.id}".` });
    else {
      seen.add(r.build.manifest.id);
      catalog.plugins.push(r);
    }
  }
  if (!indexBytes && catalog.plugins.length === 0 && catalog.problems.length === 0)
    throw new HttpError(
      422,
      `${source.label} does not look like a plugin source: it has no nextpluggable.json and no built plugin at its top level.`,
    );
  return catalog;
}
