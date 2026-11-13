/**
 * Turns a plugin's source into the three artifacts a host installs:
 *
 *   dist/client.js   React components, as the body of a CommonJS module. `react`,
 *                    `react-dom` and `@nextpluggable/plugin` stay external and are
 *                    supplied by the host on both server (SSR) and browser.
 *   dist/server.js   Page loaders + API handlers, self-contained CommonJS for Node.
 *   dist/style.css   Any CSS imported by the client entry.
 *   dist/build.json  Manifest + file hashes — the only file a host reads to list a plugin.
 *
 * `dist/` is meant to be committed, the same way JavaScript GitHub Actions ship,
 * so that hosts can install straight from a repository at a pinned commit.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BuildOptions, Metafile } from 'esbuild';
import { type BuiltFile, type PluginBuild, type PluginManifest, ManifestError, validateManifest } from './manifest.js';

/** Modules the host provides to client bundles at runtime. */
export const SHARED_CLIENT_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@nextpluggable/plugin'] as const;

const ASSET_LOADERS: BuildOptions['loader'] = {
  '.svg': 'dataurl',
  '.png': 'dataurl',
  '.jpg': 'dataurl',
  '.jpeg': 'dataurl',
  '.gif': 'dataurl',
  '.webp': 'dataurl',
  '.woff2': 'dataurl',
};

export interface BuildPluginOptions {
  minify?: boolean;
  /** Called with human-readable progress lines. */
  log?: (line: string) => void;
  /** Called with advice that does not stop the build, such as a page with nothing to show in search results. */
  warn?: (line: string) => void;
}

/**
 * Things worth fixing for search engines that the manifest alone gives away. The
 * site fills gaps with sensible values, so these are advice, not errors.
 */
export function seoAdvice(manifest: PluginManifest): string[] {
  const advice: string[] = [];
  for (const page of manifest.pages ?? []) {
    if (!page.description?.trim())
      advice.push(`Page "${page.id}" has no "description". Search results will show the plugin's description instead; add one or two sentences written for visitors.`);
    else if (page.description.length > 200) advice.push(`Page "${page.id}" has a description of ${page.description.length} characters. Search engines cut it at about 160.`);
    if (page.title.length > 65) advice.push(`Page "${page.id}" has a title of ${page.title.length} characters. Search engines cut it at about 60.`);
  }
  return advice;
}

export class PluginBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginBuildError';
  }
}

function findEntry(dir: string, explicit: string | undefined, base: string): string | null {
  if (explicit) {
    const p = path.resolve(dir, explicit);
    if (!existsSync(p)) throw new PluginBuildError(`Entry file "${explicit}" does not exist.`);
    return p;
  }
  for (const ext of ['tsx', 'ts', 'jsx', 'js', 'mjs']) {
    const p = path.join(dir, 'src', `${base}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

function exportsOf(meta: Metafile): string[] {
  for (const [file, out] of Object.entries(meta.outputs)) if (file.endsWith('.js') && out.entryPoint) return out.exports;
  return [];
}

async function readManifest(dir: string): Promise<PluginManifest> {
  const file = path.join(dir, 'plugin.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new PluginBuildError(`No plugin.json found in ${dir}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PluginBuildError(`plugin.json is not valid JSON: ${(e as Error).message}`);
  }
  return validateManifest(parsed);
}

async function resolveIcon(dir: string, icon: string | undefined): Promise<string | undefined> {
  if (!icon) return undefined;
  const m = /\.(svg|png|webp|jpe?g)$/i.exec(icon);
  if (!m) return icon; // an emoji / short text
  const file = path.resolve(dir, icon);
  if (!file.startsWith(path.resolve(dir) + path.sep)) throw new PluginBuildError('"icon" must be a file inside the plugin directory.');
  const data = await readFile(file).catch(() => {
    throw new PluginBuildError(`Icon file "${icon}" does not exist.`);
  });
  if (data.byteLength > 32_000) throw new PluginBuildError(`Icon "${icon}" is larger than 32 KB.`);
  const ext = m[1]!.toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Evaluate the built server bundle to check that what it exports lines up with the manifest. */
function checkServer(code: string, manifest: PluginManifest): void {
  const mod = { exports: {} as Record<string, unknown> };
  const req = (name: string) => {
    const builtin = process.getBuiltinModule(name);
    if (!builtin) throw new Error(`Cannot require "${name}": server bundles may only use Node built-ins at runtime.`);
    return builtin;
  };
  try {
    new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
  } catch (e) {
    throw new PluginBuildError(`The server entry throws when loaded: ${(e as Error).message}`);
  }
  const server = (mod.exports.default ?? mod.exports) as { pages?: unknown; api?: unknown; sitemap?: unknown };
  if (!server || typeof server !== 'object') throw new PluginBuildError('The server entry must `export default definePluginServer({ ... })`.');
  const pageIds = new Set((manifest.pages ?? []).map((p) => p.id));
  if (server.pages !== undefined) {
    if (typeof server.pages !== 'object' || server.pages === null) throw new PluginBuildError('`pages` in the server entry must be an object.');
    for (const [id, fn] of Object.entries(server.pages)) {
      if (!pageIds.has(id)) throw new PluginBuildError(`The server entry has a loader for page "${id}", which plugin.json does not declare.`);
      if (typeof fn !== 'function') throw new PluginBuildError(`The loader for page "${id}" must be a function.`);
    }
  }
  if (server.sitemap !== undefined && typeof server.sitemap !== 'function') throw new PluginBuildError('`sitemap` in the server entry must be a function.');
  if (server.api !== undefined) {
    if (typeof server.api !== 'object' || server.api === null) throw new PluginBuildError('`api` in the server entry must be an object.');
    for (const [key, fn] of Object.entries(server.api)) {
      if (!/^(GET|POST|PUT|PATCH|DELETE) \/\S*$/.test(key))
        throw new PluginBuildError(`API route "${key}" must look like "GET /path" (methods: GET, POST, PUT, PATCH, DELETE).`);
      if (typeof fn !== 'function') throw new PluginBuildError(`API route "${key}" must be a function.`);
    }
  }
}

export async function buildPlugin(dir: string, options: BuildPluginOptions = {}): Promise<PluginBuild> {
  const log = options.log ?? (() => {});
  const warn = options.warn ?? (() => {});
  const { build } = await import('esbuild').catch(() => {
    throw new PluginBuildError('Building plugins needs esbuild. Install it next to @nextpluggable/plugin: npm install --save-dev esbuild');
  });
  dir = path.resolve(dir);
  const manifest = await readManifest(dir);
  const clientEntry = findEntry(dir, manifest.entry?.client, 'client');
  const serverEntry = findEntry(dir, manifest.entry?.server, 'server');

  const components = [
    ...(manifest.pages ?? []).map((p) => p.component),
    ...(manifest.slots ?? []).map((s) => s.component),
    ...(manifest.admin ?? []).map((a) => a.component),
  ];
  if (components.length && !clientEntry)
    throw new PluginBuildError('plugin.json declares pages or components, but there is no client entry (expected src/client.tsx).');
  if (!clientEntry && !serverEntry) throw new PluginBuildError('Nothing to build: add src/client.tsx and/or src/server.ts.');

  const outDir = path.join(dir, 'dist');
  const outputs: { name: 'client' | 'server' | 'style'; file: string; contents: Uint8Array | string }[] = [];

  if (clientEntry) {
    const shared: BuildOptions = {
      entryPoints: { client: clientEntry },
      absWorkingDir: dir,
      bundle: true,
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      external: [...SHARED_CLIENT_MODULES],
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: ASSET_LOADERS,
      legalComments: 'none',
      outdir: outDir,
      write: false,
      logLevel: 'silent',
    };
    // Pass 1 (ESM, discarded): learn the entry's export names.
    const analysis = await build({ ...shared, format: 'esm', metafile: true });
    const exported = new Set(exportsOf(analysis.metafile));
    const missing = components.filter((c) => !exported.has(c));
    if (missing.length)
      throw new PluginBuildError(
        `plugin.json refers to component${missing.length > 1 ? 's' : ''} ${missing.map((c) => `"${c}"`).join(', ')}, but the client entry does not export ${missing.length > 1 ? 'them' : 'it'}.`,
      );
    // Pass 2: the real artifact.
    const result = await build({ ...shared, format: 'cjs', minify: options.minify ?? true });
    for (const f of result.outputFiles ?? []) {
      if (f.path.endsWith('.js')) outputs.push({ name: 'client', file: 'dist/client.js', contents: f.contents });
      else if (f.path.endsWith('.css')) outputs.push({ name: 'style', file: 'dist/style.css', contents: f.contents });
    }
  }

  if (serverEntry) {
    const shared: BuildOptions = {
      entryPoints: { server: serverEntry },
      absWorkingDir: dir,
      bundle: true,
      platform: 'node',
      target: 'node20',
      outdir: outDir,
      write: false,
      legalComments: 'none',
      logLevel: 'silent',
    };
    const analysis = await build({ ...shared, format: 'esm', metafile: true });
    if (!exportsOf(analysis.metafile).includes('default'))
      throw new PluginBuildError('The server entry must `export default definePluginServer({ ... })`.');
    const result = await build({ ...shared, format: 'cjs', minifySyntax: true });
    const js = result.outputFiles?.find((f) => f.path.endsWith('.js'));
    if (!js) throw new PluginBuildError('The server entry produced no output.');
    checkServer(js.text, manifest);
    outputs.push({ name: 'server', file: 'dist/server.js', contents: js.contents });
  }

  const files: PluginBuild['files'] = {};
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const o of outputs) {
    await writeFile(path.join(dir, o.file), o.contents);
    const entry: BuiltFile = { path: o.file, sha256: sha256(o.contents), bytes: Buffer.byteLength(o.contents) };
    files[o.name] = entry;
    log(`  ${o.file}  ${(entry.bytes / 1024).toFixed(1)} kB`);
  }

  const pluginBuild: PluginBuild = { buildVersion: 1, manifest, icon: await resolveIcon(dir, manifest.icon), files };
  await writeFile(path.join(outDir, 'build.json'), JSON.stringify(pluginBuild, null, 2) + '\n');
  log(`  dist/build.json`);
  for (const line of seoAdvice(manifest)) warn(line);
  return pluginBuild;
}

/** Format any error from buildPlugin for a terminal. */
export function describeBuildError(err: unknown): string {
  if (err instanceof ManifestError || err instanceof PluginBuildError) return err.message;
  const e = err as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] };
  if (Array.isArray(e?.errors) && e.errors.length)
    return e.errors
      .map((x) => (x.location ? `${x.location.file}:${x.location.line}:${x.location.column}: ${x.text}` : x.text))
      .join('\n');
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
