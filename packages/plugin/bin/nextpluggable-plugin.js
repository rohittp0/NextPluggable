#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error(err?.code === 'ERR_MODULE_NOT_FOUND' ? 'nextpluggable-plugin is not built yet. Run `pnpm --filter @nextpluggable/plugin build`.' : err);
  process.exit(1);
});
