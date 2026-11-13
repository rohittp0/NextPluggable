/**
 * Server-side API for plugin authors. Everything here is built on web
 * standards (Request/Response) so the same plugin can run on any host adapter.
 */

/** A small key-value store private to the plugin. Values are JSON. */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys that start with `prefix` (all keys when omitted), sorted. */
  list(prefix?: string): Promise<string[]>;
}

export interface AdminUser {
  id: string;
  name?: string;
}

export interface PluginContext<C = Record<string, unknown>> {
  pluginId: string;
  /** All settings, including server-only values and decrypted secrets. */
  config: C;
  storage: PluginStorage;
  site: {
    /** Origin of the site, e.g. `https://example.com`. */
    url: string;
  };
  /** Addresses of this plugin's pages keyed by page id. */
  paths: Record<string, string>;
  log(...args: unknown[]): void;
}

export interface PageContext<C = Record<string, unknown>> extends PluginContext<C> {
  path: string;
  params: Record<string, string>;
  /** Only populated when the page sets `"searchParams": true` in the manifest. */
  searchParams: Record<string, string>;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  /** Absolute or site-relative canonical URL. Defaults to the page's own address. */
  canonical?: string;
  image?: string;
  noindex?: boolean;
}

export interface PageResult<P = Record<string, unknown>> {
  /** Passed to the page component as `data`. Must be JSON-serialisable. */
  data?: P;
  metadata?: PageMetadata;
  /** schema.org structured data, rendered as JSON-LD. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Respond with the site's 404 page. */
  notFound?: boolean;
  /** Redirect to another address. */
  redirect?: string;
}

export interface ApiContext<C = Record<string, unknown>> extends PluginContext<C> {
  request: Request;
  /** Path below the plugin's API base, e.g. `/items/42`. */
  path: string;
  params: Record<string, string>;
  /** The signed-in dashboard user, or null for public visitors. */
  admin: AdminUser | null;
}

export type PageLoader<C = Record<string, unknown>> = (ctx: PageContext<C>) => PageResult | Promise<PageResult>;
export type ApiHandler<C = Record<string, unknown>> = (ctx: ApiContext<C>) => Response | Promise<Response>;

export interface PluginServer<C = Record<string, unknown>> {
  /** Server loaders keyed by page id: fetch data and SEO metadata before the page renders. */
  pages?: Record<string, PageLoader<C>>;
  /** HTTP endpoints keyed by `"METHOD /path"`, e.g. `"POST /messages"` or `"GET /items/:id"`. */
  api?: Record<string, ApiHandler<C>>;
  onInstall?(ctx: PluginContext<C>): void | Promise<void>;
  onUninstall?(ctx: PluginContext<C>): void | Promise<void>;
}

/** Identity helper that gives the server entry full type checking. */
export function definePluginServer<C = Record<string, unknown>>(server: PluginServer<C>): PluginServer<C> {
  return server;
}

/** Restrict an endpoint to the signed-in dashboard user. */
export function adminOnly<C = Record<string, unknown>>(handler: ApiHandler<C>): ApiHandler<C> {
  return (ctx) => (ctx.admin ? handler(ctx) : json({ error: 'Sign in to the dashboard to do this.' }, 401));
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Read a JSON request body, returning null when it is missing, malformed or larger than `maxBytes`. */
export async function readJson<T = unknown>(request: Request, maxBytes = 100_000): Promise<T | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
