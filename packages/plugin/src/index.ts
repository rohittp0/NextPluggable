/**
 * Client-side API for plugin authors.
 *
 * `nextpluggable-plugin build` never bundles this module: it is left as an
 * external and the host site supplies the real implementation at load time, so
 * a plugin shares the host's React, router and context instead of shipping its own.
 */
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';

export type { PluginManifest, SettingField, PluginPage } from './manifest.js';

export interface PluginInfo {
  id: string;
  version: string;
  /** Base URL of this plugin's HTTP API, e.g. `/api/nextpluggable/p/cart`. */
  apiBase: string;
  /** Present when rendered as a page. */
  page?: { id: string; path: string; params: Record<string, string> };
  /** Addresses of this plugin's pages keyed by page id (as configured by the site owner). */
  paths: Record<string, string>;
}

export interface LinkProps {
  href: string;
  children?: ReactNode;
  className?: string;
  style?: Record<string, string | number>;
  title?: string;
  'aria-label'?: string;
}

export interface Navigation {
  pathname: string;
  push(href: string): void;
  replace(href: string): void;
  back(): void;
}

/** Calls this plugin's own API. Path is relative to the plugin, e.g. `api('/items')`. */
export type PluginApi = (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;

export interface HostRuntime {
  usePluginConfig<T = Record<string, unknown>>(): T;
  usePlugin(): PluginInfo;
  usePluginApi(): PluginApi;
  useNavigation(): Navigation;
  useQuery(): URLSearchParams;
  Link: ComponentType<LinkProps>;
}

const HOST_KEY = Symbol.for('nextpluggable.host-runtime');

function host(): HostRuntime {
  const h = (globalThis as Record<symbol, unknown>)[HOST_KEY] as HostRuntime | undefined;
  if (!h)
    throw new Error(
      '@nextpluggable/plugin was used outside a NextPluggable host. Build the plugin with `nextpluggable-plugin build` and install it from the dashboard.',
    );
  return h;
}

/** The plugin's settings as filled in by the site owner (server-only and secret values excluded). */
export function usePluginConfig<T = Record<string, unknown>>(): T {
  return host().usePluginConfig<T>();
}

/** Identity and addresses of the running plugin. */
export function usePlugin(): PluginInfo {
  return host().usePlugin();
}

/** A `fetch` bound to this plugin's API. Pass `{ json }` to send a JSON body. */
export function usePluginApi(): PluginApi {
  return host().usePluginApi();
}

/** Current location plus client-side navigation, provided by the host's router. */
export function useNavigation(): Navigation {
  return host().useNavigation();
}

/**
 * The page's query string. Reading it means this part of the page is rendered
 * in the browser on cached pages, so prefer a server loader for SEO-critical content.
 */
export function useQuery(): URLSearchParams {
  return host().useQuery();
}

/** Client-side link rendered with the host's router. */
export const Link: ComponentType<LinkProps> = (props) => createElement(host().Link, props);

/** Props every page component receives in addition to what its server loader returned. */
export interface PageProps<P = Record<string, unknown>> {
  params: Record<string, string>;
  data: P;
}
