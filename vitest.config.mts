import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const plugin = (file: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'packages/plugin/src', file);

export default defineConfig({
  resolve: {
    // Test against sources, so `pnpm test` does not depend on a prior build.
    alias: [
      { find: /^@nextpluggable\/plugin\/manifest$/, replacement: plugin('manifest.ts') },
      { find: /^@nextpluggable\/plugin\/server$/, replacement: plugin('server.ts') },
      { find: /^@nextpluggable\/plugin\/build$/, replacement: plugin('build.ts') },
      { find: /^@nextpluggable\/plugin$/, replacement: plugin('index.ts') },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
