import { isStaticPath } from '@nextpluggable/plugin/manifest';
import type { ResolvedConfig } from '../config.js';
import { effectivePaths, findPage, normalizePathname } from './routes.js';
import { loadServer, pluginContext, runPageLoader } from './runtime.js';
import { getInstalledPlugins } from './state.js';
import type { InstallRecord } from './types.js';

export interface PluginSitemapEntry {
  url: string;
  lastModified?: Date;
}

/** A plugin may list this many addresses; a sitemap file holds 50,000 in all. */
const MAX_PER_PLUGIN = 10_000;

const toDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

async function entriesOf(cfg: ResolvedConfig, install: InstallRecord, add: (path: string, lastModified?: Date) => void): Promise<void> {
  const paths = effectivePaths(install);
  const updated = toDate(install.updatedAt);

  // Pages with a fixed address. The loader decides whether the page exists and may be indexed.
  for (const page of install.manifest.pages ?? []) {
    const address = paths[page.id]!;
    if (!isStaticPath(address)) continue;
    const result = await runPageLoader(cfg, install, page.id, { path: address, params: {} });
    if (result.notFound || result.redirect || result.metadata?.noindex) continue;
    const canonical = result.metadata?.canonical;
    // A page that names another address as the real one is not listed under its own.
    if (canonical && new URL(canonical, `${cfg.siteUrl}/`).pathname !== address) continue;
    add(address, toDate(result.metadata?.modifiedTime) ?? updated);
  }

  // Pages with parameters: only the plugin knows which addresses exist.
  const server = await loadServer(cfg, install);
  if (typeof server?.sitemap !== 'function') return;
  const listed = await server.sitemap(pluginContext(cfg, install));
  if (!Array.isArray(listed)) return;
  const own = { [install.id]: install };
  for (const entry of listed.slice(0, MAX_PER_PLUGIN)) {
    const raw = typeof entry === 'string' ? entry : entry?.path;
    if (typeof raw !== 'string' || !raw.startsWith('/')) continue;
    const address = normalizePathname(raw);
    // A plugin can only add addresses of its own pages.
    if (!findPage(own, address)) continue;
    add(address, typeof entry === 'string' ? undefined : toDate(entry.lastModified));
  }
}

/**
 * Every address that switched-on plugins serve and that search engines may index, for
 * the site's sitemap. Never throws: a plugin that fails while listing its pages keeps
 * what it had listed so far, and a storage outage yields an empty list rather than a
 * broken sitemap.
 */
export async function pluginSitemap(cfg: ResolvedConfig): Promise<PluginSitemapEntry[]> {
  const out = new Map<string, PluginSitemapEntry>();
  try {
    for (const install of Object.values(await getInstalledPlugins(cfg))) {
      if (!install.enabled) continue;
      try {
        await entriesOf(cfg, install, (address, lastModified) => {
          let url: string;
          try {
            url = new URL(address, `${cfg.siteUrl}/`).toString();
          } catch {
            return;
          }
          if (!out.has(url)) out.set(url, lastModified ? { url, lastModified } : { url });
        });
      } catch (e) {
        console.error(`[nextpluggable] Plugin "${install.id}" could not list all of its pages for the sitemap:`, e);
      }
    }
  } catch (e) {
    console.error('[nextpluggable] Plugin pages could not be listed for the sitemap:', e);
  }
  return [...out.values()];
}
