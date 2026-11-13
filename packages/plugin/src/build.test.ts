import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlugin, describeBuildError, seoAdvice } from './build.js';
import { validateBuild, validateManifest } from './manifest.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'np-build-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

const manifest = (extra: object = {}) =>
  JSON.stringify({ manifestVersion: 1, id: 'fixture', name: 'Fixture', version: '0.1.0', pages: [{ id: 'main', path: '/fixture', component: 'Main', title: 'Fixture' }], ...extra });

const CLIENT = `import { useState } from 'react';
import './style.css';
export function Main() { const [n] = useState(1); return <p className="fx">{n}</p>; }`;
const SERVER = `export default { pages: { main: () => ({ metadata: { title: 'T' } }) }, api: { 'GET /ping': () => new Response('pong') } };`;

describe('buildPlugin', () => {
  it('produces client, server, style and a build file whose fingerprints match the bytes', async () => {
    const dir = await fixture({ 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '.fx{color:red}', 'src/server.js': SERVER });
    const build = await buildPlugin(dir);
    expect(Object.keys(build.files).sort()).toEqual(['client', 'server', 'style']);
    for (const f of Object.values(build.files)) {
      const bytes = await readFile(path.join(dir, f.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
      expect(bytes.byteLength).toBe(f.bytes);
    }
    // What was written is exactly what a host will accept.
    expect(validateBuild(JSON.parse(await readFile(path.join(dir, 'dist/build.json'), 'utf8'))).manifest.id).toBe('fixture');
  });

  it('leaves React and the SDK to the host instead of bundling them', async () => {
    const dir = await fixture({ 'plugin.json': manifest(), 'src/style.css': '', 'src/client.jsx': `import { usePluginConfig } from '@nextpluggable/plugin';\n${CLIENT}\nexport const x = usePluginConfig;` });
    await buildPlugin(dir, { minify: false });
    const client = await readFile(path.join(dir, 'dist/client.js'), 'utf8');
    expect(client).toContain('require("react")');
    expect(client).toContain('require("react/jsx-runtime")');
    expect(client).toContain('require("@nextpluggable/plugin")');
    expect(client).not.toContain('useState=function'); // no copy of React inside
    // The bundle is a CommonJS module body a host can evaluate with its own require.
    const mod = { exports: {} as Record<string, unknown> };
    new Function('require', 'module', 'exports', client)(() => ({ useState: () => [1], jsx: () => null, usePluginConfig: () => ({}) }), mod, mod.exports);
    expect(typeof mod.exports.Main).toBe('function');
  });

  it('is reproducible: building twice gives identical output', async () => {
    const dir = await fixture({ 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '.fx{color:red}', 'src/server.js': SERVER });
    const first = await buildPlugin(dir);
    const second = await buildPlugin(dir);
    expect(second).toEqual(first);
  });

  it('inlines a small icon file', async () => {
    const dir = await fixture({ 'plugin.json': manifest({ icon: 'icon.svg' }), 'src/client.jsx': CLIENT, 'src/style.css': '', 'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    expect((await buildPlugin(dir)).icon).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it.each([
    ['no plugin.json', {}, 'No plugin.json found'],
    ['an invalid manifest', { 'plugin.json': '{"id":"X"}' }, 'Invalid plugin manifest'],
    ['pages but no client entry', { 'plugin.json': manifest(), 'src/server.js': SERVER }, 'there is no client entry'],
    ['a component the client entry does not export', { 'plugin.json': manifest(), 'src/client.jsx': 'export const Other = () => null;' }, 'does not export it'],
    ['a server entry without a default export', { 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '', 'src/server.js': 'export const x = 1;' }, 'export default definePluginServer'],
    ['a loader for an undeclared page', { 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '', 'src/server.js': 'export default { pages: { nope: () => ({}) } };' }, 'does not declare'],
    ['a malformed API route key', { 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '', 'src/server.js': `export default { api: { 'FETCH /x': () => new Response('') } };` }, 'must look like "GET /path"'],
    ['a server entry that throws on load', { 'plugin.json': manifest(), 'src/client.jsx': CLIENT, 'src/style.css': '', 'src/server.js': `throw new Error('boom'); export default {};` }, 'throws when loaded: boom'],
    ['a syntax error', { 'plugin.json': manifest(), 'src/client.jsx': 'export function Main( {' }, 'client.jsx'],
  ])('explains %s', async (_name, files, message) => {
    const dir = await fixture(files as Record<string, string>);
    const error = await buildPlugin(dir).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(describeBuildError(error)).toContain(message);
  });
});

describe('advice for search engines', () => {
  const pages = (page: object) => validateManifest(JSON.parse(manifest({ pages: [{ id: 'main', path: '/fixture', component: 'Main', title: 'Fixture', ...page }] })));

  it('points out a page with nothing of its own to show in search results', () => {
    expect(seoAdvice(pages({}))).toEqual([expect.stringContaining('Page "main" has no "description"')]);
    expect(seoAdvice(pages({ description: 'Compare loans side by side.' }))).toEqual([]);
  });

  it('points out titles and descriptions that search engines would cut short', () => {
    const advice = seoAdvice(pages({ title: 'T'.repeat(80), description: 'D'.repeat(240) }));
    expect(advice).toEqual([expect.stringContaining('description of 240 characters'), expect.stringContaining('title of 80 characters')]);
  });

  it('is reported by the build without failing it', async () => {
    const dir = await fixture({ 'plugin.json': manifest(), 'src/client.tsx': CLIENT, 'src/style.css': '.fx{color:red}' });
    const warnings: string[] = [];
    await buildPlugin(dir, { warn: (line) => warnings.push(line) });
    expect(warnings).toEqual([expect.stringContaining('has no "description"')]);
  });

  it('refuses a sitemap that is not a function', async () => {
    const dir = await fixture({ 'plugin.json': manifest(), 'src/client.tsx': CLIENT, 'src/style.css': '.fx{color:red}', 'src/server.js': `export default { sitemap: ['/fixture'] };` });
    await expect(buildPlugin(dir)).rejects.toThrow('`sitemap` in the server entry must be a function');
  });
});

