/**
 * The shapes the dashboard UI receives. Built on the server so that nothing
 * sensitive (tokens, secrets, server-only settings' internals) reaches the browser by accident.
 */
import { isStaticPath } from '@nextpluggable/plugin/manifest';
import type { PluginManifest, SettingField } from '@nextpluggable/plugin/manifest';
import type { AdminUser } from './auth/types.js';
import type { ResolvedConfig } from './config.js';
import { isEncrypted } from './crypto.js';
import { needsSetup } from './core/installer.js';
import { effectivePaths } from './core/routes.js';
import { assetUrl, clientModuleKey, publicConfig } from './core/runtime.js';
import { getCatalog, getInstalls, getSources } from './core/store.js';
import type { Catalog, InstallRecord } from './core/types.js';

export interface SessionView {
  user: AdminUser | null;
  mode: 'password' | 'custom';
  /** False when no password/secret has been set up yet. */
  configured: boolean;
  loginUrl?: string;
}

export interface PageView {
  id: string;
  title: string;
  description?: string;
  path: string;
  defaultPath: string;
  /** Whether the owner may change the address. */
  configurable: boolean;
  /** False for pattern pages such as /shop/:slug, which cannot be opened directly. */
  linkable: boolean;
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  category?: string;
  enabled: boolean;
  needsSetup: boolean;
  pages: PageView[];
  slots: string[];
  adminPages: { id: string; title: string; component: string }[];
  settings: SettingField[];
  /** Current values of non-secret settings. */
  values: Record<string, string | number | boolean>;
  /** Which secret settings have a stored value. */
  secretsSet: Record<string, boolean>;
  permissions: string[];
  hasServer: boolean;
  source: { id: string; label: string; connected: boolean };
  update: { version: string } | null;
  installedAt: string;
  updatedAt: string;
  /** What the dashboard needs to render the plugin's own admin screens. */
  runtime: { moduleKey: string; scriptSrc: string; styleHref?: string; apiBase: string; publicConfig: Record<string, unknown>; paths: Record<string, string> } | null;
}

export interface CatalogPluginView {
  sourceId: string;
  sourceLabel: string;
  path: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  category?: string;
  pages: { title: string; path: string }[];
  slots: string[];
  adminPages: string[];
  permissions: string[];
  hasServer: boolean;
  installed: boolean;
}

export interface SourceView {
  id: string;
  type: 'github' | 'local';
  label: string;
  url?: string;
  hasToken: boolean;
  addedAt: string;
  checkedAt?: string;
  name?: string;
  pluginCount: number;
  problems: { path: string; message: string }[];
}

export interface DashboardState {
  plugins: PluginView[];
  catalog: CatalogPluginView[];
  sources: SourceView[];
  site: { name: string; url: string; allowLocalSources: boolean };
}

function pluginView(cfg: ResolvedConfig, install: InstallRecord, catalogs: Map<string, Catalog>, connected: Set<string>): PluginView {
  const m: PluginManifest = install.manifest;
  const paths = effectivePaths(install);
  const values: PluginView['values'] = {};
  const secretsSet: PluginView['secretsSet'] = {};
  for (const f of m.settings ?? []) {
    const v = install.config[f.key];
    if (f.type === 'secret') secretsSet[f.key] = isEncrypted(v);
    else if (v !== undefined) values[f.key] = v;
  }
  const offered = catalogs.get(install.source.id)?.plugins.find((p) => p.build.manifest.id === install.id);
  const moduleKey = clientModuleKey(install);
  return {
    id: install.id,
    name: m.name,
    version: m.version,
    description: m.description,
    author: m.author,
    icon: install.icon,
    category: m.category,
    enabled: install.enabled,
    needsSetup: needsSetup(m, install.config),
    pages: (m.pages ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      path: paths[p.id]!,
      defaultPath: p.path,
      configurable: p.configurablePath !== false && isStaticPath(p.path),
      linkable: isStaticPath(paths[p.id]!),
    })),
    slots: [...new Set((m.slots ?? []).map((s) => s.slot))],
    adminPages: (m.admin ?? []).map((a) => ({ id: a.id, title: a.title, component: a.component })),
    settings: m.settings ?? [],
    values,
    secretsSet,
    permissions: m.permissions ?? [],
    hasServer: Boolean(install.files.server),
    source: { id: install.source.id, label: install.source.label, connected: connected.has(install.source.id) },
    update: offered && offered.buildHash !== install.buildHash ? { version: offered.build.manifest.version } : null,
    installedAt: install.installedAt,
    updatedAt: install.updatedAt,
    runtime:
      moduleKey && install.files.client
        ? {
            moduleKey,
            scriptSrc: assetUrl(cfg, install.id, install.files.client.sha256, 'client.js'),
            styleHref: install.files.style ? assetUrl(cfg, install.id, install.files.style.sha256, 'style.css') : undefined,
            apiBase: `${cfg.apiPath}/p/${install.id}`,
            publicConfig: publicConfig(install),
            paths,
          }
        : null,
  };
}

export async function buildDashboardState(cfg: ResolvedConfig): Promise<DashboardState> {
  const [sources, installs] = await Promise.all([getSources(cfg.storage), getInstalls(cfg.storage)]);
  const catalogs = new Map<string, Catalog>();
  await Promise.all(
    sources.map(async (s) => {
      const c = await getCatalog(cfg.storage, s.id);
      if (c) catalogs.set(s.id, c);
    }),
  );
  const connected = new Set(sources.map((s) => s.id));
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

  const catalog: CatalogPluginView[] = [];
  for (const s of sources)
    for (const entry of catalogs.get(s.id)?.plugins ?? []) {
      const m = entry.build.manifest;
      catalog.push({
        sourceId: s.id,
        sourceLabel: s.label,
        path: entry.path,
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        author: m.author,
        icon: entry.build.icon,
        category: m.category,
        pages: (m.pages ?? []).map((p) => ({ title: p.title, path: p.path })),
        slots: [...new Set((m.slots ?? []).map((x) => x.slot))],
        adminPages: (m.admin ?? []).map((a) => a.title),
        permissions: m.permissions ?? [],
        hasServer: Boolean(entry.build.files.server),
        installed: Boolean(installs[m.id]),
      });
    }

  return {
    plugins: Object.values(installs)
      .map((i) => pluginView(cfg, i, catalogs, connected))
      .sort(byName),
    catalog: catalog.sort(byName),
    sources: sources.map((s) => {
      const c = catalogs.get(s.id);
      return {
        id: s.id,
        type: s.type,
        label: s.label,
        url: s.github
          ? `https://github.com/${s.github.owner}/${s.github.repo}${s.github.dir || s.github.ref ? `/tree/${s.github.ref ?? 'HEAD'}${s.github.dir ? `/${s.github.dir}` : ''}` : ''}`
          : undefined,
        hasToken: Boolean(s.github?.token),
        addedAt: s.addedAt,
        checkedAt: c?.fetchedAt,
        name: c?.name,
        pluginCount: c?.plugins.length ?? 0,
        problems: c?.problems ?? [],
      };
    }),
    site: { name: cfg.siteName, url: cfg.siteUrl, allowLocalSources: cfg.allowLocalSources },
  };
}
