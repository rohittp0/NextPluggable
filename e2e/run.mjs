// End-to-end test: drives a small Next.js site (e2e/site) in a real browser the
// way a site owner would, against a mock GitHub API.
//
//   pnpm build && pnpm e2e
//
// Runs against that site as committed (plugin pages rendered per request).
// With --cached it first switches on the optional page caching in the site's
// catch-all route, so that mode is exercised too; the file is restored afterwards.
//
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_TOKEN, nextPatch, startMockGitHub } from './mock-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'e2e/site');
const nextBin = path.join(site, 'node_modules/next/dist/bin/next');
const PASSWORD = 'e2e-password';
const cached = process.argv.includes('--cached');
const routeFile = path.join(site, 'app/[...slug]/page.tsx');
const routeSource = await readFile(routeFile, 'utf8');
const emiNext = nextPatch(JSON.parse(await readFile(path.join(root, 'plugins/emi-calculator/plugin.json'), 'utf8')).version);

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('The end-to-end test needs Playwright: npm install --global playwright && npx playwright install chromium');
  process.exit(2);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

const github = await startMockGitHub(root);
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'nextpluggable-e2e-'));
const port = Number(process.env.E2E_PORT) || (await freePort());
const base = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXTPLUGGABLE_PASSWORD: PASSWORD,
  NEXTPLUGGABLE_SECRET: 'e2e-secret-0123456789abcdef',
  NEXTPLUGGABLE_DATA_DIR: dataDir,
  NEXTPLUGGABLE_GITHUB_API_URL: github.url,
  NEXTPLUGGABLE_ALLOW_LOCAL_SOURCES: '1', // for the folder source used by the crash test
  NEXT_PUBLIC_SITE_URL: base,
  NEXT_TELEMETRY_DISABLED: '1',
};

console.log(`Building the test site (${cached ? 'plugin pages cached' : 'plugin pages rendered per request'})…`);
if (cached) {
  const enabled = routeSource.replace('// export const generateStaticParams', 'export const generateStaticParams').replace('// export const revalidate', 'export const revalidate');
  if (enabled === routeSource) throw new Error('Could not find the caching lines to switch on in the test site route.');
  await writeFile(routeFile, enabled);
}
const built = spawnSync(process.execPath, [nextBin, 'build'], { cwd: site, env, stdio: ['ignore', 'ignore', 'inherit'] });
await writeFile(routeFile, routeSource);
if (built.status !== 0) process.exit(1);

// Run Next.js directly (not through npx) in its own process group, so teardown can stop every process it starts.
const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], { cwd: site, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The site did not start:\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const browserErrors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => browserErrors.push(`${label}: ${e.message}`));
    p.on('console', (m) => {
      // Failed HTTP requests that the test provokes on purpose are not errors of the app.
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) browserErrors.push(`${label}: ${m.text()}`);
    });
  };
  watch(page, 'dashboard');
  const api = `${base}/api/nextpluggable`;
  const dash = `${base}/admin/plugins`;
  const toast = (text) => page.waitForSelector(`.np-toast:has-text("${text}")`);
  const html = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, body: await res.text() };
  };

  console.log('\nAccess control');
  await step('the dashboard API refuses anonymous callers', async () => {
    expect((await fetch(`${api}/admin/state`)).status === 401, 'state should need a sign-in');
    const res = await fetch(`${api}/admin/sources`, { method: 'POST', headers: { 'x-nextpluggable': '1', 'content-type': 'application/json' }, body: '{"url":"acme/plugins"}' });
    expect(res.status === 401, `anonymous write returned ${res.status}`);
  });
  await step('writes without the anti-forgery header are blocked', async () => {
    const res = await fetch(`${api}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    expect(res.status === 403, `expected 403, got ${res.status}`);
    const cross = await fetch(`${api}/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nextpluggable': '1', origin: 'https://evil.example' }, body: JSON.stringify({ password: PASSWORD }) });
    expect(cross.status === 403, `cross-origin write returned ${cross.status}`);
  });
  await step('a wrong password is rejected, the right one signs in', async () => {
    await page.goto(dash);
    await page.fill('#np-password', 'wrong');
    await page.click('button[type=submit]');
    await page.waitForSelector('#np-password-error');
    await page.fill('#np-password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('text=No plugins installed yet');
    const cookie = (await context.cookies()).find((c) => c.name === 'np_session');
    expect(cookie?.httpOnly && cookie.sameSite === 'Lax', 'session cookie must be HttpOnly and SameSite=Lax');
  });

  console.log('\nSources');
  await step('a pasted address that is not a plugin source is explained', async () => {
    await page.goto(`${dash}/sources`);
    await page.fill('#np-source-url', 'https://github.com/acme/empty');
    await page.click('button:has-text("Connect source")');
    await page.waitForSelector('#np-source-error:has-text("does not look like a plugin source")');
    await page.fill('#np-source-url', 'not a repository');
    await page.click('button:has-text("Connect source")');
    await page.waitForSelector('#np-source-error:has-text("does not look like a GitHub repository address")');
    await page.fill('#np-source-url', '/etc');
    await page.click('button:has-text("Connect source")');
    await page.waitForSelector('#np-source-error:has-text("does not look like a plugin source")');
  });
  await step('a public GitHub repository connects from its browser address', async () => {
    await page.fill('#np-source-url', 'https://github.com/acme/plugins');
    await page.click('button:has-text("Connect source")');
    await toast('Connected acme/plugins: 2 plugins found.');
  });
  await step('a private repository needs a token, and works with one', async () => {
    await page.fill('#np-source-url', 'https://github.com/acme/private-plugins');
    await page.click('button:has-text("Connect source")');
    await page.waitForSelector('#np-source-error:has-text("if the repository is private, add an access token")');
    await page.check('text=This repository is private');
    await page.fill('#np-source-token', 'github_pat_wrong');
    await page.click('button:has-text("Connect source")');
    await page.waitForSelector('#np-source-error:has-text("did not accept the access token")');
    await page.fill('#np-source-token', PRIVATE_TOKEN);
    await page.click('button:has-text("Connect source")');
    await toast('Connected acme/private-plugins');
    await page.waitForSelector('.np-chip:has-text("Private")');
    const state = await page.evaluate(async (u) => (await fetch(u)).text(), `${api}/admin/state`);
    expect(!state.includes(PRIVATE_TOKEN), 'the access token must never be sent back to the browser');
    await page.click('li:has-text("acme/private-plugins") button:has-text("Disconnect")');
    await toast('acme/private-plugins was disconnected');
  });
  await step('files are fetched at the exact commit that was resolved', async () => {
    const contents = github.requests.filter((r) => r.repo === 'acme/plugins' && r.kind === 'contents');
    expect(contents.length > 0 && contents.every((r) => r.ref === 'a'.repeat(40)), 'every file read must be pinned to the resolved commit');
  });
  await step('a plugin whose files do not match their fingerprint is refused', async () => {
    await page.fill('#np-source-url', 'acme/tampered');
    await page.click('button:has-text("Connect source")');
    await toast('Connected acme/tampered');
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("from acme/tampered"):has-text("EMI Calculator") button:has-text("Install")');
    await page.click('[role=dialog] button:has-text("Install")');
    await toast('failed its integrity check');
    expect((await html('/emi-calculator')).status === 404, 'a refused plugin must not be served');
    await page.keyboard.press('Escape');
    await page.goto(`${dash}/sources`);
    await page.click('li:has-text("acme/tampered") button:has-text("Disconnect")');
    await toast('acme/tampered was disconnected');
  });

  console.log('\nA standalone tool: EMI calculator');
  await step('installing takes one confirmation and no rebuild', async () => {
    expect((await html('/emi-calculator')).status === 404, 'page should not exist before install');
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("EMI Calculator") button:has-text("Install")');
    await page.waitForSelector('[role=dialog] >> text=Adds the page “EMI Calculator” at /emi-calculator');
    await page.click('[role=dialog] button:has-text("Install")');
    await page.waitForURL('**/plugin/emi-calculator');
    await toast('EMI Calculator is installed and live.');
  });
  await step('its page is server-rendered with SEO metadata', async () => {
    const { status, body } = await html('/emi-calculator');
    expect(status === 200, `status ${status}`);
    for (const needle of [
      '<title>EMI Calculator · Harbor Lending</title>',
      `<link rel="canonical" href="${base}/emi-calculator"/>`,
      '<meta name="description" content="Work out your monthly instalment',
      'property="og:title" content="EMI Calculator"',
      '"@type":"WebApplication"',
      '<h1>EMI Calculator</h1>',
      '₹21,696', // the computed instalment is in the HTML, not filled in by JavaScript
      'Yearly repayment schedule',
      'HOST-HEADER-MARK',
    ])
      expect(body.includes(needle), `missing from server HTML: ${needle}`);
  });
  if (cached)
    await step('the page is cached like a static page, yet was live the moment it was installed', async () => {
      // The address returned a (cached) 404 before the install; the install had to invalidate that.
      const first = await fetch(`${base}/emi-calculator`);
      const second = await fetch(`${base}/emi-calculator`);
      expect(first.status === 200 && second.status === 200, 'page should be live');
      expect(second.headers.get('x-nextjs-cache') === 'HIT', `expected a cache hit, got ${second.headers.get('x-nextjs-cache')}`);
    });
  await step('it hydrates and stays interactive, with no errors', async () => {
    const pub = await context.newPage();
    watch(pub, 'emi page');
    await pub.goto(`${base}/emi-calculator`, { waitUntil: 'networkidle' });
    expect((await pub.textContent('[data-testid=emi]')) === '₹21,696', 'initial EMI');
    await pub.fill('input[type=number] >> nth=1', '10');
    expect((await pub.textContent('[data-testid=emi]')) === '₹24,126', 'EMI after changing the rate');
    await pub.close();
  });
  await step('settings and the page address change instantly', async () => {
    await page.fill('#np-path-calculator', 'Loan-Calculator/');
    await page.fill('label:has-text("Page heading") + input', 'Home Loan Calculator');
    await page.selectOption('label:has-text("Number format") + select', 'international');
    await page.click('button:has-text("Save changes")');
    await toast('Saved.');
    expect((await html('/emi-calculator')).status === 404, 'old address should be gone');
    const { body } = await html('/loan-calculator');
    expect(body.includes('<h1>Home Loan Calculator</h1>') && body.includes('<title>Home Loan Calculator · Harbor Lending</title>'), 'new heading/title');
    expect(body.includes('₹2,500,000') && !body.includes('₹25,00,000'), 'number format setting should apply');
  });
  await step('invalid settings are explained next to the field', async () => {
    await page.fill('#np-path-calculator', '/admin/plugins/x');
    await page.fill('label:has-text("Button link") + input', 'not-a-link');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('.np-error:has-text("is reserved by the site")');
    await page.waitForSelector('.np-error:has-text("must be a web address")');
    expect((await html('/loan-calculator')).status === 200, 'a rejected save must change nothing');
    await page.reload();
    await page.waitForSelector('#np-path-calculator');
  });
  await step('the site’s own routes win over plugin pages', async () => {
    await page.fill('#np-path-calculator', '/about');
    await page.click('button:has-text("Save changes")');
    await toast('Saved.');
    const { body } = await html('/about');
    expect(body.includes('A page that belongs to the site itself'), 'the site route must still be served');
    await page.fill('#np-path-calculator', '/loan-calculator');
    await page.click('button:has-text("Save changes")');
    await toast('Saved.');
  });
  await step('an update is offered, applied in one click, and keeps settings', async () => {
    github.advance();
    await page.goto(dash);
    await page.click('button:has-text("Check for updates")');
    await page.click(`button:has-text("Update to ${emiNext}")`);
    await toast(`EMI Calculator was updated to version ${emiNext}.`);
    await page.waitForSelector(`.np-row:has-text("EMI Calculator") >> text=v${emiNext}`);
    const { status, body } = await html('/loan-calculator');
    expect(status === 200 && body.includes('<h1>Home Loan Calculator</h1>'), 'settings and address must survive the update');
  });

  console.log('\nA full-stack plugin: enquiry form');
  await step('installs alongside the first plugin', async () => {
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("Enquiry Form") button:has-text("Install")');
    await page.waitForSelector('[role=dialog] >> text=Adds a “Enquiries” screen to this dashboard');
    await page.click('[role=dialog] button:has-text("Install")');
    await page.waitForURL('**/plugin/enquiry-form');
  });
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pub = await visitor.newPage();
  pub.setDefaultTimeout(10_000);
  watch(pub, 'visitor');
  await step('its floating button shows on the site’s own pages (layout slot)', async () => {
    const { body } = await html('/');
    expect(body.includes('npenq-fab') && body.includes('Get in touch'), 'slot content should be server-rendered into the home page');
    await pub.goto(base, { waitUntil: 'networkidle' });
    await pub.click('a.npenq-fab'); // client-side navigation into a plugin page
    await pub.waitForSelector('h1:has-text("Talk to us")');
    expect(new URL(pub.url()).pathname === '/contact', 'should be on /contact');
    expect((await pub.locator('a.npenq-fab').count()) === 0, 'the button hides itself on the form page');
  });
  await step('a visitor’s mistakes are explained, then the enquiry is accepted', async () => {
    await pub.fill('input[name=name]', 'Asha Verma');
    await pub.fill('input[name=email]', 'not-an-email');
    await pub.click('button:has-text("Send enquiry")');
    await pub.waitForSelector('text=Please enter a valid email address.');
    await pub.fill('input[name=email]', 'asha@example.com');
    await pub.fill('textarea[name=message]', 'Do you offer balance transfers?');
    await pub.click('button:has-text("Send enquiry")');
    await pub.waitForSelector('text=Thank you. We have received your enquiry');
  });
  await step('visitors cannot read the inbox; the plugin API is otherwise public', async () => {
    const list = await pub.evaluate(async (u) => (await fetch(u)).status, `${api}/p/enquiry-form/enquiries`);
    expect(list === 401, `anonymous inbox read returned ${list}`);
    expect((await fetch(`${api}/p/enquiry-form/nope`)).status === 404, 'unknown plugin route');
    expect((await fetch(`${api}/p/constructor/x`)).status === 404, 'unknown plugin id');
  });
  await step('the enquiry appears in the plugin’s own dashboard screen', async () => {
    await page.click('role=tab[name="Enquiries"]');
    await page.waitForSelector('[data-testid=enquiry-count]:has-text("1 enquiry · 1 to follow up")');
    await page.waitForSelector('text=Do you offer balance transfers?');
    await page.check('text=Followed up');
    await page.waitForSelector('[data-testid=enquiry-count]:has-text("0 to follow up")');
  });
  await step('secrets are write-only and stored encrypted', async () => {
    await page.click('role=tab[name="Settings"]');
    await page.fill('label:has-text("Notification webhook") + input', 'https://hooks.example.com/secret-path');
    await page.click('button:has-text("Save changes")');
    await toast('Saved.');
    const state = await page.evaluate(async (u) => (await fetch(u)).text(), `${api}/admin/state`);
    expect(!state.includes('secret-path'), 'a secret must never be sent back to the browser');
    const { readFile } = await import('node:fs/promises');
    const stored = await readFile(path.join(dataDir, 'installs.json'), 'utf8');
    expect(!stored.includes('secret-path') && stored.includes('enc:v1:'), 'a secret must be encrypted at rest');
    expect(!(await html('/contact')).body.includes('secret-path'), 'a secret must never reach public pages');
  });

  console.log('\nPages with parameters, redirects and query strings');
  const kbDir = await mkdtemp(path.join(os.tmpdir(), 'nextpluggable-kb-'));
  await step('a plugin serves many addresses from one page, each with its own SEO data', async () => {
    const { buildPlugin } = await import('../packages/plugin/dist/build.js');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.join(kbDir, 'src'), { recursive: true });
    await writeFile(
      path.join(kbDir, 'plugin.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'kb-demo',
        name: 'Help Articles',
        version: '1.0.0',
        pages: [
          { id: 'article', path: '/kb/:slug', component: 'Article', title: 'Article' },
          { id: 'search', path: '/kb-search', component: 'Search', title: 'Search' },
        ],
      }),
    );
    await writeFile(
      path.join(kbDir, 'src/client.js'),
      `import { createElement as h } from 'react';
import { useQuery } from '@nextpluggable/plugin';
export function Article({ data, params }) { return h('article', null, h('h1', null, data.title), h('p', { id: 'kb-body' }, data.body), h('small', { id: 'kb-slug' }, params.slug)); }
export function Search() { return h('p', { id: 'kb-q' }, 'You searched for: ' + (useQuery().get('q') ?? '')); }`,
    );
    await writeFile(
      path.join(kbDir, 'src/server.js'),
      `const ARTICLES = { 'getting-started': { title: 'Getting started', body: 'Welcome aboard.' }, 'secret-draft': { title: 'Draft', body: 'Not public yet.', draft: true } };
export default {
  pages: {
    article({ params }) {
      if (params.slug === 'old-intro') return { redirect: '/kb/getting-started' };
      const article = ARTICLES[params.slug];
      if (!article) return { notFound: true };
      return { data: article, metadata: { title: article.title, description: article.body, noindex: Boolean(article.draft), image: '/og/' + params.slug + '.png' } };
    },
  },
};`,
    );
    await buildPlugin(kbDir);
    await page.goto(`${dash}/sources`);
    await page.fill('#np-source-url', kbDir);
    await page.click('button:has-text("Connect source")');
    await toast('1 plugin found');
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("Help Articles") button:has-text("Install")');
    await page.click('[role=dialog] button:has-text("Install")');
    await page.waitForURL('**/plugin/kb-demo');

    const article = await html('/kb/getting-started');
    expect(article.status === 200, `article status ${article.status}`);
    for (const needle of ['<h1>Getting started</h1>', 'Welcome aboard.', '<title>Getting started · Harbor Lending</title>', `property="og:image" content="${base}/og/getting-started.png"`, `rel="canonical" href="${base}/kb/getting-started"`])
      expect(article.body.includes(needle), `missing from the article HTML: ${needle}`);
    expect(!/name="robots" content="noindex/.test(article.body), 'a public article must be indexable');
    const draft = await html('/kb/secret-draft');
    expect(draft.status === 200 && /name="robots" content="noindex, nofollow"/.test(draft.body), 'a page marked noindex must say so');
  });
  await step('a loader can answer “not found” or redirect, with real HTTP statuses', async () => {
    expect((await html('/kb/does-not-exist')).status === 404, 'unknown article should be a real 404');
    const res = await fetch(`${base}/kb/old-intro`, { redirect: 'manual' });
    expect([307, 308].includes(res.status), `redirect status ${res.status}`);
    // Next.js repeats the Location header on the first, uncached response; every copy must point to the same place.
    const targets = new Set(res.headers.get('location').split(',').map((v) => new URL(v.trim(), base).pathname));
    expect(targets.size === 1 && targets.has('/kb/getting-started'), `redirect target ${res.headers.get('location')}`);
  });
  await step('the query string is only ever read in the browser', async () => {
    if (cached) {
      await fetch(`${base}/kb/getting-started`);
      expect((await fetch(`${base}/kb/getting-started`)).headers.get('x-nextjs-cache') === 'HIT', 'article should be served from the cache');
    }
    // What the plugin renders on the server never includes the query, cached or not, so one
    // visitor's query cannot be shown to another. (In cached mode Next.js itself still embeds
    // the first request's URL in the page's inline data; that is outside the plugin runtime.)
    const search = await html('/kb-search?q=hello');
    expect(search.status === 200 && search.body.includes('<title>Search · Harbor Lending</title>'), `search page status ${search.status}`);
    expect(search.body.includes('You searched for: <') && !search.body.includes('You searched for: hello'), 'the component is server-rendered with an empty query');
    const next = await html('/kb-search?q=world');
    expect(next.body.includes('You searched for: <') && !/You searched for: (hello|world)/.test(next.body), 'the next visitor gets the same neutral markup');
    const tab = await visitor.newPage();
    watch(tab, 'kb page');
    await tab.goto(`${base}/kb/getting-started`, { waitUntil: 'load' });
    expect((await tab.textContent('#kb-slug')) === 'getting-started', 'params reach the component after hydration');
    await tab.goto(`${base}/kb-search?q=hello`, { waitUntil: 'load' });
    await tab.waitForSelector('#kb-q:has-text("You searched for: hello")');
    await tab.goto(`${base}/kb-search?q=world`, { waitUntil: 'load' });
    await tab.waitForSelector('#kb-q:has-text("You searched for: world")');
    await tab.close();
    // Clean up.
    await page.click('role=tab[name="About"]');
    await page.click('button:has-text("Remove plugin")');
    await page.click('[role=dialog] button:has-text("Remove")');
    await toast('Help Articles was removed.');
    await page.goto(`${dash}/sources`);
    await page.click(`li:has-text("${path.basename(kbDir)}") button:has-text("Disconnect")`);
    await rm(kbDir, { recursive: true, force: true });
  });

  console.log('\nA plugin that crashes');
  const brokenDir = await mkdtemp(path.join(os.tmpdir(), 'nextpluggable-broken-'));
  await step('a crashing plugin cannot take the site down', async () => {
    const { buildPlugin } = await import('../packages/plugin/dist/build.js');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.join(brokenDir, 'src'), { recursive: true });
    await writeFile(
      path.join(brokenDir, 'plugin.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'broken-plugin',
        name: 'Broken Plugin',
        version: '1.0.0',
        pages: [{ id: 'main', path: '/broken', component: 'Page', title: 'Broken' }],
        slots: [
          { slot: 'body.end', component: 'Widget' },
          { slot: 'footer', component: 'ServerShy' },
        ],
      }),
    );
    await writeFile(
      path.join(brokenDir, 'src/client.js'),
      `import { createElement } from 'react';
export function Page() { throw new Error('page exploded'); }
export function Widget() { throw new Error('widget exploded'); }
// Fails on the server only, the most common plugin mistake: touching browser globals while rendering.
export function ServerShy() { return createElement('span', { id: 'server-shy' }, 'width ' + window.innerWidth); }`,
    );
    await buildPlugin(brokenDir);

    await page.goto(`${dash}/sources`);
    await page.fill('#np-source-url', brokenDir);
    await page.click('button:has-text("Connect source")');
    await toast('1 plugin found');
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("Broken Plugin") button:has-text("Install")');
    await page.click('[role=dialog] button:has-text("Install")');
    await page.waitForURL('**/plugin/broken-plugin');

    // Its widget sits in the layout of every page, and throws.
    const home = await html('/');
    expect(home.status === 200 && home.body.includes('Home loans, explained plainly.'), 'the home page must still render on the server');
    expect(home.body.includes('npenq-fab'), 'a healthy widget in the same slot must still be server-rendered');
    const calc = await html('/loan-calculator');
    expect(calc.status === 200 && calc.body.includes('<h1>Home Loan Calculator</h1>'), 'other plugins must still render');

    // A fresh browser session, not watched for console errors: the crash is expected to be logged there.
    const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await session.newPage();
    tab.setDefaultTimeout(10_000);
    const uncaught = [];
    tab.on('pageerror', (e) => uncaught.push(e.message));
    await tab.goto(base, { waitUntil: 'load' });
    // A plugin that only failed on the server still works in the browser.
    await tab.waitForSelector('#server-shy:has-text("width 1280")');
    await tab.waitForSelector('a.npenq-fab'); // the healthy widget sharing the slot is unaffected
    await tab.click('nav >> text=About'); // the site's own navigation still works
    await tab.waitForSelector('h1:has-text("About")');
    await tab.goto(`${base}/loan-calculator`, { waitUntil: 'load' });
    await tab.waitForSelector('#server-shy');
    await tab.fill('input[type=number] >> nth=1', '10');
    expect((await tab.textContent('[data-testid=emi]')) === '₹24,126', 'other plugins must stay interactive');
    await tab.goto(`${base}/broken`, { waitUntil: 'load' });
    await tab.waitForSelector('text=This page could not be displayed');
    expect((await tab.locator('header.site-header').count()) === 1, 'the site layout must survive a crashing plugin page');
    expect(uncaught.length === 0, `uncaught errors reached the page: ${uncaught.join(' | ')}`);
    await session.close();
  });
  await step('the owner can remove the crashing plugin from the dashboard', async () => {
    await page.click('role=tab[name="About"]');
    await page.click('button:has-text("Remove plugin")');
    await page.click('[role=dialog] button:has-text("Remove")');
    await toast('Broken Plugin was removed.');
    expect((await html('/broken')).status === 404, 'removed page');
    await page.goto(`${dash}/sources`);
    await page.click(`li:has-text("${path.basename(brokenDir)}") button:has-text("Disconnect")`);
    await rm(brokenDir, { recursive: true, force: true });
  });

  console.log('\nPause and remove');
  await step('pausing hides a plugin everywhere; switching it on restores it', async () => {
    await page.goto(dash);
    await page.click('.np-row:has-text("Enquiry Form") .np-switch');
    await toast('Enquiry Form is paused');
    expect((await html('/contact')).status === 404, 'paused page');
    expect(!(await html('/')).body.includes('npenq-fab'), 'paused slot');
    expect((await fetch(`${api}/p/enquiry-form/enquiries`, { method: 'POST', body: '{}' })).status === 404, 'paused API');
    await page.click('.np-row:has-text("Enquiry Form") .np-switch');
    await toast('Enquiry Form is now live');
    expect((await html('/contact')).status === 200, 'restored page');
  });
  await step('removing keeps data by default; reinstalling brings it back', async () => {
    await page.click('.np-row:has-text("Enquiry Form") >> text=Settings');
    await page.click('role=tab[name="About"]');
    await page.click('button:has-text("Remove plugin")');
    await page.click('[role=dialog] button:has-text("Remove")');
    await toast('Enquiry Form was removed.');
    expect((await html('/contact')).status === 404, 'removed page');
    await page.goto(`${dash}/add`);
    await page.click('li:has-text("Enquiry Form") button:has-text("Install")');
    await page.click('[role=dialog] button:has-text("Install")');
    await page.waitForURL('**/plugin/enquiry-form');
    await page.click('role=tab[name="Enquiries"]');
    await page.waitForSelector('text=Do you offer balance transfers?');
  });
  await step('removing with “delete everything” leaves nothing behind', async () => {
    await page.click('role=tab[name="About"]');
    await page.click('button:has-text("Remove plugin")');
    await page.check('[role=dialog] >> text=Also delete everything');
    await page.click('[role=dialog] button:has-text("Remove")');
    await toast('Enquiry Form was removed.');
    const { readdir } = await import('node:fs/promises');
    const left = await readdir(path.join(dataDir, 'data', 'enquiry-form')).catch(() => []);
    expect(left.length === 0, `plugin data left behind: ${left.join(', ')}`);
    const files = await readdir(path.join(dataDir, 'files', 'enquiry-form')).catch(() => []);
    expect(files.length === 0, `plugin files left behind: ${files.join(', ')}`);
  });
  await step('signing out locks the dashboard again', async () => {
    await page.click('button:has-text("Sign out")');
    await page.waitForSelector('#np-password');
    const status = await page.evaluate(async (u) => (await fetch(u)).status, `${api}/admin/state`);
    expect(status === 401, `state after sign-out returned ${status}`);
  });
  await step('nothing was logged as an error in any browser tab', async () => {
    expect(browserErrors.length === 0, browserErrors.join('\n'));
  });
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  await github.close();
  await rm(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
if (failed.length) console.log('\nServer log (tail):\n' + serverLog.split('\n').slice(-25).join('\n'));
process.exit(failed.length ? 1 : 0);
