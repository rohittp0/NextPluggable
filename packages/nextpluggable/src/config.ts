import { passwordAuth } from './auth/password.js';
import type { AuthAdapter } from './auth/types.js';
import { warnOnce } from './globals.js';
import { fileStorage } from './storage/file.js';
import type { StorageAdapter } from './storage/types.js';

export interface NextPluggableConfig {
  /** Who may use the dashboard. Default: `passwordAuth()` reading `NEXTPLUGGABLE_PASSWORD`. */
  auth?: AuthAdapter;
  /** Where data lives. Default: `fileStorage()` (a `.nextpluggable` folder). */
  storage?: StorageAdapter;
  /** Signs sessions and encrypts stored secrets. Default: `NEXTPLUGGABLE_SECRET`. Required in production. */
  secret?: string;
  /** URL path of the dashboard. Must match where you put the dashboard page. Default `/admin/plugins`. */
  dashboardPath?: string;
  /** URL path of the API route. Must match where you put the route handler. Default `/api/nextpluggable`. */
  apiPath?: string;
  /** Public origin of the site, e.g. `https://example.com`. Default: `NEXT_PUBLIC_SITE_URL`, then the host's own URL. */
  siteUrl?: string;
  /** Shown in the dashboard header. */
  siteName?: string;
  github?: {
    /** API base, for GitHub Enterprise. Default `https://api.github.com`. */
    apiUrl?: string;
    /** A token used for every GitHub source that has none of its own. Default: `NEXTPLUGGABLE_GITHUB_TOKEN`. */
    token?: string;
  };
  /** Allow plugin sources that are folders on the server. Default: only outside production, or when `NEXTPLUGGABLE_ALLOW_LOCAL_SOURCES=1`. */
  allowLocalSources?: boolean;
  /** How long the list of installed plugins is cached in memory per server instance. Default 5000 (0 in development). */
  cacheTtlMs?: number;
  /**
   * Write small plugin stylesheets into the page instead of linking to them, so a plugin
   * never adds a request the browser must wait for. Default true. Set false on sites
   * whose Content Security Policy forbids inline styles.
   */
  inlineStyles?: boolean;
}

export interface ResolvedConfig {
  auth: AuthAdapter;
  storage: StorageAdapter;
  secret: string;
  dashboardPath: string;
  apiPath: string;
  siteUrl: string;
  siteName: string;
  /** The site name only when the developer set one: used where a placeholder would be wrong (sharing previews, structured data). */
  publicSiteName: string | undefined;
  inlineStyles: boolean;
  githubApiUrl: string;
  githubToken: string | undefined;
  allowLocalSources: boolean;
  cacheTtlMs: number;
}

function cleanPath(value: string, name: string): string {
  const p = `/${value}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(p)) throw new Error(`[nextpluggable] "${name}" must be a URL path like "/admin/plugins" (got ${JSON.stringify(value)}).`);
  return p;
}

function defaultSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Settings are resolved lazily (on first use, not at import) so that `next build`
 * succeeds in environments where runtime secrets are not present.
 */
export function resolveConfig(config: NextPluggableConfig): () => ResolvedConfig {
  let resolved: ResolvedConfig | undefined;
  return () => {
    if (resolved) return resolved;
    const production = process.env.NODE_ENV === 'production';
    let secret = config.secret ?? process.env.NEXTPLUGGABLE_SECRET;
    if (!secret) {
      if (production)
        throw new Error(
          '[nextpluggable] NEXTPLUGGABLE_SECRET is not set. Add a long random value to your environment (for example the output of `openssl rand -base64 32`).',
        );
      warnOnce('dev-secret', 'NEXTPLUGGABLE_SECRET is not set; using an insecure development secret.');
      secret = 'nextpluggable-insecure-development-secret';
    } else if (secret.length < 16) {
      throw new Error('[nextpluggable] NEXTPLUGGABLE_SECRET is too short. Use at least 16 characters.');
    }
    resolved = {
      auth: config.auth ?? passwordAuth(),
      storage: config.storage ?? fileStorage(),
      secret,
      dashboardPath: cleanPath(config.dashboardPath ?? '/admin/plugins', 'dashboardPath'),
      apiPath: cleanPath(config.apiPath ?? '/api/nextpluggable', 'apiPath'),
      siteUrl: (config.siteUrl ?? defaultSiteUrl()).replace(/\/+$/, ''),
      siteName: config.siteName ?? 'Your site',
      publicSiteName: config.siteName?.trim() || undefined,
      inlineStyles: config.inlineStyles ?? true,
      githubApiUrl: (config.github?.apiUrl ?? process.env.NEXTPLUGGABLE_GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
      githubToken: config.github?.token ?? process.env.NEXTPLUGGABLE_GITHUB_TOKEN ?? undefined,
      allowLocalSources: config.allowLocalSources ?? (!production || process.env.NEXTPLUGGABLE_ALLOW_LOCAL_SOURCES === '1'),
      cacheTtlMs: config.cacheTtlMs ?? (production ? 5000 : 0),
    };
    return resolved;
  };
}
