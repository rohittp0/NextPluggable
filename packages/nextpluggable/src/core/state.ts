import type { ResolvedConfig } from '../config.js';
import { globals } from '../globals.js';
import { getInstalls } from './store.js';
import type { Installs } from './types.js';

/**
 * Installed plugins, read through a short-lived per-process cache so that a
 * page render costs at most one storage read every `cacheTtlMs`.
 *
 * The cache lives on `globalThis` and is keyed by the instance's API path, not
 * by any object identity: Next.js loads the site's setup module once per module
 * graph (pages, route handlers), and a change made through the dashboard's
 * route handler must be visible to the very next page render.
 */
export async function getInstalledPlugins(cfg: ResolvedConfig): Promise<Installs> {
  const cache = globals().state;
  const hit = cache.get(cfg.apiPath);
  if (hit && Date.now() - hit.at < cfg.cacheTtlMs) return hit.value as Installs;
  const value = await getInstalls(cfg.storage);
  cache.set(cfg.apiPath, { at: Date.now(), value });
  return value;
}

export function invalidateInstalledPlugins(cfg: ResolvedConfig): void {
  globals().state.delete(cfg.apiPath);
}
