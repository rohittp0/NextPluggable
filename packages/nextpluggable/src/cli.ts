/**
 * `npx nextpluggable init` — wire NextPluggable into an existing Next.js (App Router) site.
 * Creates four small files and never overwrites anything that already exists.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface InitResult {
  created: string[];
  skipped: string[];
  notes: string[];
  /** Set when a dashboard password was generated. */
  password?: string;
}

const importPath = (fromFile: string, toFile: string) => {
  const rel = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/').replace(/\.(t|j)sx?$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
};

export async function init(projectDir: string): Promise<InitResult> {
  const root = path.resolve(projectDir);
  const result: InitResult = { created: [], skipped: [], notes: [] };

  const appDir = ['app', 'src/app'].map((d) => path.join(root, d)).find((d) => existsSync(d));
  if (!appDir) throw new Error('No "app" directory found. NextPluggable needs a Next.js project that uses the App Router (run this in the project root).');
  const ts = existsSync(path.join(root, 'tsconfig.json'));
  const x = ts ? 'ts' : 'js';
  const libFile = path.join(path.dirname(appDir), 'lib', `nextpluggable.${x}`);
  const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');

  async function create(file: string, content: string) {
    if (existsSync(file)) return void result.skipped.push(rel(file));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    result.created.push(rel(file));
  }

  await create(
    libFile,
    `import { createNextPluggable } from 'nextpluggable';

// Sign-in: one password, read from NEXTPLUGGABLE_PASSWORD. To use your site's own
// login instead, pass \`auth: customAuth({ getUser })\`.
// Data: a .nextpluggable folder next to your project. On serverless hosts
// (Vercel, Netlify) pass a database instead, e.g. \`storage: upstashStorage()\`.
export const np = createNextPluggable({
  siteName: 'My site',
});
`,
  );

  const apiRoute = path.join(appDir, 'api', 'nextpluggable', '[...np]', `route.${x}`);
  await create(apiRoute, `import { np } from '${importPath(apiRoute, libFile)}';\n\nexport const { GET, POST, PUT, PATCH, DELETE } = np.handlers;\n`);

  const dashboard = path.join(appDir, 'admin', 'plugins', '[[...np]]', `page.${x}x`);
  await create(dashboard, `import { np } from '${importPath(dashboard, libFile)}';\n\nexport const metadata = np.dashboardMetadata;\nexport default np.DashboardPage;\n`);

  // A root catch-all is where plugin pages are served. If the site already has one, it must be merged by hand.
  const existingCatchAll = (await readdir(appDir, { withFileTypes: true })).find((e) => e.isDirectory() && /^\[\[?\.\.\..+\]\]?$/.test(e.name));
  if (existingCatchAll) {
    result.notes.push(
      `Your site already has a catch-all route (${rel(path.join(appDir, existingCatchAll.name))}). To serve plugin pages from it, render \`<np.PluginPage params={params} />\` there when your own lookup finds nothing, or ask \`await np.hasPluginPage(pathname)\` first if that route never returns a 404.`,
    );
  } else {
    const catchAll = path.join(appDir, '[...slug]', `page.${x}x`);
    await create(
      catchAll,
      `import { np } from '${importPath(catchAll, libFile)}';

// Addresses your own routes don't handle land here. Installed plugins answer
// for the pages they add; everything else gets your normal 404 page.
export const generateMetadata = np.generatePluginMetadata;
export default np.PluginPage;

// Faster and cheaper: uncomment the next two lines to cache plugin pages like
// static pages. The dashboard refreshes the cache whenever a plugin changes.
// Only do this if nothing in your root layout reads cookies() or headers() on
// the server: with caching on, such a layout makes these pages fail with a
// 500 error in production builds (it will not show up in \`next dev\`).
// export const generateStaticParams = async () => [];
// export const revalidate = 3600;
`,
    );
  }

  if (['tsx', 'jsx', 'js'].some((ext) => existsSync(path.join(appDir, `loading.${ext}`))))
    result.notes.push(
      'Your app has a root loading file. While plugin pages are uncached (the default), it makes addresses that do not exist return "200 OK" with a noindex tag instead of a 404. To get real 404s, switch on caching in the catch-all route (see the comment in that file) or move the loading file into a route group.',
    );

  // Secrets for local development.
  const envFile = path.join(root, '.env.local');
  const env = existsSync(envFile) ? await readFile(envFile, 'utf8') : '';
  const additions: string[] = [];
  if (!/^NEXTPLUGGABLE_PASSWORD=/m.test(env)) {
    result.password = randomBytes(9).toString('base64url');
    additions.push(`NEXTPLUGGABLE_PASSWORD=${result.password}`);
  }
  if (!/^NEXTPLUGGABLE_SECRET=/m.test(env)) additions.push(`NEXTPLUGGABLE_SECRET=${randomBytes(32).toString('base64url')}`);
  if (additions.length) {
    await appendFile(envFile, `${env && !env.endsWith('\n') ? '\n' : ''}\n# NextPluggable (plugin dashboard)\n${additions.join('\n')}\n`);
    result.created.push('.env.local (added NextPluggable settings)');
  }

  const gitignore = path.join(root, '.gitignore');
  if (existsSync(gitignore)) {
    const current = await readFile(gitignore, 'utf8');
    if (!/^\/?\.nextpluggable\/?$/m.test(current)) await appendFile(gitignore, `${current.endsWith('\n') ? '' : '\n'}\n# NextPluggable local data\n.nextpluggable/\n`);
    if (!/^\.env(\.local|\*|\.\*)?$/m.test(current)) result.notes.push('Make sure .env.local is not committed: it now holds your dashboard password.');
  }

  return result;
}

const HELP = `nextpluggable — WordPress-style plugins for Next.js

Usage:
  npx nextpluggable init [dir]    Add the dashboard, API route and plugin page route to a Next.js site
`;

export async function main(): Promise<number> {
  const [command, dir] = process.argv.slice(2);
  if (command !== 'init') {
    console.log(HELP);
    return command && command !== 'help' && command !== '--help' ? 1 : 0;
  }
  const result = await init(dir ?? '.');
  for (const f of result.created) console.log(`  created  ${f}`);
  for (const f of result.skipped) console.log(`  kept     ${f} (already exists)`);
  console.log(`
Next steps
  1. Start your site and open /admin/plugins${result.password ? `\n     Dashboard password: ${result.password}  (saved in .env.local)` : ''}
  2. Optional: add <np.Slot name="header.actions" />, <np.Slot name="footer" /> and
     <np.Slot name="body.end" /> to your root layout so plugins can add buttons and widgets there.
  3. Before going live, set NEXTPLUGGABLE_PASSWORD and NEXTPLUGGABLE_SECRET on your host,
     and choose a storage adapter if the host has no persistent disk.`);
  for (const note of result.notes) console.log(`\nNote: ${note}`);
  return 0;
}
