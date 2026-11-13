import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { init } from './cli.js';

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

async function project(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'np-init-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}
const read = (dir: string, file: string) => readFile(path.join(dir, file), 'utf8');

describe('nextpluggable init', () => {
  it('wires a TypeScript project and generates local secrets', async () => {
    const dir = await project({ 'app/layout.tsx': '', 'tsconfig.json': '{}', '.gitignore': 'node_modules\n.env*\n' });
    const result = await init(dir);
    expect(result.created).toEqual(['lib/nextpluggable.ts', 'app/api/nextpluggable/[...np]/route.ts', 'app/admin/plugins/[[...np]]/page.tsx', 'app/[...slug]/page.tsx', '.env.local (added NextPluggable settings)']);
    expect(await read(dir, 'app/api/nextpluggable/[...np]/route.ts')).toContain(`from '../../../../lib/nextpluggable'`);
    expect(await read(dir, 'app/admin/plugins/[[...np]]/page.tsx')).toContain(`from '../../../../lib/nextpluggable'`);
    expect(await read(dir, 'app/[...slug]/page.tsx')).toContain(`from '../../lib/nextpluggable'`);
    const env = await read(dir, '.env.local');
    expect(env).toMatch(/^NEXTPLUGGABLE_PASSWORD=.{12}$/m);
    expect(env).toMatch(/^NEXTPLUGGABLE_SECRET=.{43}$/m);
    expect(result.password).toBe(/^NEXTPLUGGABLE_PASSWORD=(.+)$/m.exec(env)![1]);
    expect(await read(dir, '.gitignore')).toContain('.nextpluggable/');
    expect(result.notes).toEqual([expect.stringContaining('Your site has no sitemap')]);
  });

  it('says how to list plugin pages in a sitemap the site already has', async () => {
    const dir = await project({ 'app/layout.tsx': '', 'app/sitemap.ts': '', 'tsconfig.json': '{}', '.gitignore': '.env*\n' });
    expect((await init(dir)).notes).toEqual([expect.stringContaining('add `...(await np.sitemap())` to the entries app/sitemap.ts returns')]);
  });

  it('follows a src/ layout and plain JavaScript', async () => {
    const dir = await project({ 'src/app/layout.jsx': '' });
    const result = await init(dir);
    expect(result.created.slice(0, 4)).toEqual(['src/lib/nextpluggable.js', 'src/app/api/nextpluggable/[...np]/route.js', 'src/app/admin/plugins/[[...np]]/page.jsx', 'src/app/[...slug]/page.jsx']);
  });

  it('never overwrites: running twice changes nothing, existing secrets are kept', async () => {
    const dir = await project({ 'app/layout.tsx': '', 'tsconfig.json': '{}', '.env.local': 'NEXTPLUGGABLE_PASSWORD=mine\nOTHER=1', 'lib/nextpluggable.ts': '// customised' });
    const first = await init(dir);
    expect(first.skipped).toEqual(['lib/nextpluggable.ts']);
    expect(first.password).toBeUndefined();
    expect(await read(dir, 'lib/nextpluggable.ts')).toBe('// customised');
    const env = await read(dir, '.env.local');
    expect(env).toContain('NEXTPLUGGABLE_PASSWORD=mine\nOTHER=1\n');
    expect(env.match(/NEXTPLUGGABLE_PASSWORD=/g)).toHaveLength(1);
    const second = await init(dir);
    expect(second.created).toEqual([]);
    expect(await read(dir, '.env.local')).toBe(env);
  });

  it('leaves an existing catch-all route alone and says how to merge', async () => {
    const dir = await project({ 'app/[[...path]]/page.tsx': '// cms', 'tsconfig.json': '{}' });
    const result = await init(dir);
    expect(result.created).not.toContain('app/[...slug]/page.tsx');
    expect(result.notes[0]).toContain('already has a catch-all route (app/[[...path]])');
    expect(await read(dir, 'app/[[...path]]/page.tsx')).toBe('// cms');
  });

  it('generates an uncached catch-all with caching as a commented opt-in', async () => {
    const dir = await project({ 'app/layout.tsx': '', 'tsconfig.json': '{}' });
    await init(dir);
    const route = await read(dir, 'app/[...slug]/page.tsx');
    expect(route).toContain('export default np.PluginPage;');
    expect(route).toContain('// export const generateStaticParams = async () => [];');
    expect(route).toContain('// export const revalidate = 3600;');
    expect(route).not.toMatch(/^export const (generateStaticParams|revalidate|dynamic)/m);
    expect(route).not.toContain('force-static');
  });

  it('points out a root loading file, which turns unknown addresses into soft 404s', async () => {
    const dir = await project({ 'app/layout.tsx': '', 'app/loading.tsx': '', 'tsconfig.json': '{}', '.gitignore': '.env*\n' });
    expect((await init(dir)).notes.join(' ')).toContain('root loading file');
  });

  it('warns when .env.local might be committed, and explains a missing app directory', async () => {
    const dir = await project({ 'app/layout.tsx': '', '.gitignore': 'node_modules\n' });
    expect((await init(dir)).notes.join(' ')).toContain('.env.local is not committed');
    await expect(init(await project({ 'pages/index.js': '' }))).rejects.toThrow('App Router');
  });
});
