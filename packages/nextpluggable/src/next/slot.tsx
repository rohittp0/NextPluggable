import { Fragment, type ReactNode } from 'react';
import { PluginIsland } from '../client/island.js';
import type { ResolvedConfig } from '../config.js';
import { prepareClient, publicConfig } from '../core/runtime.js';
import { getInstalledPlugins } from '../core/state.js';
import { PluginGoneError } from '../errors.js';
import { pluginInfo } from './plugin-page.js';
import { PluginStyle } from './style.js';

export interface SlotProps {
  /** Slot name, e.g. `header.actions`, `footer`, `body.end`. Plugins declare which slots they fill. */
  name: string;
}

export function createSlot(getConfig: () => ResolvedConfig) {
  /**
   * A place in the site's layout where installed plugins may render something
   * (a cart button, a chat bubble, a banner). Renders nothing when no plugin fills it.
   */
  return async function Slot({ name }: SlotProps): Promise<ReactNode> {
    try {
      const cfg = getConfig();
      const installs = await getInstalledPlugins(cfg);
      const items = Object.values(installs)
        .filter((i) => i.enabled)
        .flatMap((install) => (install.manifest.slots ?? []).filter((s) => s.slot === name).map((slot) => ({ install, slot })))
        .sort((a, b) => (a.slot.order ?? 0) - (b.slot.order ?? 0) || a.install.id.localeCompare(b.install.id));
      if (!items.length) return null;
      const rendered = await Promise.all(
        items.map(async ({ install, slot }) => {
          // A plugin removed moments ago on another instance simply stops showing; it must not break the layout.
          const assets = await prepareClient(cfg, install).catch((e: unknown) => {
            if (e instanceof PluginGoneError) return null;
            throw e;
          });
          if (!assets) return null;
          return (
            <Fragment key={`${install.id}:${slot.component}`}>
              <PluginStyle assets={assets} />
              <PluginIsland moduleKey={assets.moduleKey} src={assets.scriptSrc} component={slot.component} info={pluginInfo(cfg, install)} config={publicConfig(install)} />
            </Fragment>
          );
        }),
      );
      return <>{rendered}</>;
    } catch (e) {
      // A slot sits in the site's layout: it must never take the whole site down.
      console.error(`[nextpluggable] Slot "${name}" could not be rendered:`, e);
      return null;
    }
  };
}
