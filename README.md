# NextPluggable

WordPress-style plugins for Next.js. Add one package to a site and its owner gets a
dashboard where they connect GitHub repositories that hold plugins, then install,
configure, update and remove those plugins themselves: no developer, no rebuild, no
redeploy.

Plugins are full features, not UI snippets. One plugin can add server-rendered pages
that search engines index, HTTP endpoints, stored data, widgets in the site's layout,
a settings form, and its own screens inside the dashboard.

> **Status: working prototype.** Everything described here is
> implemented and covered by tests in this repository. See [Limits](#limits) before
> relying on it, and [docs/research.md](docs/research.md) for why it is built this way.

**Documentation: <https://rohittp0.github.io/NextPluggable/>.** Each guide also exists
as Markdown written for coding agents: give yours
[`integrate.md`](https://rohittp0.github.io/NextPluggable/integrate.md) to add
NextPluggable to a site, or
[`build.md`](https://rohittp0.github.io/NextPluggable/build.md) to write plugins.

## What the site owner does

1. Opens `/admin/plugins` and signs in.
2. Pastes the address of a GitHub repository under **Sources**. For a private
   repository, the dashboard walks them through creating a read-only access token.
3. Picks a plugin under **Add plugins**. A confirmation lists, in plain language, what
   it adds and what it is allowed to do.
4. The plugin is live about a second later. Its settings are an ordinary form; the
   address of each page it adds can be changed; it can be paused, updated or removed
   with one click.

## What the developer does, once

```bash
npm install nextpluggable
npx nextpluggable init
```

`init` adds four small files to an App Router project and never overwrites existing
ones:

| File | Purpose |
|---|---|
| `lib/nextpluggable.ts` | Settings: sign-in, storage, site name |
| `app/admin/plugins/[[...np]]/page.tsx` | The dashboard |
| `app/api/nextpluggable/[...np]/route.ts` | The dashboard's API, plugin files, and plugins' own endpoints |
| `app/[...slug]/page.tsx` | Serves the pages plugins add. Your own routes always win; unknown addresses still get your 404 page. Optional page caching is two commented lines in this file |

It also writes a generated dashboard password and secret to `.env.local`.

If the site already has a root catch-all route, `init` leaves it alone. Serve plugin
pages from it yourself: render `<np.PluginPage params={params} />` where your own lookup
finds nothing, or, when that route never returns a 404 (a landing page for any address,
say), ask first:

```tsx
if (await np.hasPluginPage(`/${segments.join('/')}`)) return <np.PluginPage params={params} />;
```

Optionally, mark places in your layout that plugins may fill:

```tsx
import { np } from '@/lib/nextpluggable';

<nav>
  …
  <np.Slot name="header.actions" />
</nav>
…
<np.Slot name="body.end" />
```

### Settings

```ts
import { createNextPluggable, customAuth, upstashStorage } from 'nextpluggable';

export const np = createNextPluggable({
  siteName: 'Harbor Lending',
  // Who may use the dashboard. Default: one password from NEXTPLUGGABLE_PASSWORD.
  auth: customAuth({
    getUser: async (request) => {
      const session = await getSessionSomehow(request); // Auth.js, Clerk, your own…
      return session?.role === 'admin' ? { id: session.userId, name: session.name } : null;
    },
    loginUrl: '/login',
  }),
  // Where data lives. Default: a .nextpluggable folder.
  storage: upstashStorage(),
});
```

| Storage | Use it when |
|---|---|
| `fileStorage()` (default) | Local development, or one long-running server with a disk. Set `NEXTPLUGGABLE_DATA_DIR` to choose the folder |
| `postgresStorage({ query })` | You already have Postgres. Pass your client's query function, e.g. `(text, params) => pool.query(text, params)` |
| `upstashStorage()` | Serverless hosts such as Vercel. Reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` |
| `memoryStorage()` | Tests |

| Environment variable | Meaning |
|---|---|
| `NEXTPLUGGABLE_PASSWORD` | Dashboard password (when using the default sign-in) |
| `NEXTPLUGGABLE_SECRET` | Signs sessions and encrypts stored secrets. Required in production |
| `NEXT_PUBLIC_SITE_URL` | Public address of the site, used for canonical links |
| `NEXTPLUGGABLE_GITHUB_TOKEN` | Optional token used for every GitHub source that has none of its own; also lifts GitHub's limit of 60 requests an hour |

## Writing plugins

A plugin is a folder with a manifest, React components and optional server code:

```
my-plugin/
  plugin.json      what it adds, its settings form, what it may do
  src/client.tsx   React components: pages, layout widgets, dashboard screens
  src/server.ts    page loaders (data + SEO metadata) and HTTP endpoints
  dist/            built output, committed
```

```bash
npm install --save-dev @nextpluggable/plugin esbuild
npx nextpluggable-plugin build
```

A repository can hold one plugin at its root, or several listed in a root
`nextpluggable.json`. Hosts install straight from the repository at an exact commit.
The full guide is in [docs/build.md](docs/build.md).

This repository is itself a plugin source with two reference plugins:

| Plugin | Shows |
|---|---|
| [EMI Calculator](plugins/emi-calculator) | A standalone tool: one server-rendered, interactive page with a dozen settings. 5 kB of JavaScript |
| [Enquiry Form](plugins/enquiry-form) | A full-stack feature: a page, a public endpoint with validation, stored data, a floating button on every page, an inbox inside the dashboard, and an encrypted webhook setting |

## How it works

- **Loading.** A plugin ships prebuilt bundles that leave React to the host. When a
  plugin page is requested, the site server-renders the plugin's component inside the
  page using its own React, then the browser loads the same bundle as a normal script
  and hydrates. Plugin code is never part of the site's build.
- **SEO.** Plugin pages are real server-rendered HTML with their own title,
  description, canonical link, Open Graph tags and structured data. Addresses no plugin
  owns return a real 404.
- **Speed and cost.** Sharing the site's React keeps plugin bundles small (the EMI
  calculator is 5 kB). By default plugin pages are rendered on each request, which is
  always correct. They can instead be cached like static pages and refreshed the moment
  anything changes in the dashboard; see [Caching plugin pages](#caching-plugin-pages).
- **Safety net.** A plugin that crashes while rendering is contained: a broken widget
  disappears and a broken page shows a short message, while the rest of the site, and
  the dashboard needed to remove it, keep working. A plugin that fails to start is not
  installed, and a failed update leaves the working version in place.

## Caching plugin pages

Uncommenting two lines in the generated `app/[...slug]/page.tsx` makes Next.js render
each plugin page once and serve it from its cache until something changes in the
dashboard:

```ts
export const generateStaticParams = async () => [];
export const revalidate = 3600;
```

This is the cheapest way to run, and worth doing on sites that are mostly public
content. Two things to know first, both measured on Next.js 16.4:

- **Your root layout must not read `cookies()` or `headers()` on the server.** If it
  does, cached plugin pages and unknown addresses fail with a 500 error in production
  builds. It does not show up in `next dev`, so check with `next build && next start`.
- **Next.js stores the address of the request that first generated a cached page,
  query string included, in that page's inline data**, and serves it to later
  visitors. This is how Next.js caches any on-demand page, not something specific to
  plugins. If links to your site can carry private values in the query string, leave
  caching off.

Do not use `export const dynamic = 'force-static'` for this route: with it, a
component that reads the query string has the first visitor's value rendered into the
page everyone receives.

Whatever the mode, plugin components never render the query string on the server: the
SDK only makes it available in the browser.

## Security

- **Plugins are trusted code.** A plugin's server code runs inside your site and can do
  anything your site can, exactly like a WordPress plugin or an npm package. There is
  no sandbox yet. Connect only sources you trust.
- What protects you today: only sources the owner connects are used; every install is
  pinned to an exact commit; every file is checked against the fingerprint recorded
  when the plugin was built; the install dialog states what the plugin does.
- The dashboard requires a sign-in for everything. Sessions are signed, http-only
  cookies. Writes are protected against cross-site request forgery. Repeated wrong
  passwords are slowed down.
- Access tokens and secret settings are encrypted at rest and never sent back to the
  browser. Settings marked server-only never reach public pages.
- Folder-based sources (for plugin development) are off in production.

## Limits

- **Next.js Cache Components mode is not supported yet.** With `cacheComponents: true`
  the build fails. This is the first item on the roadmap because Next.js plans to make
  that mode the default in version 17.
- **Node.js runtime only**, 20.16 or newer. It does not run on Cloudflare Workers or
  other runtimes that forbid evaluating code.
- **Serverless hosts need a database adapter**; the default file storage needs a disk.
- **Several server instances:** a dashboard change reaches the other instances'
  in-memory plugin list within about five seconds, and cached pages rely on your host
  propagating Next.js revalidation. This has been tested on a single instance only.
- **Do not put a `loading.tsx` above the catch-all route** while it is uncached (the
  default). Next.js would start streaming before the plugin lookup finishes, and
  unknown addresses would return 200 with `noindex` instead of a 404. With caching
  switched on they return a real 404 either way.
- **Plugins cannot read the query string on the server.** Pages that vary for search
  engines should use address segments (`/shop/page/2`); filters and searches read the
  query in the browser.
- **Plugin UI is React**, and plugins cannot use Next.js-only features such as server
  components or server actions.
- **Plugin storage is a simple key-value store**: fine for settings, messages and small
  catalogues, not yet for large or heavily queried data.

## Roadmap

1. Cache Components support.
2. One-click GitHub connection for private repositories (a GitHub App created from the
   dashboard) in place of pasted tokens.
3. Sandboxed execution of plugin server code, with the permissions list enforced.
4. A shopping cart reference plugin, and richer storage (collections with queries).
5. A second host adapter (Astro) on the same plugin format.

## Repository

| Path | Contents |
|---|---|
| `packages/nextpluggable` | The package sites install: dashboard, sign-in, storage, GitHub sources, installer, runtime |
| `packages/plugin` | `@nextpluggable/plugin`: the SDK and build tool for plugin authors |
| `plugins/` | Reference plugins, with their built `dist/` committed |
| `e2e/` | Browser test of the whole owner journey against a mock GitHub API, and the small Next.js site (`e2e/site`) it runs against |
| `docs/` | The documentation site, served by GitHub Pages: the guides ([integrate](docs/integrate.md), [build plugins](docs/build.md)) and [research and decisions](docs/research.md) |
| `scripts/` | The release version script and the documentation site generator |

### Checks

```bash
pnpm build        # packages, then plugins
pnpm typecheck
pnpm test         # unit tests; set TEST_POSTGRES_URL to include the Postgres adapter
pnpm e2e          # browser test, run twice (pages uncached, then cached); needs Playwright with Chromium
```

Rebuilding the plugins must leave `plugins/*/dist` unchanged: builds are reproducible,
and the committed output is what sites install.

### Documentation site

GitHub Pages serves the `docs/` folder as it is. The guides are written once, as
`docs/integrate.md` and `docs/build.md`: those files are what coding agents read, and
`pnpm docs:build` renders them to the HTML pages people read. Commit the generated
pages with the Markdown change; `pnpm test` fails when they are out of date. Changes
under `docs/` do not publish a release.

### Releases

Every merge to `main` publishes `nextpluggable` and `@nextpluggable/plugin` to npm
under one shared version ([`release.yml`](.github/workflows/release.yml)), tags the
commit and creates a GitHub release. The patch number goes up by one each time. For a
minor or major release, set the new version in both `packages/*/package.json` files in
the pull request; it is published as it is, and patch releases continue from there.

No npm token is stored in the repository. npm lets the workflow publish because each
package names it as its [trusted publisher](https://docs.npmjs.com/trusted-publishers),
which can only be set up once a package exists. So there is a one-time setup:

1. Publish the first version by hand, signed in to npm as yourself:

   ```bash
   pnpm install && pnpm build
   (cd packages/plugin && pnpm publish --access public --no-git-checks)
   (cd packages/nextpluggable && pnpm publish --access public --no-git-checks)
   ```

2. On npmjs.com, open each package's settings and add a trusted publisher: GitHub
   Actions, user `rohittp0`, repository `NextPluggable`, workflow `release.yml`, with
   `npm publish` allowed.
3. Merge to `main` within two days. npm drops a trusted publisher that has not
   published by then.
