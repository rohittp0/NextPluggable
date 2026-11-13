// End-to-end test: drives the example site in a real browser the way a site
// owner would, against a mock GitHub API.
//
//   pnpm build && pnpm e2e            (add --no-build to reuse the last `next build`)
//
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_TOKEN, startMockGitHub } from './mock-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'examples/site');
const nextBin = path.join(site, 'node_modules/next/dist/bin/next');
const PASSWORD = 'e2e-password';

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
const port = await freePort();
const base = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXTPLUGGABLE_PASSWORD: PASSWORD,
  NEXTPLUGGABLE_SECRET: 'e2e-secret-0123456789abcdef',
  NEXTPLUGGABLE_DATA_DIR: dataDir,
  NEXTPLUGGABLE_GITHUB_API_URL: github.url,
  NEXT_PUBLIC_SITE_URL: base,
  NEXT_TELEMETRY_DISABLED: '1',
};

if (!process.argv.includes('--no-build')) {
  console.log('Building the example site…');
  const built = spawnSync(process.execPath, [nextBin, 'build'], { cwd: site, env, stdio: ['ignore', 'ignore', 'inherit'] });
  if (built.status !== 0) process.exit(1);
}

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
    await page.waitForSelector('#np-source-error:has-text("does not look like a GitHub repository address")');
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
    await page.click('button:has-text("Update to 1.0.1")');
    await toast('EMI Calculator was updated to version 1.0.1.');
    await page.waitForSelector('.np-row:has-text("EMI Calculator") >> text=v1.0.1');
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
