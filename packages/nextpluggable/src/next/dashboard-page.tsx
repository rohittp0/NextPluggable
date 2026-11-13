import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { sessionView } from '../api/handler.js';
import type { ResolvedConfig } from '../config.js';
import { Dashboard } from '../dashboard/Dashboard.js';

export const dashboardMetadata: Metadata = {
  title: 'Plugins',
  robots: { index: false, follow: false },
};

export function createDashboardPage(getConfig: () => ResolvedConfig) {
  /** Server component for the dashboard route. Checks who is signed in, then hands over to the client UI. */
  return async function DashboardPage(): Promise<ReactNode> {
    let cfg: ResolvedConfig;
    try {
      cfg = getConfig();
    } catch (e) {
      return <Dashboard apiPath="" dashboardPath="" siteName="" session={{ user: null, mode: 'password', configured: false }} setupError={e instanceof Error ? e.message.replace('[nextpluggable] ', '') : 'Setup is incomplete.'} />;
    }
    const incoming = await headers();
    const request = new Request(new URL(cfg.dashboardPath, cfg.siteUrl), { headers: new Headers([...incoming.entries()]) });
    return <Dashboard apiPath={cfg.apiPath} dashboardPath={cfg.dashboardPath} siteName={cfg.siteName} session={await sessionView(cfg, request)} />;
  };
}
