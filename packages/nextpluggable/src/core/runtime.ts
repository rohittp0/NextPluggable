import { defaultConfig, isPublicSetting } from '@nextpluggable/plugin/manifest';
import type { AdminUser, ApiContext, PageContext, PageResult, PluginContext, PluginServer, PluginStorage } from '@nextpluggable/plugin/server';
import type { ResolvedConfig } from '../config.js';
import { decrypt, isEncrypted } from '../crypto.js';
import { jsonResponse, PluginGoneError } from '../errors.js';
import { globals } from '../globals.js';
import { decodeSegment } from '../storage/types.js';
import { effectivePaths, matchPattern, normalizePathname } from './routes.js';
import { dataKey, getFile } from './store.js';
import type { InstallRecord } from './types.js';

/** Identifies one exact build of a plugin's client bundle (used on both server and browser). */
export function clientModuleKey(install: InstallRecord): string | null {
  return install.files.client ? `${install.id}@${install.files.client.sha256.slice(0, 16)}` : null;
}

export function assetUrl(cfg: ResolvedConfig, pluginId: string, sha256: string, file: 'client.js' | 'style.css'): string {
  return `${cfg.apiPath}/assets/${pluginId}/${sha256.slice(0, 16)}/${file}`;
}

/** Setting values safe to send to browsers, with defaults filled in. */
export function publicConfig(install: InstallRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const defaults = defaultConfig(install.manifest);
  for (const field of install.manifest.settings ?? []) {
    if (!isPublicSetting(field)) continue;
    const v = install.config[field.key] ?? defaults[field.key];
    if (v !== undefined) out[field.key] = v;
  }
  return out;
}

/** Every setting value, secrets decrypted. Server-side only. */
export function serverConfig(cfg: ResolvedConfig, install: InstallRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaultConfig(install.manifest) };
  for (const field of install.manifest.settings ?? []) {
    const v = install.config[field.key];
    if (v === undefined) continue;
    if (isEncrypted(v)) {
      const plain = decrypt(cfg.secret, v);
      if (plain !== null) out[field.key] = plain;
    } else out[field.key] = v;
  }
  return out;
}

export function pluginStorage(cfg: ResolvedConfig, pluginId: string): PluginStorage {
  const prefix = `data/${pluginId}/`;
  return {
    async get<T>(key: string) {
      const raw = await cfg.storage.get(dataKey(pluginId, key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async set(key, value) {
      const raw = JSON.stringify(value);
      if (raw === undefined) throw new Error('Only JSON values can be stored.');
      if (raw.length > 1_000_000) throw new Error('A stored value may be at most 1 MB.');
      await cfg.storage.set(dataKey(pluginId, key), raw);
    },
    async delete(key) {
      await cfg.storage.delete(dataKey(pluginId, key));
    },
    async list(keyPrefix = '') {
      const keys = await cfg.storage.list(prefix);
      return keys
        .map((k) => decodeSegment(k.slice(prefix.length)))
        .filter((k) => k.startsWith(keyPrefix))
        .sort();
    },
  };
}

export function pluginContext(cfg: ResolvedConfig, install: InstallRecord): PluginContext {
  return {
    pluginId: install.id,
    config: serverConfig(cfg, install),
    storage: pluginStorage(cfg, install.id),
    site: { url: cfg.siteUrl },
    paths: effectivePaths(install),
    log: (...args) => console.log(`[plugin:${install.id}]`, ...args),
  };
}

/** Evaluate a plugin's server bundle (CommonJS, self-contained) and return what it exports. */
export function evaluateServer(pluginId: string, code: string): PluginServer {
  const getBuiltin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (!getBuiltin) throw new Error('Plugins with server code need Node.js 20.16 or newer.');
  const mod = { exports: {} as Record<string, unknown> };
  const req = (name: string) => {
    const builtin = getBuiltin(name);
    if (!builtin) throw new Error(`Plugin "${pluginId}" tried to load "${name}", which is not available. Server bundles may only use Node built-ins at runtime.`);
    return builtin;
  };
  // Plugins are trusted code chosen by the site owner; this is deliberate evaluation, not a sandbox.
  new Function('require', 'module', 'exports', `${code}\n//# sourceURL=nextpluggable-plugin:///${pluginId}/server.js`)(req, mod, mod.exports);
  const server = (mod.exports.default ?? mod.exports) as PluginServer;
  if (!server || typeof server !== 'object') throw new Error(`Plugin "${pluginId}" has an invalid server entry.`);
  return server;
}

/** The plugin's server module, or null when it has none. Cached by content hash. */
export async function loadServer(cfg: ResolvedConfig, install: InstallRecord): Promise<PluginServer | null> {
  const file = install.files.server;
  if (!file) return null;
  const cache = globals().serverModules;
  const key = `${install.id}@${file.sha256}`;
  const hit = cache.get(key) as PluginServer | undefined;
  if (hit) return hit;
  const code = await getFile(cfg.storage, install.id, 'server', file.sha256);
  if (code === null) throw new PluginGoneError(install.id);
  const server = evaluateServer(install.id, code);
  for (const k of cache.keys()) if (k.startsWith(`${install.id}@`)) cache.delete(k);
  cache.set(key, server);
  return server;
}

export interface ClientAssets {
  moduleKey: string;
  scriptSrc: string;
  styleHref?: string;
  /** The stylesheet itself, when it is small enough to be written into the page. */
  styleCss?: string;
}

/** Larger stylesheets are linked: inlining them would bloat every page that shows the plugin. */
const INLINE_STYLE_MAX_BYTES = 32_000;

/**
 * Make a plugin's client bundle available to the SSR pass of this process and
 * return the URLs the browser loads it from.
 */
export async function prepareClient(cfg: ResolvedConfig, install: InstallRecord): Promise<ClientAssets | null> {
  const client = install.files.client;
  const moduleKey = clientModuleKey(install);
  if (!client || !moduleKey) return null;
  const ssr = globals().ssrCode;
  if (!ssr.has(moduleKey)) {
    const code = await getFile(cfg.storage, install.id, 'client', client.sha256);
    if (code === null) throw new PluginGoneError(install.id);
    for (const k of ssr.keys()) if (k.startsWith(`${install.id}@`)) ssr.delete(k);
    ssr.set(moduleKey, code);
  }
  const style = install.files.style;
  const styleCss = style && cfg.inlineStyles && style.bytes <= INLINE_STYLE_MAX_BYTES ? ((await getFile(cfg.storage, install.id, 'style', style.sha256)) ?? undefined) : undefined;
  return {
    moduleKey,
    scriptSrc: assetUrl(cfg, install.id, client.sha256, 'client.js'),
    styleHref: style ? assetUrl(cfg, install.id, style.sha256, 'style.css') : undefined,
    styleCss,
  };
}

export async function runPageLoader(
  cfg: ResolvedConfig,
  install: InstallRecord,
  pageId: string,
  input: { path: string; params: Record<string, string> },
): Promise<PageResult> {
  const server = await loadServer(cfg, install);
  const loader = server?.pages?.[pageId];
  if (!loader) return {};
  const ctx: PageContext = { ...pluginContext(cfg, install), ...input };
  const result = await loader(ctx);
  return result && typeof result === 'object' ? result : {};
}

/** Dispatch a request to a plugin's API handlers (`"METHOD /path"` keys). */
export async function handlePluginApi(
  cfg: ResolvedConfig,
  install: InstallRecord,
  request: Request,
  subpath: string,
  admin: AdminUser | null,
): Promise<Response> {
  let server: PluginServer | null;
  try {
    server = await loadServer(cfg, install);
  } catch (e) {
    console.error(`[nextpluggable] Could not load plugin "${install.id}":`, e);
    return jsonResponse({ error: 'This plugin could not be loaded.' }, 500);
  }
  const path = normalizePathname(subpath);
  const method = request.method.toUpperCase() === 'HEAD' ? 'GET' : request.method.toUpperCase();
  let methodMismatch = false;
  for (const [key, handler] of Object.entries(server?.api ?? {})) {
    const space = key.indexOf(' ');
    const params = matchPattern(key.slice(space + 1), path);
    if (!params) continue;
    if (key.slice(0, space) !== method) {
      methodMismatch = true;
      continue;
    }
    const ctx: ApiContext = { ...pluginContext(cfg, install), request, path, params, admin };
    try {
      const res = await handler(ctx);
      if (!res || typeof (res as Response).status !== 'number' || typeof (res as Response).headers?.get !== 'function')
        throw new Error(`Handler "${key}" did not return a Response.`);
      return res;
    } catch (e) {
      console.error(`[nextpluggable] Plugin "${install.id}" failed handling ${key}:`, e);
      return jsonResponse({ error: 'The plugin ran into a problem handling this request.' }, 500);
    }
  }
  return methodMismatch ? jsonResponse({ error: 'Method not allowed.' }, 405) : jsonResponse({ error: 'Not found.' }, 404);
}
