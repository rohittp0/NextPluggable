import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { checkPagePath, defaultConfig, isStaticPath, validateBuild, validateSettings, ManifestError } from '@nextpluggable/plugin/manifest';
import type { PluginBuild, PluginManifest } from '@nextpluggable/plugin/manifest';
import type { ResolvedConfig } from '../config.js';
import { decrypt, encrypt, isEncrypted, sha256Hex } from '../crypto.js';
import { HttpError } from '../errors.js';
import { globals } from '../globals.js';
import { parseGitHubUrl } from '../sources/github.js';
import { decodeText, joinPath, loadCatalog, readerFor } from '../sources/reader.js';
import { effectivePaths, pathProblem } from './routes.js';
import { evaluateServer, loadServer, pluginContext } from './runtime.js';
import { invalidateInstalledPlugins } from './state.js';
import {
  deleteCatalog,
  deletePluginData,
  getInstalls,
  getSources,
  pruneFiles,
  putFile,
  saveCatalog,
  saveInstalls,
  saveSources,
} from './store.js';
import type { Catalog, FileKind, InstallRecord, Installs, SourceRecord, StoredFile } from './types.js';

const MAX_BYTES: Record<FileKind, number> = { client: 3_000_000, server: 5_000_000, style: 1_000_000 };
const KINDS: FileKind[] = ['client', 'server', 'style'];

const reservedPaths = (cfg: ResolvedConfig) => [cfg.dashboardPath, cfg.apiPath, '/_next', '/api'];

/** True while a required setting has no value — the plugin stays paused until the owner fills it in. */
export function needsSetup(manifest: PluginManifest, config: InstallRecord['config']): boolean {
  return (manifest.settings ?? []).some((f) => f.required && (config[f.key] === undefined || config[f.key] === ''));
}

// ---------------------------------------------------------------- sources

export async function addSource(cfg: ResolvedConfig, input: { url?: unknown; token?: unknown }): Promise<SourceRecord> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!url) throw new HttpError(400, 'Paste the address of the GitHub repository that holds the plugins.');
  const sources = await getSources(cfg.storage);
  const id = `s${randomBytes(5).toString('hex')}`;
  const addedAt = new Date().toISOString();
  let record: SourceRecord;

  const gh = parseGitHubUrl(url);
  if (gh) {
    const same = sources.find(
      (s) =>
        s.github &&
        s.github.owner.toLowerCase() === gh.owner.toLowerCase() &&
        s.github.repo.toLowerCase() === gh.repo.toLowerCase() &&
        (s.github.dir ?? '') === (gh.dir ?? '') &&
        (s.github.ref ?? '') === (gh.ref ?? ''),
    );
    if (same) throw new HttpError(409, `${same.label} is already connected.`);
    record = {
      id,
      type: 'github',
      label: `${gh.owner}/${gh.repo}${gh.dir ? `/${gh.dir}` : ''}`,
      addedAt,
      github: { ...gh, ...(token ? { token: encrypt(cfg.secret, token) } : {}) },
    };
  } else if (cfg.allowLocalSources && /^(file:|\/|\.\.?\/|[A-Za-z]:[\\/])/.test(url)) {
    const dir = path.resolve(/* turbopackIgnore: true */ url.replace(/^file:(\/\/)?/, ''));
    if (sources.some((s) => s.local?.dir === dir)) throw new HttpError(409, 'That folder is already connected.');
    record = { id, type: 'local', label: path.basename(dir) || dir, addedAt, local: { dir } };
  } else {
    throw new HttpError(400, 'That does not look like a GitHub repository address. It should look like https://github.com/owner/repository.');
  }

  // Reading the catalog first proves the address and token work before anything is saved.
  const { reader, baseDir } = readerFor(cfg, record);
  const catalog = await loadCatalog(record, reader, baseDir);
  await saveCatalog(cfg.storage, catalog);
  await saveSources(cfg.storage, [...sources, record]);
  return record;
}

export async function refreshSource(cfg: ResolvedConfig, source: SourceRecord): Promise<Catalog> {
  const { reader, baseDir } = readerFor(cfg, source);
  const catalog = await loadCatalog(source, reader, baseDir);
  await saveCatalog(cfg.storage, catalog);
  return catalog;
}

/** Refresh every source; one failing source does not stop the others. */
export async function refreshAllSources(cfg: ResolvedConfig): Promise<{ label: string; message: string }[]> {
  const failures: { label: string; message: string }[] = [];
  await Promise.all(
    (await getSources(cfg.storage)).map((source) =>
      refreshSource(cfg, source).catch((e: unknown) => {
        failures.push({ label: source.label, message: e instanceof HttpError ? e.message : 'Something went wrong reading this source.' });
        if (!(e instanceof HttpError)) console.error('[nextpluggable] refresh failed', e);
      }),
    ),
  );
  return failures;
}

export async function removeSource(cfg: ResolvedConfig, sourceId: string): Promise<void> {
  const sources = await getSources(cfg.storage);
  if (!sources.some((s) => s.id === sourceId)) throw new HttpError(404, 'That source is no longer connected.');
  await saveSources(cfg.storage, sources.filter((s) => s.id !== sourceId));
  await deleteCatalog(cfg.storage, sourceId);
}

// ---------------------------------------------------------------- install / update

async function fetchBuild(
  cfg: ResolvedConfig,
  source: SourceRecord,
  pluginPath: string,
): Promise<{ build: PluginBuild; buildHash: string; revision: string; files: Partial<Record<FileKind, { meta: StoredFile; content: string }>> }> {
  const { reader, baseDir } = readerFor(cfg, source);
  const revision = await reader.resolveRevision();
  const dir = joinPath(baseDir, pluginPath);
  const buildBytes = await reader.read(joinPath(dir, 'dist/build.json'), revision);
  if (!buildBytes) throw new HttpError(404, `That plugin is no longer available in ${source.label}.`);
  let build: PluginBuild;
  try {
    build = validateBuild(JSON.parse(decodeText(buildBytes)));
  } catch (e) {
    throw new HttpError(422, `This plugin cannot be installed because its package is not valid: ${e instanceof ManifestError ? e.problems.join('; ') : 'unreadable build file'}.`);
  }
  const files: Partial<Record<FileKind, { meta: StoredFile; content: string }>> = {};
  await Promise.all(
    KINDS.map(async (kind) => {
      const entry = build.files[kind];
      if (!entry) return;
      if (entry.bytes > MAX_BYTES[kind]) throw new HttpError(422, `This plugin is too large to install (${kind} bundle is ${(entry.bytes / 1e6).toFixed(1)} MB).`);
      const bytes = await reader.read(joinPath(dir, entry.path), revision);
      if (!bytes) throw new HttpError(422, `This plugin is incomplete: ${entry.path} is missing from ${source.label}.`);
      // Integrity: what we store must be byte-for-byte what the plugin's build recorded.
      if (sha256Hex(bytes) !== entry.sha256)
        throw new HttpError(422, `This plugin failed its integrity check (${entry.path} does not match its recorded fingerprint). Ask the plugin author to rebuild it.`);
      files[kind] = { meta: { sha256: entry.sha256, bytes: bytes.byteLength }, content: decodeText(bytes) };
    }),
  );
  return { build, buildHash: sha256Hex(buildBytes), revision, files };
}

function carryConfig(manifest: PluginManifest, previous: InstallRecord['config'] | undefined): InstallRecord['config'] {
  const config: InstallRecord['config'] = { ...defaultConfig(manifest) };
  if (!previous) return config;
  const plain: Record<string, unknown> = {};
  for (const f of manifest.settings ?? []) {
    const v = previous[f.key];
    if (v === undefined) continue;
    if (f.type === 'secret') {
      if (isEncrypted(v)) config[f.key] = v;
    } else plain[f.key] = v;
  }
  // Keep earlier answers that are still valid under the new version's rules.
  const { values } = validateSettings({ ...manifest, settings: (manifest.settings ?? []).filter((f) => f.type !== 'secret' && f.key in plain) }, plain);
  return { ...config, ...values };
}

async function install(cfg: ResolvedConfig, source: SourceRecord, pluginPath: string, existing: InstallRecord | undefined): Promise<InstallRecord> {
  const fetched = await fetchBuild(cfg, source, pluginPath);
  const { manifest } = fetched.build;
  const installs = await getInstalls(cfg.storage);

  if (existing) {
    if (manifest.id !== existing.id) throw new HttpError(409, 'The plugin at this location now has a different identity and cannot be used as an update.');
  } else if (installs[manifest.id]) {
    throw new HttpError(409, `${installs[manifest.id]!.manifest.name} is already installed.`);
  }

  // Page addresses: keep the owner's choices where the page still exists.
  const paths: Record<string, string> = {};
  for (const page of manifest.pages ?? []) {
    const chosen = existing?.paths[page.id];
    if (chosen && page.configurablePath !== false && isStaticPath(page.path)) paths[page.id] = chosen;
  }
  const others: Installs = { ...installs };
  delete others[manifest.id];
  const draft = { id: manifest.id, manifest, paths } as InstallRecord;
  for (const page of manifest.pages ?? []) {
    const problem = pathProblem({ ...others, [manifest.id]: draft }, manifest.id, page.id, effectivePaths(draft)[page.id]!, reservedPaths(cfg));
    if (problem) throw new HttpError(409, `${problem} Change that page's address first, then try again.`);
  }

  const config = carryConfig(manifest, existing?.config);
  const now = new Date().toISOString();
  const files: InstallRecord['files'] = {};
  for (const kind of KINDS) {
    const f = fetched.files[kind];
    if (!f) continue;
    await putFile(cfg.storage, manifest.id, kind, f.meta.sha256, f.content);
    files[kind] = f.meta;
  }
  const incomplete = needsSetup(manifest, config);
  const record: InstallRecord = {
    id: manifest.id,
    manifest,
    icon: fetched.build.icon,
    buildHash: fetched.buildHash,
    source: { id: source.id, label: source.label, path: pluginPath, revision: fetched.revision },
    files,
    previousFiles: existing?.files,
    enabled: existing ? existing.enabled && !incomplete : !incomplete,
    config,
    paths,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };

  try {
    if (fetched.files.server) {
      const server = evaluateServer(manifest.id, fetched.files.server.content);
      if (!existing) await server.onInstall?.(pluginContext(cfg, record));
    }
  } catch (e) {
    console.error(`[nextpluggable] Plugin "${manifest.id}" failed to start:`, e);
    await pruneFiles(cfg.storage, manifest.id, existing ? [existing.files, existing.previousFiles ?? {}] : []);
    throw new HttpError(422, `${manifest.name} could not be ${existing ? 'updated' : 'installed'} because it failed to start. Nothing was changed.`);
  }

  await saveInstalls(cfg.storage, { ...installs, [manifest.id]: record });
  await pruneFiles(cfg.storage, manifest.id, [record.files, record.previousFiles ?? {}]);
  invalidateInstalledPlugins(cfg);
  return record;
}

export async function installPlugin(cfg: ResolvedConfig, input: { sourceId?: unknown; path?: unknown }): Promise<InstallRecord> {
  const source = (await getSources(cfg.storage)).find((s) => s.id === input.sourceId);
  if (!source) throw new HttpError(404, 'That source is no longer connected.');
  const pluginPath = typeof input.path === 'string' ? input.path : '';
  if (pluginPath.split('/').some((p) => p === '..')) throw new HttpError(400, 'Invalid plugin location.');
  return install(cfg, source, pluginPath, undefined);
}

export async function updatePlugin(cfg: ResolvedConfig, pluginId: string): Promise<InstallRecord> {
  const all = await getInstalls(cfg.storage);
  const existing = Object.hasOwn(all, pluginId) ? all[pluginId] : undefined;
  if (!existing) throw new HttpError(404, 'That plugin is not installed.');
  const source = (await getSources(cfg.storage)).find((s) => s.id === existing.source.id);
  if (!source) throw new HttpError(409, `${existing.manifest.name} came from a source that is no longer connected, so it cannot be updated. Connect ${existing.source.label} again first.`);
  const record = await install(cfg, source, existing.source.path, existing);
  await refreshSource(cfg, source).catch(() => {});
  return record;
}

// ---------------------------------------------------------------- change / remove

export interface PluginPatch {
  enabled?: unknown;
  config?: unknown;
  paths?: unknown;
}

export async function changePlugin(cfg: ResolvedConfig, pluginId: string, patch: PluginPatch): Promise<InstallRecord> {
  const installs = await getInstalls(cfg.storage);
  const current = Object.hasOwn(installs, pluginId) ? installs[pluginId] : undefined;
  if (!current) throw new HttpError(404, 'That plugin is not installed.');
  const next: InstallRecord = { ...current, config: { ...current.config }, paths: { ...current.paths } };
  const { manifest } = current;

  // Every problem is collected and reported together, so the owner fixes them in one go.
  const errors: Record<string, string> = {};

  if (patch.config !== undefined) {
    if (typeof patch.config !== 'object' || patch.config === null) throw new HttpError(400, 'Invalid settings.');
    const incoming = patch.config as Record<string, unknown>;
    const candidate: Record<string, unknown> = {};
    for (const f of manifest.settings ?? []) {
      if (Object.hasOwn(incoming, f.key)) candidate[f.key] = incoming[f.key];
      else if (f.type === 'secret') {
        // Secrets are write-only in the dashboard: leaving the field untouched keeps the stored value.
        const stored = current.config[f.key];
        if (isEncrypted(stored)) candidate[f.key] = decrypt(cfg.secret, stored) ?? undefined;
      } else candidate[f.key] = current.config[f.key];
    }
    const checked = validateSettings(manifest, candidate);
    Object.assign(errors, checked.errors);
    for (const f of manifest.settings ?? []) {
      const v = checked.values[f.key];
      if (f.type === 'secret' && typeof v === 'string') checked.values[f.key] = encrypt(cfg.secret, v);
    }
    next.config = checked.values;
  }

  if (patch.paths !== undefined) {
    if (typeof patch.paths !== 'object' || patch.paths === null) throw new HttpError(400, 'Invalid page addresses.');
    for (const [pageId, raw] of Object.entries(patch.paths as Record<string, unknown>)) {
      const page = manifest.pages?.find((p) => p.id === pageId);
      if (!page) continue;
      const field = `path:${pageId}`;
      let value = typeof raw === 'string' ? raw.trim() : '';
      if (value && !value.startsWith('/')) value = `/${value}`;
      value = value.replace(/\/+$/, '').toLowerCase();
      if (!value || value === page.path) {
        delete next.paths[pageId];
        continue;
      }
      if (value === effectivePaths(current)[pageId]) continue;
      if (page.configurablePath === false || !isStaticPath(page.path)) {
        errors[field] = 'The address of this page cannot be changed.';
        continue;
      }
      const problem = checkPagePath(value);
      if (problem || !isStaticPath(value)) {
        errors[field] = `The address ${problem ?? 'cannot contain ":" or "*"'}. Use something like /loan-calculator.`;
        continue;
      }
      next.paths[pageId] = value;
    }
    for (const page of manifest.pages ?? []) {
      const field = `path:${page.id}`;
      if (errors[field]) continue;
      const problem = pathProblem({ ...installs, [pluginId]: next }, pluginId, page.id, effectivePaths(next)[page.id]!, reservedPaths(cfg));
      if (problem) errors[field] = problem;
    }
  }

  if (Object.keys(errors).length) throw new HttpError(422, 'Some settings need your attention.', errors);

  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new HttpError(400, 'Invalid request.');
    next.enabled = patch.enabled;
  }
  if (next.enabled && needsSetup(manifest, next.config)) {
    if (patch.enabled === true) throw new HttpError(422, `${manifest.name} needs a few settings filled in before it can be turned on.`);
    next.enabled = false;
  }

  next.updatedAt = new Date().toISOString();
  await saveInstalls(cfg.storage, { ...installs, [pluginId]: next });
  invalidateInstalledPlugins(cfg);
  return next;
}

export async function uninstallPlugin(cfg: ResolvedConfig, pluginId: string, options: { deleteData?: boolean } = {}): Promise<void> {
  const installs = await getInstalls(cfg.storage);
  const current = Object.hasOwn(installs, pluginId) ? installs[pluginId] : undefined;
  if (!current) throw new HttpError(404, 'That plugin is not installed.');
  try {
    await (await loadServer(cfg, current))?.onUninstall?.(pluginContext(cfg, current));
  } catch (e) {
    console.error(`[nextpluggable] Plugin "${pluginId}" failed in its uninstall step (continuing):`, e);
  }
  const rest: Installs = { ...installs };
  delete rest[pluginId];
  await saveInstalls(cfg.storage, rest);
  invalidateInstalledPlugins(cfg);
  await pruneFiles(cfg.storage, pluginId, []);
  if (options.deleteData) await deletePluginData(cfg.storage, pluginId);
  const g = globals();
  for (const cache of [g.serverModules, g.ssrCode]) for (const k of cache.keys()) if (k.startsWith(`${pluginId}@`)) cache.delete(k);
}

