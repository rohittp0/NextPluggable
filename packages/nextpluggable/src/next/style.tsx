import type { ReactNode } from 'react';
import type { ClientAssets } from '../core/runtime.js';

/**
 * A plugin's CSS. Small stylesheets are written into the page itself, so a plugin
 * never adds a request the browser must wait for before it can paint. React keeps
 * one copy per page however many of the plugin's components are on it.
 */
export function PluginStyle({ assets }: { assets: ClientAssets }): ReactNode {
  if (!assets.styleHref) return null;
  if (assets.styleCss !== undefined)
    return (
      <style href={assets.styleHref} precedence="nextpluggable">
        {assets.styleCss}
      </style>
    );
  return <link rel="stylesheet" href={assets.styleHref} precedence="nextpluggable" />;
}
