import { isStaticPath } from '@nextpluggable/plugin/manifest';
import type { PluginPage } from '@nextpluggable/plugin/manifest';
import type { InstallRecord, Installs } from './types.js';

export function normalizePathname(pathname: string): string {
  const p = `/${pathname}`.replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Match a pathname against a pattern such as `/shop/:slug` or `/docs/*`. Returns params, or null. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern === '/' ? [] : pattern.slice(1).split('/');
  const got = pathname === '/' ? [] : pathname.slice(1).split('/');
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    if (w === '*') {
      params['*'] = got.slice(i).map(safeDecode).join('/');
      return params;
    }
    const g = got[i];
    if (g === undefined || g === '') return null;
    if (w.startsWith(':')) params[w.slice(1)] = safeDecode(g);
    else if (w !== g && w !== safeDecode(g)) return null;
  }
  return got.length === want.length ? params : null;
}

/** Higher wins: fully static paths, then more literal segments, wildcards last. */
function specificity(pattern: string): number {
  const segs = pattern.slice(1).split('/');
  let score = isStaticPath(pattern) ? 1_000_000 : 0;
  for (const s of segs) score += s === '*' ? -1000 : s.startsWith(':') ? 1 : 100;
  return score;
}

/** The address each page of a plugin is served at (owner's choice, else the plugin's default). */
export function effectivePaths(install: InstallRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of install.manifest.pages ?? []) out[page.id] = install.paths[page.id] ?? page.path;
  return out;
}

export interface PageMatch {
  install: InstallRecord;
  page: PluginPage;
  /** The pattern that matched. */
  pattern: string;
  params: Record<string, string>;
}

export function findPage(installs: Installs, pathname: string): PageMatch | null {
  const path = normalizePathname(pathname);
  let best: (PageMatch & { score: number }) | null = null;
  for (const install of Object.values(installs)) {
    if (!install.enabled) continue;
    const paths = effectivePaths(install);
    for (const page of install.manifest.pages ?? []) {
      const pattern = paths[page.id]!;
      const params = matchPattern(pattern, path);
      if (!params) continue;
      const score = specificity(pattern);
      if (!best || score > best.score) best = { install, page, pattern, params, score };
    }
  }
  return best;
}

/** Two patterns collide when they would match exactly the same addresses. */
const shape = (pattern: string) =>
  pattern
    .split('/')
    .map((s) => (s.startsWith(':') ? ':' : s))
    .join('/');

/**
 * Check a page address before it is saved. Returns a sentence for the site
 * owner when the address cannot be used, or null when it is fine.
 */
export function pathProblem(
  installs: Installs,
  pluginId: string,
  pageId: string,
  pattern: string,
  reserved: string[],
): string | null {
  for (const prefix of reserved) {
    if (pattern === prefix || pattern.startsWith(`${prefix}/`)) return `The address ${pattern} is reserved by the site.`;
  }
  for (const other of Object.values(installs)) {
    const paths = effectivePaths(other);
    for (const page of other.manifest.pages ?? []) {
      if (other.id === pluginId && page.id === pageId) continue;
      if (shape(paths[page.id]!) === shape(pattern))
        return other.id === pluginId
          ? `The address ${pattern} is already used by another page of this plugin.`
          : `The address ${pattern} is already used by the plugin "${other.manifest.name}".`;
    }
  }
  return null;
}
