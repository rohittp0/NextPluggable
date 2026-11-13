import { revalidatePath } from 'next/cache';
import { createHandler } from './api/handler.js';
import { resolveConfig, type NextPluggableConfig } from './config.js';
import { createDashboardPage, dashboardMetadata } from './next/dashboard-page.js';
import { createPluginPage } from './next/plugin-page.js';
import { createSlot } from './next/slot.js';

export type { NextPluggableConfig } from './config.js';
export type { AdminUser, AuthAdapter } from './auth/types.js';
export type { StorageAdapter } from './storage/types.js';
export type { PluginPageProps } from './next/plugin-page.js';
export type { SlotProps } from './next/slot.js';
export { passwordAuth, type PasswordAuthOptions } from './auth/password.js';
export { customAuth, type CustomAuthOptions } from './auth/custom.js';
export { fileStorage, type FileStorageOptions } from './storage/file.js';
export { memoryStorage } from './storage/memory.js';
export { upstashStorage, type UpstashStorageOptions } from './storage/upstash.js';
export { postgresStorage, type PostgresStorageOptions } from './storage/postgres.js';

/**
 * Set up NextPluggable for a Next.js site. Call once (e.g. in `lib/nextpluggable.ts`)
 * and wire the returned pieces into three route files — see the README.
 */
export function createNextPluggable(config: NextPluggableConfig = {}) {
  const getConfig = resolveConfig(config);

  const handle = createHandler(getConfig, {
    // Anything cached by Next.js (static pages, ISR) is refreshed when plugins change.
    onSiteChange() {
      try {
        revalidatePath('/', 'layout');
      } catch (e) {
        console.warn('[nextpluggable] Could not refresh cached pages:', e);
      }
    },
  });
  const { PluginPage, generatePluginMetadata } = createPluginPage(getConfig);

  return {
    /** Route handlers for `app/api/nextpluggable/[...np]/route.ts`. */
    handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle },
    /** Page for `app/admin/plugins/[[...np]]/page.tsx`. */
    DashboardPage: createDashboardPage(getConfig),
    dashboardMetadata,
    /** Page for the root catch-all `app/[...slug]/page.tsx`: serves pages added by plugins. */
    PluginPage,
    generatePluginMetadata,
    /** `<Slot name="…" />` — a place in your layout that plugins can fill. */
    Slot: createSlot(getConfig),
  };
}

export type NextPluggable = ReturnType<typeof createNextPluggable>;
