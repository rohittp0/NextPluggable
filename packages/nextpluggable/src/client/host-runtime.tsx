'use client';
/**
 * The host's implementation of `@nextpluggable/plugin`. Plugin bundles keep that
 * module external; when they `require` it they receive this object, so every
 * plugin shares the site's React, router and context.
 */
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import type { HostRuntime, LinkProps, PluginApi, PluginInfo } from '@nextpluggable/plugin';

export interface PluginRuntimeValue {
  info: PluginInfo;
  config: Record<string, unknown>;
}

export const PluginRuntimeContext = React.createContext<PluginRuntimeValue | null>(null);

function useRuntime(): PluginRuntimeValue {
  const value = React.useContext(PluginRuntimeContext);
  if (!value) throw new Error('Plugin hooks can only be used inside a plugin component.');
  return value;
}

export function createPluginApi(apiBase: string): PluginApi {
  return (path, init = {}) => {
    const { json, headers, ...rest } = init;
    const h = new Headers(headers);
    h.set('x-nextpluggable', '1');
    if (json !== undefined) h.set('content-type', 'application/json');
    return fetch(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`, {
      credentials: 'same-origin',
      ...rest,
      headers: h,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  };
}

export const hostRuntime: HostRuntime = {
  usePluginConfig<T>() {
    return useRuntime().config as T;
  },
  usePlugin() {
    return useRuntime().info;
  },
  usePluginApi() {
    const { apiBase } = useRuntime().info;
    return React.useMemo(() => createPluginApi(apiBase), [apiBase]);
  },
  useNavigation() {
    const router = useRouter();
    const pathname = usePathname();
    return React.useMemo(
      () => ({
        pathname,
        push: (href: string) => router.push(href),
        replace: (href: string) => router.replace(href),
        back: () => router.back(),
      }),
      [router, pathname],
    );
  },
  useQuery() {
    return new URLSearchParams(useSearchParams()?.toString() ?? '');
  },
  Link(props: LinkProps) {
    return <NextLink {...props} />;
  },
};

// Also reachable through the published SDK module, in case a plugin bundled it by mistake.
(globalThis as Record<symbol, unknown>)[Symbol.for('nextpluggable.host-runtime')] = hostRuntime;
