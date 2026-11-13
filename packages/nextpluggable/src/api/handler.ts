import type { AdminUser } from '../auth/types.js';
import type { ResolvedConfig } from '../config.js';
import { addSource, changePlugin, installPlugin, refreshAllSources, removeSource, uninstallPlugin, updatePlugin } from '../core/installer.js';
import { handlePluginApi } from '../core/runtime.js';
import { getInstalledPlugins } from '../core/state.js';
import { getFile, getInstalls } from '../core/store.js';
import type { FileKind } from '../core/types.js';
import { HttpError, jsonResponse } from '../errors.js';
import { buildDashboardState, type SessionView } from '../views.js';

export interface HandlerHooks {
  /** Called after anything that changes what the public site renders. */
  onSiteChange?: () => void | Promise<void>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Header every dashboard/plugin write must carry. Browsers will not send it cross-site without a CORS preflight, which we never grant. */
export const CSRF_HEADER = 'x-nextpluggable';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser clients; the custom header check still applies
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Look a plugin up by an id that came from a URL, ignoring inherited object properties. */
const own = <T,>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

const csrfOk = (request: Request) => request.headers.get(CSRF_HEADER) === '1' && sameOrigin(request);

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 200_000) throw new HttpError(413, 'That request is too large.');
  if (!text) return {};
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}

export async function sessionView(cfg: ResolvedConfig, request: Request): Promise<SessionView> {
  let user: AdminUser | null = null;
  try {
    user = await cfg.auth.getUser(request, { secret: cfg.secret });
  } catch (e) {
    console.error('[nextpluggable] auth.getUser failed:', e);
  }
  return { user, mode: cfg.auth.kind, configured: cfg.auth.configured, loginUrl: cfg.auth.loginUrl };
}

const ASSET_TYPES: Record<string, { kind: FileKind; type: string }> = {
  'client.js': { kind: 'client', type: 'text/javascript; charset=utf-8' },
  'style.css': { kind: 'style', type: 'text/css; charset=utf-8' },
};

async function serveAsset(cfg: ResolvedConfig, pluginId: string, hash: string, name: string): Promise<Response> {
  const asset = ASSET_TYPES[name];
  if (!asset || !/^[0-9a-f]{16}$/.test(hash)) return jsonResponse({ error: 'Not found.' }, 404);
  const install = own(await getInstalledPlugins(cfg), pluginId) ?? own(await getInstalls(cfg.storage), pluginId);
  // The previous version's files stay available so pages cached before an update still load.
  const file = [install?.files[asset.kind], install?.previousFiles?.[asset.kind]].find((f) => f?.sha256.startsWith(hash));
  const content = file ? await getFile(cfg.storage, pluginId, asset.kind, file.sha256) : null;
  if (content === null) return jsonResponse({ error: 'Not found.' }, 404);
  const body =
    asset.kind === 'client'
      ? // One artifact, two consumers: the server evaluates the module body directly; browsers get it
        // wrapped in a registration call, so no eval (and no `unsafe-eval` CSP) is needed client-side.
        `(self.__NP_Q__=self.__NP_Q__||[]).push([${JSON.stringify(`${pluginId}@${hash}`)},function(require,module,exports){${content}\n}]);`
      : content;
  return new Response(body, {
    headers: {
      'content-type': asset.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function createHandler(getConfig: () => ResolvedConfig, hooks: HandlerHooks = {}) {
  async function route(request: Request): Promise<Response> {
    const cfg = getConfig();
    const pathname = new URL(request.url).pathname;
    const at = pathname.indexOf(cfg.apiPath);
    const sub = at === -1 ? pathname : pathname.slice(at + cfg.apiPath.length);
    const seg = sub.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    const method = request.method.toUpperCase();
    const env = { secret: cfg.secret };

    // ---- public: plugin assets
    if (seg[0] === 'assets' && seg.length === 4 && (method === 'GET' || method === 'HEAD')) return serveAsset(cfg, seg[1]!, seg[2]!, seg[3]!);

    // ---- public: plugin APIs
    if (seg[0] === 'p' && seg[1]) {
      const install = own(await getInstalledPlugins(cfg), seg[1]);
      if (!install || !install.enabled) return jsonResponse({ error: 'Not found.' }, 404);
      // A plugin only sees the dashboard user when the request provably came from this site's own pages.
      const admin = !MUTATING.has(method) || csrfOk(request) ? await cfg.auth.getUser(request, env).catch(() => null) : null;
      const res = await handlePluginApi(cfg, install, request, `/${seg.slice(2).join('/')}`, admin);
      if (MUTATING.has(method) && admin) await hooks.onSiteChange?.();
      return res;
    }

    // ---- session
    if (seg[0] === 'session' && method === 'GET') return jsonResponse(await sessionView(cfg, request));
    if (MUTATING.has(method) && !csrfOk(request)) throw new HttpError(403, 'This request was blocked for security reasons. Reload the page and try again.');
    if (seg[0] === 'login' && method === 'POST') {
      if (!cfg.auth.login) throw new HttpError(404, 'This site signs in a different way.');
      return cfg.auth.login(request, env);
    }
    if (seg[0] === 'logout' && method === 'POST') return cfg.auth.logout ? cfg.auth.logout(request, env) : jsonResponse({ ok: true });

    // ---- dashboard (signed-in only)
    if (seg[0] !== 'admin') throw new HttpError(404, 'Not found.');
    const user = await cfg.auth.getUser(request, env);
    if (!user) throw new HttpError(401, 'Please sign in again.');

    const state = async (extra?: Record<string, unknown>) => jsonResponse({ ...(await buildDashboardState(cfg)), ...extra });
    const changed = async (extra?: Record<string, unknown>) => {
      await hooks.onSiteChange?.();
      return state(extra);
    };

    if (seg[1] === 'state' && method === 'GET') return state();

    if (seg[1] === 'refresh' && method === 'POST') return state({ failures: await refreshAllSources(cfg) });

    if (seg[1] === 'sources') {
      if (method === 'POST' && seg.length === 2) {
        const source = await addSource(cfg, await readBody(request));
        return state({ added: source.id });
      }
      if (method === 'DELETE' && seg[2]) {
        await removeSource(cfg, seg[2]);
        return state();
      }
    }

    if (seg[1] === 'install' && method === 'POST') {
      const record = await installPlugin(cfg, await readBody(request));
      return changed({ installed: record.id });
    }

    if (seg[1] === 'plugins' && seg[2]) {
      const id = seg[2];
      if (seg[3] === 'update' && method === 'POST') {
        await updatePlugin(cfg, id);
        return changed();
      }
      if (seg.length === 3 && method === 'PATCH') {
        await changePlugin(cfg, id, await readBody(request));
        return changed();
      }
      if (seg.length === 3 && method === 'DELETE') {
        const body = await readBody(request);
        await uninstallPlugin(cfg, id, { deleteData: body.deleteData === true });
        return changed();
      }
    }

    throw new HttpError(404, 'Not found.');
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      return await route(request);
    } catch (e) {
      if (e instanceof HttpError) return jsonResponse({ error: e.message, ...(e.fields ? { fields: e.fields } : {}) }, e.status);
      console.error('[nextpluggable] Unexpected error:', e);
      const message = e instanceof Error && e.message.startsWith('[nextpluggable]') ? e.message.replace('[nextpluggable] ', '') : 'Something went wrong on the server. Please try again.';
      return jsonResponse({ error: message }, 500);
    }
  };
}
