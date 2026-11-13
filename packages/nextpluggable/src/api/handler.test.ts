/**
 * The dashboard API and installer, driven through real HTTP `Request`s against
 * in-memory storage and plugins built on the fly into a temporary folder source.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPlugin } from '@nextpluggable/plugin/build';
import { passwordAuth } from '../auth/password.js';
import { resolveConfig, type NextPluggableConfig } from '../config.js';
import { globals } from '../globals.js';
import { memoryStorage } from '../storage/memory.js';
import type { StorageAdapter } from '../storage/types.js';
import type { DashboardState } from '../views.js';
import { createHandler } from './handler.js';

const ORIGIN = 'https://site.test';
const API = `${ORIGIN}/api/nextpluggable`;
const PASSWORD = 'open sesame';

let sourceDir: string;
beforeAll(async () => {
  sourceDir = await mkdtemp(path.join(os.tmpdir(), 'np-source-'));
});
afterAll(async () => rm(sourceDir, { recursive: true, force: true }));

interface PluginSpec {
  id: string;
  version?: string;
  manifest?: Record<string, unknown>;
  client?: string;
  server?: string;
}

/** Write and build a plugin into the folder source; returns its directory name. */
async function writePlugin(spec: PluginSpec): Promise<string> {
  const dir = path.join(sourceDir, spec.id);
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'plugin.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: spec.id,
      name: `Plugin ${spec.id}`,
      version: spec.version ?? '1.0.0',
      pages: [{ id: 'main', path: `/${spec.id}`, component: 'Main', title: 'Main page' }],
      ...spec.manifest,
    }),
  );
  await writeFile(path.join(dir, 'src/client.js'), spec.client ?? 'export function Main() { return null; }');
  if (spec.server) await writeFile(path.join(dir, 'src/server.js'), spec.server);
  else await rm(path.join(dir, 'src/server.js'), { force: true });
  await buildPlugin(dir);
  return spec.id;
}

async function writeIndex(dirs: string[]) {
  await writeFile(path.join(sourceDir, 'nextpluggable.json'), JSON.stringify({ name: 'Test source', plugins: dirs }));
}

interface Site {
  storage: StorageAdapter;
  handle: (request: Request) => Promise<Response>;
  changes: number;
  cookie: string;
  call: (method: string, path: string, body?: unknown, options?: { cookie?: string | null; csrf?: boolean; headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;
  /** Connect the folder source and return its id. */
  connect: () => Promise<string>;
}

async function site(overrides: NextPluggableConfig = {}): Promise<Site> {
  const storage = memoryStorage();
  const self = { storage, changes: 0, cookie: '' } as Site;
  self.handle = createHandler(
    resolveConfig({
      storage,
      secret: 'unit-test-secret-0123456789',
      auth: passwordAuth({ password: PASSWORD }),
      siteUrl: ORIGIN,
      allowLocalSources: true,
      cacheTtlMs: 0,
      ...overrides,
    }),
    { onSiteChange: () => void self.changes++ },
  );
  self.call = async (method, p, body, options = {}) => {
    const headers: Record<string, string> = { host: 'site.test', ...options.headers };
    if (options.csrf !== false) headers['x-nextpluggable'] = '1';
    const cookie = options.cookie === undefined ? self.cookie : options.cookie;
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await self.handle(new Request(`${API}${p}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }));
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const login = await self.call('POST', '/login', { password: PASSWORD }, { cookie: null });
  self.cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  self.connect = async () => {
    const res = await self.call('POST', '/admin/sources', { url: sourceDir });
    expect(res.status).toBe(200);
    return (res.body as DashboardState).sources.at(-1)!.id;
  };
  return self;
}

const stored = async (s: Site, key: string) => JSON.parse((await s.storage.get(key)) ?? 'null');

beforeEach(async () => {
  const g = globals();
  g.loginAttempts.clear();
  g.state.clear();
  g.serverModules.clear();
  g.ssrCode.clear();
  g.files.clear();
  await writePlugin({ id: 'alpha' });
  await writeIndex(['alpha']);
});

describe('access control', () => {
  it('requires a sign-in for every dashboard route', async () => {
    const s = await site();
    for (const [method, p] of [['GET', '/admin/state'], ['POST', '/admin/refresh'], ['POST', '/admin/sources'], ['POST', '/admin/install'], ['PATCH', '/admin/plugins/alpha'], ['DELETE', '/admin/plugins/alpha'], ['GET', '/admin/anything']] as const) {
      const res = await s.call(method, p, method === 'GET' ? undefined : {}, { cookie: null });
      expect([method, p, res.status]).toEqual([method, p, 401]);
    }
    expect((await s.call('GET', '/admin/state', undefined, { cookie: 'np_session=forged.value' })).status).toBe(401);
  });

  it('blocks writes that could have been forged by another website', async () => {
    const s = await site();
    expect((await s.call('POST', '/admin/refresh', {}, { csrf: false })).status).toBe(403);
    expect((await s.call('POST', '/login', { password: PASSWORD }, { csrf: false, cookie: null })).status).toBe(403);
    expect((await s.call('POST', '/admin/refresh', {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await s.call('POST', '/admin/refresh', {}, { headers: { origin: ORIGIN } })).status).toBe(200);
    // Behind a proxy the public host arrives in x-forwarded-host.
    expect((await s.call('POST', '/admin/refresh', {}, { headers: { host: 'internal:3000', 'x-forwarded-host': 'site.test', origin: ORIGIN } })).status).toBe(200);
  });

  it('reports the session and signs out', async () => {
    const s = await site();
    expect((await s.call('GET', '/session')).body).toEqual({ user: { id: 'admin', name: 'Site owner' }, mode: 'password', configured: true });
    expect((await s.call('GET', '/session', undefined, { cookie: null })).body.user).toBeNull();
    expect((await s.call('POST', '/logout', {})).headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('answers unknown routes and oversized or malformed bodies cleanly', async () => {
    const s = await site();
    expect((await s.call('GET', '/nope')).status).toBe(404);
    expect((await s.call('POST', '/admin/install', '{not json')).status).toBe(400);
    expect((await s.call('POST', '/admin/install', JSON.stringify({ pad: 'x'.repeat(300_000) }))).status).toBe(413);
  });
});

describe('sources', () => {
  it('connects a folder source, lists its plugins, and refuses duplicates', async () => {
    const s = await site();
    await s.connect();
    const state = (await s.call('GET', '/admin/state')).body as DashboardState;
    expect(state.sources).toMatchObject([{ type: 'local', pluginCount: 1, name: 'Test source', problems: [] }]);
    expect(state.catalog).toMatchObject([{ id: 'alpha', name: 'Plugin alpha', installed: false, pages: [{ title: 'Main page', path: '/alpha' }] }]);
    expect((await s.call('POST', '/admin/sources', { url: sourceDir })).status).toBe(409);
  });

  it('keeps folder sources off unless the site allows them', async () => {
    const s = await site({ allowLocalSources: false });
    const res = await s.call('POST', '/admin/sources', { url: sourceDir });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('does not look like a GitHub repository address');
    expect((await s.call('POST', '/admin/sources', {})).body.error).toContain('Paste the address');
  });

  it('surfaces plugins that are listed but broken, without hiding the good ones', async () => {
    await mkdir(path.join(sourceDir, 'unbuilt'), { recursive: true });
    await mkdir(path.join(sourceDir, 'corrupt/dist'), { recursive: true });
    await writeFile(path.join(sourceDir, 'corrupt/dist/build.json'), '{"buildVersion":1,"manifest":{"id":"NOPE"}}');
    await writeIndex(['alpha', 'unbuilt', 'corrupt']);
    const s = await site();
    await s.connect();
    const [source] = ((await s.call('GET', '/admin/state')).body as DashboardState).sources;
    expect(source!.pluginCount).toBe(1);
    expect(source!.problems.map((p) => p.path)).toEqual(['unbuilt', 'corrupt']);
    expect(source!.problems[0]!.message).toContain('has not been built yet');
  });

  it('refuses a folder that holds no plugins, and leaves nothing behind', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'np-empty-'));
    const s = await site();
    const res = await s.call('POST', '/admin/sources', { url: empty });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('does not look like a plugin source');
    expect(((await s.call('GET', '/admin/state')).body as DashboardState).sources).toEqual([]);
    await rm(empty, { recursive: true });
  });

  it('disconnects a source but keeps what was installed from it', async () => {
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    const state = (await s.call('DELETE', `/admin/sources/${sourceId}`)).body as DashboardState;
    expect(state.sources).toEqual([]);
    expect(state.plugins).toMatchObject([{ id: 'alpha', enabled: true, source: { connected: false }, update: null }]);
    expect((await s.call('POST', '/admin/plugins/alpha/update', {})).body.error).toContain('no longer connected');
    expect((await s.call('DELETE', `/admin/sources/${sourceId}`)).status).toBe(404);
  });
});

describe('installing', () => {
  it('installs, serves the bundle, and tells the site to refresh its cache', async () => {
    const s = await site();
    const sourceId = await s.connect();
    const res = await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    expect(res.status).toBe(200);
    expect(s.changes).toBe(1);
    const plugin = (res.body as DashboardState).plugins[0]!;
    expect(plugin).toMatchObject({ id: 'alpha', enabled: true, needsSetup: false, pages: [{ path: '/alpha', configurable: true, linkable: true }] });

    const asset = await s.call('GET', plugin.runtime!.scriptSrc.replace('/api/nextpluggable', ''), undefined, { cookie: null });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
    expect(asset.body).toMatch(new RegExp(`^\\(self\\.__NP_Q__=self\\.__NP_Q__\\|\\|\\[\\]\\)\\.push\\(\\["${plugin.runtime!.moduleKey}",function\\(require,module,exports\\)\\{`));
  });

  it('serves no asset for unknown plugins, hashes or file names', async () => {
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    for (const p of ['/assets/alpha/0000000000000000/client.js', '/assets/nope/0000000000000000/client.js', '/assets/constructor/0000000000000000/client.js', '/assets/alpha/zz/client.js', '/assets/alpha/0000000000000000/server.js', '/assets/alpha/0000000000000000/..%2Finstalls.json'])
      expect([p, (await s.call('GET', p, undefined, { cookie: null })).status]).toEqual([p, 404]);
  });

  it('refuses a second copy, an unknown source and a path outside the source', async () => {
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    expect((await s.call('POST', '/admin/install', { sourceId, path: 'alpha' })).body.error).toBe('Plugin alpha is already installed.');
    expect((await s.call('POST', '/admin/install', { sourceId: 'nope', path: 'alpha' })).status).toBe(404);
    expect((await s.call('POST', '/admin/install', { sourceId, path: '../alpha' })).status).toBe(400);
    expect((await s.call('POST', '/admin/install', { sourceId, path: 'missing' })).status).toBe(404);
  });

  it('refuses a plugin whose files were altered after it was built', async () => {
    const s = await site();
    const sourceId = await s.connect();
    await writeFile(path.join(sourceDir, 'alpha/dist/client.js'), (await readFile(path.join(sourceDir, 'alpha/dist/client.js'), 'utf8')) + '\n/* injected */');
    const res = await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('failed its integrity check');
    expect(await s.storage.list('files/')).toEqual([]);
    expect(await stored(s, 'installs.json')).toBeNull();
    expect(s.changes).toBe(0);
  });

  it('aborts cleanly when a plugin fails to start', async () => {
    await writePlugin({ id: 'crashy', server: `export default { onInstall() { throw new Error('kaboom'); } };` });
    await writeIndex(['crashy']);
    const s = await site();
    const res = await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'crashy' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Plugin crashy could not be installed because it failed to start. Nothing was changed.');
    expect(res.body.error).not.toContain('kaboom'); // internals stay in the server log
    expect(await s.storage.list('files/')).toEqual([]);
    expect(((await s.call('GET', '/admin/state')).body as DashboardState).plugins).toEqual([]);
  });

  it('refuses two plugins claiming the same address', async () => {
    await writePlugin({ id: 'beta', manifest: { pages: [{ id: 'p', path: '/alpha', component: 'Main', title: 'Clash' }] } });
    await writeIndex(['alpha', 'beta']);
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    const res = await s.call('POST', '/admin/install', { sourceId, path: 'beta' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already used by the plugin "Plugin alpha"');
  });

  it('runs onInstall once, with storage scoped to the plugin', async () => {
    await writePlugin({ id: 'seeded', server: `export default { async onInstall({ storage, pluginId }) { await storage.set('seed', { by: pluginId }); } };` });
    await writeIndex(['seeded']);
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'seeded' });
    expect(await stored(s, 'data/seeded/seed')).toEqual({ by: 'seeded' });
  });
});

describe('settings', () => {
  const settings = [
    { key: 'title', label: 'Title', type: 'text', default: 'Hello', required: true },
    { key: 'rate', label: 'Rate', type: 'number', min: 0, max: 10 },
    { key: 'internal', label: 'Internal note', type: 'text', serverOnly: true },
    { key: 'apiKey', label: 'API key', type: 'secret' },
  ];
  async function ready() {
    await writePlugin({ id: 'alpha', manifest: { settings }, server: `export default { api: { 'GET /config': ({ config }) => Response.json(config) } };` });
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    return s;
  }

  it('starts from the plugin defaults', async () => {
    const s = await ready();
    const plugin = ((await s.call('GET', '/admin/state')).body as DashboardState).plugins[0]!;
    expect(plugin.values).toEqual({ title: 'Hello' });
    expect(plugin.secretsSet).toEqual({ apiKey: false });
    expect(plugin.runtime!.publicConfig).toEqual({ title: 'Hello' });
  });

  it('saves valid values and applies them immediately', async () => {
    const s = await ready();
    const res = await s.call('PATCH', '/admin/plugins/alpha', { config: { title: ' New ', rate: 7, internal: 'memo', apiKey: 'sk_live_abc' } });
    expect(res.status).toBe(200);
    expect(s.changes).toBe(2);
    expect((await s.call('GET', '/p/alpha/config', undefined, { cookie: null })).body).toEqual({ title: 'New', rate: 7, internal: 'memo', apiKey: 'sk_live_abc' });
  });

  it('never returns a secret or a server-only value to the browser, and encrypts secrets at rest', async () => {
    const s = await ready();
    const res = await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'T', internal: 'memo', apiKey: 'sk_live_abc' } });
    const plugin = (res.body as DashboardState).plugins[0]!;
    expect(JSON.stringify(res.body)).not.toContain('sk_live_abc');
    expect(plugin.secretsSet).toEqual({ apiKey: true });
    expect(plugin.runtime!.publicConfig).toEqual({ title: 'T' }); // what public pages receive
    const raw = (await s.storage.get('installs.json'))!;
    expect(raw).not.toContain('sk_live_abc');
    expect(raw).toContain('enc:v1:');
  });

  it('keeps a secret when the field is left untouched, and clears it when emptied', async () => {
    const s = await ready();
    await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'T', apiKey: 'sk_live_abc' } });
    await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'T2' } });
    expect((await s.call('GET', '/p/alpha/config')).body).toMatchObject({ title: 'T2', apiKey: 'sk_live_abc' });
    const cleared = await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'T2', apiKey: null } });
    expect((cleared.body as DashboardState).plugins[0]!.secretsSet).toEqual({ apiKey: false });
    expect((await s.call('GET', '/p/alpha/config')).body.apiKey).toBeUndefined();
  });

  it('rejects bad values with a message per field and changes nothing', async () => {
    const s = await ready();
    const res = await s.call('PATCH', '/admin/plugins/alpha', { config: { title: '', rate: 50 }, paths: { main: '/api/nextpluggable/x' } });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ title: 'Title is required.', rate: 'Rate must be at most 10.', 'path:main': 'The address /api/nextpluggable/x is reserved by the site.' });
    expect(((await s.call('GET', '/admin/state')).body as DashboardState).plugins[0]!.values).toEqual({ title: 'Hello' });
    expect(s.changes).toBe(1); // only the install
  });

  it('ignores settings the plugin never declared', async () => {
    const s = await ready();
    await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'T', __proto__: { polluted: true }, constructor: 'x', extra: 'y' } });
    expect(Object.keys((await stored(s, 'installs.json')).alpha.config).sort()).toEqual(['title']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('page addresses', () => {
  async function ready() {
    await writePlugin({ id: 'beta', manifest: { pages: [{ id: 'list', path: '/beta', component: 'Main', title: 'List' }, { id: 'item', path: '/beta/:slug', component: 'Main', title: 'Item' }, { id: 'fixed', path: '/beta-fixed', component: 'Main', title: 'Fixed', configurablePath: false }] } });
    await writeIndex(['alpha', 'beta']);
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    await s.call('POST', '/admin/install', { sourceId, path: 'beta' });
    return s;
  }
  const pages = async (s: Site, id: string) => Object.fromEntries(((await s.call('GET', '/admin/state')).body as DashboardState).plugins.find((p) => p.id === id)!.pages.map((p) => [p.id, p]));

  it('lets the owner move a page, tidying what they typed', async () => {
    const s = await ready();
    expect((await s.call('PATCH', '/admin/plugins/alpha', { paths: { main: ' Tools/Loan-Calculator/ ' } })).status).toBe(200);
    expect((await pages(s, 'alpha')).main).toMatchObject({ path: '/tools/loan-calculator', defaultPath: '/alpha' });
    // Clearing the field (or typing the default) goes back to the plugin's own address.
    await s.call('PATCH', '/admin/plugins/alpha', { paths: { main: '' } });
    expect((await pages(s, 'alpha')).main!.path).toBe('/alpha');
  });

  it('marks which pages can be moved or opened directly', async () => {
    const p = await pages(await ready(), 'beta');
    expect([p.list!.configurable, p.item!.configurable, p.fixed!.configurable]).toEqual([true, false, false]);
    expect([p.list!.linkable, p.item!.linkable]).toEqual([true, false]);
  });

  it.each([
    ['an address another plugin uses', 'alpha', { main: '/beta' }, 'already used by the plugin "Plugin beta"'],
    ['the dashboard address', 'alpha', { main: '/admin/plugins' }, 'reserved by the site'],
    ['a pattern', 'alpha', { main: '/x/:id' }, 'cannot contain ":" or "*"'],
    ['characters that are not allowed', 'alpha', { main: '/hello world' }, 'invalid segment'],
    ['a page that is not movable', 'beta', { fixed: '/elsewhere' }, 'cannot be changed'],
    ['a pattern page', 'beta', { item: '/elsewhere' }, 'cannot be changed'],
  ])('refuses %s', async (_n, id, paths, message) => {
    const s = await ready();
    const res = await s.call('PATCH', `/admin/plugins/${id}`, { paths });
    expect(res.status).toBe(422);
    expect(Object.values(res.body.fields as Record<string, string>).join(' ')).toContain(message);
  });

  it('accepts a form that re-submits unchanged addresses of pages that cannot move', async () => {
    const s = await ready();
    expect((await s.call('PATCH', '/admin/plugins/beta', { paths: { list: '/beta', item: '/beta/:slug', fixed: '/beta-fixed' } })).status).toBe(200);
  });
});

describe('required settings', () => {
  it('holds a plugin back until its required settings are filled in', async () => {
    await writePlugin({ id: 'alpha', manifest: { settings: [{ key: 'account', label: 'Account ID', type: 'text', required: true }] } });
    const s = await site();
    const installed = await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    expect((installed.body as DashboardState).plugins[0]).toMatchObject({ enabled: false, needsSetup: true });

    const early = await s.call('PATCH', '/admin/plugins/alpha', { enabled: true });
    expect(early.status).toBe(422);
    expect(early.body.error).toContain('needs a few settings filled in');

    const done = await s.call('PATCH', '/admin/plugins/alpha', { config: { account: 'AC-1' }, enabled: true });
    expect((done.body as DashboardState).plugins[0]).toMatchObject({ enabled: true, needsSetup: false });
  });
});

describe('updates', () => {
  it('offers an update when the source has a newer build, and keeps settings, address and data', async () => {
    const settings = [{ key: 'title', label: 'Title', type: 'text', default: 'Hello' }, { key: 'old', label: 'Old', type: 'text' }];
    const server = (v: string) => `export default { onInstall({ storage }) { return storage.set('installs', '${v}'); }, api: { 'GET /v': () => new Response('${v}') } };`;
    await writePlugin({ id: 'alpha', manifest: { settings }, server: server('one') });
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    await s.call('PATCH', '/admin/plugins/alpha', { config: { title: 'Mine', old: 'gone soon' }, paths: { main: '/my-address' } });
    const before = ((await s.call('GET', '/admin/state')).body as DashboardState).plugins[0]!;
    expect(before.update).toBeNull();

    // The author publishes 1.1.0: a new setting, one removed, new server code.
    await writePlugin({ id: 'alpha', version: '1.1.0', manifest: { settings: [settings[0], { key: 'fresh', label: 'Fresh', type: 'number', default: 5 }] }, server: server('two') });
    expect(((await s.call('GET', '/admin/state')).body as DashboardState).plugins[0]!.update).toBeNull(); // not noticed until sources are checked
    const refreshed = (await s.call('POST', '/admin/refresh', {})).body as DashboardState & { failures: unknown[] };
    expect(refreshed.failures).toEqual([]);
    expect(refreshed.plugins[0]!.update).toEqual({ version: '1.1.0' });
    expect((await s.call('GET', '/p/alpha/v')).body).toBe('one'); // still the old code

    const updated = (await s.call('POST', '/admin/plugins/alpha/update', {})).body as DashboardState;
    const after = updated.plugins[0]!;
    expect(after).toMatchObject({ version: '1.1.0', update: null, enabled: true, installedAt: before.installedAt });
    expect(after.values).toEqual({ title: 'Mine', fresh: 5 });
    expect(after.pages[0]!.path).toBe('/my-address');
    expect((await s.call('GET', '/p/alpha/v')).body).toBe('two');
    expect(await stored(s, 'data/alpha/installs')).toBe('one'); // onInstall does not run again

    // The previous bundle stays downloadable for pages cached before the update; older ones are pruned.
    expect((await s.call('GET', before.runtime!.scriptSrc.replace('/api/nextpluggable', ''))).status).toBe(200);
    await writePlugin({ id: 'alpha', version: '1.2.0', client: 'export function Main() { return "v3"; }', server: server('three') });
    await s.call('POST', '/admin/plugins/alpha/update', {});
    expect((await s.storage.list('files/alpha/')).length).toBe(4); // current + previous, client + server
    expect((await s.call('GET', before.runtime!.scriptSrc.replace('/api/nextpluggable', ''))).status).toBe(200);
  });

  it('leaves the installed version untouched when the new one is broken', async () => {
    await writePlugin({ id: 'alpha', server: `export default { api: { 'GET /v': () => new Response('good') } };` });
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    await writePlugin({ id: 'alpha', version: '2.0.0', server: `export default { api: { 'GET /v': () => new Response('bad') } };` });
    await writeFile(path.join(sourceDir, 'alpha/dist/server.js'), 'tampered');
    const res = await s.call('POST', '/admin/plugins/alpha/update', {});
    expect(res.status).toBe(422);
    expect((await s.call('GET', '/p/alpha/v')).body).toBe('good');
    expect(((await s.call('GET', '/admin/state')).body as DashboardState).plugins[0]!.version).toBe('1.0.0');
  });
});

describe('plugin APIs', () => {
  const server = `
    const adminOnly = (h) => (ctx) => (ctx.admin ? h(ctx) : Response.json({ error: 'no' }, { status: 401 }));
    export default {
      api: {
        'GET /items/:id': ({ params, path, site, paths, pluginId }) => Response.json({ id: params.id, path, site, paths, pluginId }),
        'POST /items': async ({ request, storage }) => { const body = await request.json(); await storage.set('item/' + body.id, body); return Response.json({ saved: await storage.list('item/') }, { status: 201 }); },
        'GET /who': ({ admin }) => Response.json({ admin }),
        'POST /who': ({ admin }) => Response.json({ admin }),
        'DELETE /items/:id': adminOnly(async ({ params, storage }) => { await storage.delete('item/' + params.id); return new Response(null, { status: 204 }); }),
        'GET /boom': () => { throw new Error('secret internal detail'); },
        'GET /wrong': () => 'not a response',
        'GET /fs': () => Response.json({ sep: require('node:path').sep }),
      },
    };`;
  async function ready() {
    await writePlugin({ id: 'alpha', server });
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    return s;
  }
  const anon = { cookie: null, csrf: false } as const;

  it('routes by method and path, passing params and context', async () => {
    const s = await ready();
    const res = await s.call('GET', '/p/alpha/items/42', undefined, anon);
    expect(res.body).toEqual({ id: '42', path: '/items/42', site: { url: ORIGIN }, paths: { main: '/alpha' }, pluginId: 'alpha' });
    expect((await s.call('GET', '/p/alpha/nothing/here', undefined, anon)).status).toBe(404);
    expect((await s.call('GET', '/p/alpha/items', undefined, anon)).status).toBe(405); // exists, but only for POST
    expect((await s.call('PUT', '/p/alpha/items/42', {}, anon)).status).toBe(405);
    expect((await s.call('GET', '/p/alpha/fs', undefined, anon)).body).toEqual({ sep: path.sep });
  });

  it('is open to visitors without any dashboard token (forms, webhooks)', async () => {
    const s = await ready();
    const res = await s.call('POST', '/p/alpha/items', { id: 'a' }, anon);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ saved: ['item/a'] });
    expect(s.changes).toBe(1); // a visitor's write does not flush the site cache
  });

  it('keeps each plugin’s data in its own namespace', async () => {
    await writePlugin({ id: 'beta', server });
    await writeIndex(['alpha', 'beta']);
    const s = await site();
    const sourceId = await s.connect();
    await s.call('POST', '/admin/install', { sourceId, path: 'alpha' });
    await s.call('POST', '/admin/install', { sourceId, path: 'beta' });
    await s.call('POST', '/p/alpha/items', { id: '../beta/item/x' }, anon);
    expect((await s.call('POST', '/p/beta/items', { id: 'own' }, anon)).body).toEqual({ saved: ['item/own'] });
    expect((await s.storage.list('data/')).every((k) => k.startsWith('data/alpha/') || k.startsWith('data/beta/'))).toBe(true);
  });

  it('only reveals the dashboard user to requests that provably came from the site itself', async () => {
    const s = await ready();
    expect((await s.call('GET', '/p/alpha/who', undefined, anon)).body).toEqual({ admin: null });
    expect((await s.call('GET', '/p/alpha/who')).body.admin).toEqual({ id: 'admin', name: 'Site owner' });
    // A cross-site form post carries the cookie but not the header: the plugin must not see an admin.
    expect((await s.call('POST', '/p/alpha/who', {}, { csrf: false })).body).toEqual({ admin: null });
    expect((await s.call('POST', '/p/alpha/who', {}, { headers: { origin: 'https://evil.example' } })).body).toEqual({ admin: null });
    expect((await s.call('POST', '/p/alpha/who', {})).body.admin).not.toBeNull();
  });

  it('enforces adminOnly routes and refreshes the site after an admin write', async () => {
    const s = await ready();
    await s.call('POST', '/p/alpha/items', { id: 'a' }, anon);
    expect((await s.call('DELETE', '/p/alpha/items/a', undefined, anon)).status).toBe(401);
    expect((await s.call('DELETE', '/p/alpha/items/a', undefined, { csrf: false })).status).toBe(401);
    const before = s.changes;
    expect((await s.call('DELETE', '/p/alpha/items/a')).status).toBe(204);
    expect(s.changes).toBe(before + 1);
    expect(await s.storage.list('data/alpha/')).toEqual([]);
  });

  it('contains plugin failures and hides their details', async () => {
    const s = await ready();
    for (const p of ['/p/alpha/boom', '/p/alpha/wrong']) {
      const res = await s.call('GET', p, undefined, anon);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    }
    expect((await s.call('GET', '/p/alpha/items/1', undefined, anon)).status).toBe(200); // still healthy
  });

  it('answers 404 for paused, removed and unknown plugins', async () => {
    const s = await ready();
    await s.call('PATCH', '/admin/plugins/alpha', { enabled: false });
    expect((await s.call('GET', '/p/alpha/items/1', undefined, anon)).status).toBe(404);
    for (const id of ['nope', 'constructor', '__proto__', 'toString']) expect((await s.call('GET', `/p/${id}/x`, undefined, anon)).status).toBe(404);
  });
});

describe('removing', () => {
  const server = `export default { onInstall: ({ storage }) => storage.set('kept', 1), onUninstall: ({ storage }) => storage.set('goodbye', 1) };`;

  it('removes code but keeps data by default', async () => {
    await writePlugin({ id: 'alpha', server });
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    const res = await s.call('DELETE', '/admin/plugins/alpha', {});
    expect((res.body as DashboardState).plugins).toEqual([]);
    expect(await s.storage.list('files/')).toEqual([]);
    expect(await s.storage.list('data/alpha/')).toEqual(['data/alpha/goodbye', 'data/alpha/kept']);
    expect((await s.call('DELETE', '/admin/plugins/alpha', {})).status).toBe(404);
  });

  it('deletes everything when asked, even if the plugin’s own cleanup fails', async () => {
    await writePlugin({ id: 'alpha', server: `export default { onInstall: ({ storage }) => storage.set('kept', 1), onUninstall() { throw new Error('cleanup failed'); } };` });
    const s = await site();
    await s.call('POST', '/admin/install', { sourceId: await s.connect(), path: 'alpha' });
    expect((await s.call('DELETE', '/admin/plugins/alpha', { deleteData: true })).status).toBe(200);
    expect(await s.storage.list('data/')).toEqual([]);
    expect(await s.storage.list('files/')).toEqual([]);
  });
});
