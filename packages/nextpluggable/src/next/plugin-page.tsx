import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import type { PluginInfo } from '@nextpluggable/plugin';
import { PluginIsland } from '../client/island.js';
import type { ResolvedConfig } from '../config.js';
import { effectivePaths, findPage, normalizePathname } from '../core/routes.js';
import { prepareClient, publicConfig, runPageLoader } from '../core/runtime.js';
import { getInstalledPlugins, invalidateInstalledPlugins } from '../core/state.js';
import { PluginGoneError } from '../errors.js';
import type { InstallRecord } from '../core/types.js';

type RouteParams = Promise<Record<string, string | string[] | undefined>>;

export interface PluginPageProps {
  params: RouteParams;
}

/** The pathname a catch-all route was called with, whatever the segment is named. */
async function pathnameOf(params: RouteParams): Promise<string> {
  const values = Object.values(await params);
  const catchAll = values.find(Array.isArray);
  if (catchAll) return normalizePathname(catchAll.join('/'));
  return normalizePathname(typeof values[0] === 'string' ? values[0] : '/');
}

export function pluginInfo(cfg: ResolvedConfig, install: InstallRecord, page?: PluginInfo['page']): PluginInfo {
  return { id: install.id, version: install.manifest.version, apiBase: `${cfg.apiPath}/p/${install.id}`, paths: effectivePaths(install), page };
}

export function createPluginPage(getConfig: () => ResolvedConfig) {
  // `cache` de-duplicates the work between generateMetadata and the page within one request.
  const run = cache(async (pathname: string) => {
    const attempt = async () => {
      const cfg = getConfig();
      const match = findPage(await getInstalledPlugins(cfg), pathname);
      if (!match) return null;
      const result = await runPageLoader(cfg, match.install, match.page.id, { path: pathname, params: match.params });
      return { pathname, match, result, assets: await prepareClient(cfg, match.install) };
    };
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof PluginGoneError)) throw e;
      // This instance's list of plugins was stale (the plugin was just removed or updated elsewhere): look again.
      invalidateInstalledPlugins(getConfig());
      try {
        return await attempt();
      } catch (again) {
        if (again instanceof PluginGoneError) return null;
        throw again;
      }
    }
  });

  // Only `params` is read, never the query string, cookies or headers, so this
  // route can be statically cached as well as rendered per request.
  const resolveRequest = async (props: PluginPageProps) => run(await pathnameOf(props.params));

  async function generatePluginMetadata(props: PluginPageProps): Promise<Metadata> {
    const loaded = await resolveRequest(props);
    if (!loaded || loaded.result.notFound || loaded.result.redirect) return {};
    const cfg = getConfig();
    const meta = loaded.result.metadata ?? {};
    const title = meta.title ?? loaded.match.page.title;
    const description = meta.description ?? loaded.match.page.description;
    const absolute = (value: string) => {
      try {
        return new URL(value, cfg.siteUrl).toString();
      } catch {
        return undefined;
      }
    };
    const canonical = absolute(meta.canonical ?? loaded.pathname);
    const image = meta.image ? absolute(meta.image) : undefined;
    return {
      title,
      description,
      alternates: canonical ? { canonical } : undefined,
      openGraph: { title, description, url: canonical, type: 'website', images: image ? [image] : undefined },
      robots: meta.noindex ? { index: false, follow: false } : undefined,
    };
  }

  /**
   * Server component for a root catch-all route. Renders the plugin page that
   * owns the requested address, or the site's 404 when none does.
   */
  async function PluginPage(props: PluginPageProps): Promise<ReactNode> {
    const loaded = await resolveRequest(props);
    if (!loaded || loaded.result.notFound || !loaded.assets) notFound();
    const { match, result, pathname, assets } = loaded;
    if (result.redirect) redirect(result.redirect);
    const cfg = getConfig();
    const jsonLd = result.jsonLd ? (Array.isArray(result.jsonLd) ? result.jsonLd : [result.jsonLd]) : [];
    return (
      <>
        {assets.styleHref ? <link rel="stylesheet" href={assets.styleHref} precedence="nextpluggable" /> : null}
        {jsonLd.map((item, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item).replace(/</g, '\\u003c') }} />
        ))}
        <PluginIsland
          moduleKey={assets.moduleKey}
          src={assets.scriptSrc}
          component={match.page.component}
          info={pluginInfo(cfg, match.install, { id: match.page.id, path: pathname, params: match.params })}
          config={publicConfig(match.install)}
          props={{ data: result.data ?? {}, params: match.params }}
          errorFallback={<p style={{ padding: '48px 16px', textAlign: 'center' }}>This page could not be displayed. Please try again later.</p>}
        />
      </>
    );
  }

  /**
   * Whether an installed, switched-on plugin serves a page at this address. For sites
   * whose own catch-all route has to choose between a plugin page and something of its
   * own: unlike `PluginPage`, it never triggers the site's 404.
   */
  async function hasPluginPage(pathname: string): Promise<boolean> {
    return findPage(await getInstalledPlugins(getConfig()), normalizePathname(pathname)) !== null;
  }

  return { PluginPage, generatePluginMetadata, hasPluginPage };
}
