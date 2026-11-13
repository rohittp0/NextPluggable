# Integrate NextPluggable into a Next.js site

NextPluggable gives a Next.js site a plugin dashboard. The site's owner connects GitHub
repositories that hold plugins, then installs, configures, updates and removes those
plugins from the dashboard, with no rebuild and no redeploy. This guide adds it to an
existing site. It is a one-time job for a developer.

> **For AI agents.** This page is the complete instruction set for this task. Work
> through the numbered steps in order and run the check at the end of each one before
> moving on. Do not invent API names: everything the package exports is listed here.
> Never commit the dashboard password or secret, and never print them in your summary.
> If the site has an unusual setup that this page does not cover, stop and ask the
> person instead of guessing.

## What gets added

| Piece | Where | What it does |
|---|---|---|
| Setup module | `lib/nextpluggable.ts` | One `createNextPluggable()` call: sign-in, storage, site name |
| Dashboard | `app/admin/plugins/[[...np]]/page.tsx` | The screen the owner uses, at `/admin/plugins` |
| API route | `app/api/nextpluggable/[...np]/route.ts` | The dashboard's API, plugin files, and plugins' own endpoints |
| Plugin pages | `app/[...slug]/page.tsx` | Serves the pages plugins add. Your own routes always win |
| Slots (optional) | Your layout | Named places plugins may fill, such as a floating button |

Plugins are not part of your build. A plugin ships prebuilt bundles; the site stores
them, server-renders the plugin's React components with its own React, and hydrates
them in the browser.

## Before you start

Check each of these. Stop if one fails.

- **Next.js 15 or newer, using the App Router**, with React 19. There must be an `app`
  or `src/app` directory.
- **Node.js runtime, 20.16 or newer.** It does not run on the Edge runtime or on
  Cloudflare Workers, because it evaluates plugin code at runtime.
- **`cacheComponents` is off.** With `cacheComponents: true` in `next.config`, the
  build fails. This mode is not supported yet.
- **You know where data will live.** A long-running server with a disk can use the
  default file storage. A serverless host such as Vercel has a read-only disk and
  needs a database adapter ([step 4](#4-choose-where-data-lives)).

Then look for three things that change the steps below, and note what you find:

1. **A catch-all route at the top of `app`** (a folder named `[...something]` or
   `[[...something]]`, directly in `app` or under a dynamic segment such as
   `app/[locale]`). If there is one, plugin pages are served from it
   ([step 7](#7-serve-plugin-pages)).
2. **Middleware that rewrites or redirects every path**, typically for locales. The
   dashboard must be excluded from it ([step 9](#9-sites-with-locale-routing-or-other-middleware)).
3. **A root layout that does not render `<html>`** (a pass-through that leaves it to a
   nested layout). The dashboard then needs a layout of its own (step 9).

## 1. Install the package

```bash
npm install nextpluggable@latest
```

Use the site's own package manager: `pnpm add nextpluggable@latest` or
`yarn add nextpluggable@latest`.

**Check:** `nextpluggable` is listed under `dependencies` in `package.json`.

## 2. Run the setup command

From the project root:

```bash
npx nextpluggable@latest init
```

It creates the four files in the table above and never overwrites a file that already
exists. It also:

- appends `NEXTPLUGGABLE_PASSWORD` and `NEXTPLUGGABLE_SECRET` to `.env.local`, with
  generated values, unless they are already there;
- adds `.nextpluggable/` to `.gitignore`;
- skips the plugin-pages route and prints a note if the site already has a root
  catch-all.

In a JavaScript project the files are `.js` and `.jsx`. With a `src/app` directory the
setup module goes to `src/lib/nextpluggable.ts`.

The command only notices a catch-all that sits directly in `app`. If the site's
catch-all is deeper, such as `app/[locale]/[[...route]]`, the generated
`app/[...slug]/page.tsx` would never be reached: delete it and serve plugin pages from
the existing route ([step 7](#7-serve-plugin-pages)).

If you cannot run the command, create the files by hand. These are their full contents:

```ts
// lib/nextpluggable.ts
import { createNextPluggable } from 'nextpluggable';

export const np = createNextPluggable({
  siteName: 'My site',
});
```

```ts
// app/api/nextpluggable/[...np]/route.ts
import { np } from '@/lib/nextpluggable';

export const { GET, POST, PUT, PATCH, DELETE } = np.handlers;
```

```tsx
// app/admin/plugins/[[...np]]/page.tsx
import { np } from '@/lib/nextpluggable';

export const metadata = np.dashboardMetadata;
export default np.DashboardPage;
```

```tsx
// app/[...slug]/page.tsx
import { np } from '@/lib/nextpluggable';

export const generateMetadata = np.generatePluginMetadata;
export default np.PluginPage;
```

Adjust the import path if the project has no `@/` alias.

**Check:** the four files exist (three, if the site has its own catch-all), and
`.env.local` holds both variables. Confirm `.env.local` is ignored by git.

## 3. Set the environment variables

| Variable | Required | Meaning |
|---|---|---|
| `NEXTPLUGGABLE_PASSWORD` | Yes, with the default sign-in | The dashboard password |
| `NEXTPLUGGABLE_SECRET` | In production | Signs sessions and encrypts stored secrets. At least 16 characters; use `openssl rand -base64 32`. Changing it signs everyone out and makes saved access tokens unreadable |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Public address of the site, such as `https://example.com`. Used for canonical links and to recognise the site's own requests behind a proxy |
| `NEXTPLUGGABLE_GITHUB_TOKEN` | Optional | A GitHub token used for every source that has none of its own. Also lifts GitHub's limit of 60 requests an hour |
| `NEXTPLUGGABLE_DATA_DIR` | Optional | Folder for the default file storage. Default: `.nextpluggable` in the project root |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | With `upstashStorage()` | Upstash Redis REST credentials. `KV_REST_API_URL` and `KV_REST_API_TOKEN` are read as well |

In development a missing secret is replaced by an insecure placeholder, with a warning.
In production a missing secret is an error, and the dashboard says so.

Set the same variables on the host before deploying. Add them, without values, to the
project's `.env.example` if it has one.

**Check:** the production environment has a password and a secret that differ from the
development ones.

## 4. Choose where data lives

Everything NextPluggable stores (connected sources, installed plugins, their bundles,
settings and plugin data) goes through one storage adapter.

| Adapter | Use it when |
|---|---|
| `fileStorage()` (default) | Local development, or one long-running server with a persistent disk |
| `upstashStorage()` | Serverless hosts such as Vercel. Needs no extra dependency |
| `postgresStorage({ query })` | The site already has Postgres |
| `memoryStorage()` | Tests only. Data is lost on restart |

```ts
// lib/nextpluggable.ts
import { createNextPluggable, postgresStorage, upstashStorage } from 'nextpluggable';

// Upstash Redis: reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
export const np = createNextPluggable({
  siteName: 'My site',
  storage: upstashStorage(),
});

// Or Postgres, with whatever client the site already uses.
// The table (default "nextpluggable_kv") is created automatically.
// storage: postgresStorage({ query: (text, params) => pool.query(text, params) }),
```

A common pattern is the database in production and files in development:

```ts
const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

export const np = createNextPluggable({
  siteName: 'My site',
  storage: hasUpstash ? upstashStorage() : undefined, // undefined means fileStorage()
});
```

**Check:** on a serverless host, the adapter is not the default file storage. With file
storage on such a host, installing a plugin fails with a read-only file system error.

## 5. Choose who can sign in

The default is one shared password, read from `NEXTPLUGGABLE_PASSWORD`. Sessions are
signed, http-only cookies that last 7 days. Repeated wrong passwords are slowed down.

To use the site's own login instead, pass `customAuth`. `getUser` receives the incoming
request, with the visitor's cookies and headers, and returns the administrator or
`null`:

```ts
import { createNextPluggable, customAuth } from 'nextpluggable';

export const np = createNextPluggable({
  siteName: 'My site',
  auth: customAuth({
    getUser: async (request) => {
      const session = await getSessionSomehow(request); // Auth.js, Clerk, your own
      return session?.role === 'admin' ? { id: session.userId, name: session.name } : null;
    },
    loginUrl: '/login', // where the dashboard sends people who are not signed in
  }),
});
```

`getUser` is the only gate on the dashboard, so it must return a user only for people
who may install code on the site.

**Check:** someone who is not an administrator cannot open the dashboard.

## 6. Add slots to the layout

A slot is a named place in your layout where an installed plugin may render something:
a cart button, a chat bubble, a banner. A slot renders nothing while no plugin fills it,
and a slot that fails is left out rather than breaking the page.

```tsx
// app/layout.tsx
import { np } from '@/lib/nextpluggable';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            {/* your links */}
            <np.Slot name="header.actions" />
          </nav>
        </header>
        {children}
        <footer>
          <np.Slot name="footer" />
        </footer>
        <np.Slot name="body.end" />
      </body>
    </html>
  );
}
```

`np.Slot` is an async server component. The conventional names are `header.actions`,
`footer` and `body.end`; plugins are written against them, so use those names where
they fit. Slots are optional, but without `body.end` plugins that add floating widgets
have nowhere to appear.

If the layout wraps the page in client providers, put the slot inside them so plugin
widgets share the same context as the rest of the page.

**Check:** the site still builds, and pages that were statically generated before are
still statically generated (compare the route table printed by `next build`).

## 7. Serve plugin pages

### The site has no root catch-all

The generated `app/[...slug]/page.tsx` handles it. Addresses that your own routes do
not handle land there. An installed plugin answers for the pages it adds, and every
other address gets your normal 404 page.

### The site already has a catch-all that returns 404 for unknown addresses

Render `np.PluginPage` where your own lookup finds nothing. It renders the plugin page
that owns the address, or triggers your 404 when none does.

```tsx
// app/[...slug]/page.tsx
import { np } from '@/lib/nextpluggable';

export async function generateMetadata(props: { params: Promise<{ slug: string[] }> }) {
  const page = await findMyPage((await props.params).slug);
  return page ? { title: page.title } : np.generatePluginMetadata(props);
}

export default async function Page(props: { params: Promise<{ slug: string[] }> }) {
  const page = await findMyPage((await props.params).slug);
  if (page) return <MyPage page={page} />;
  return <np.PluginPage params={props.params} />;
}
```

`PluginPage` takes the route's own `params` and reads the address from its catch-all
segment, whatever that segment is called. Other params, such as a `locale`, are
ignored.

### The site's catch-all never returns 404

Some catch-alls render something for every address, a landing page for any city name,
say. Ask first, then decide:

```tsx
import { np } from '@/lib/nextpluggable';

/** Never throws: a storage outage must not take the rest of the route down. */
async function pluginOwns(segments: string[]): Promise<boolean> {
  if (segments.length === 0) return false;
  try {
    return await np.hasPluginPage(`/${segments.join('/')}`);
  } catch (error) {
    console.error('Plugin page lookup failed:', error);
    return false;
  }
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const segments = (await props.params).slug ?? [];
  const mine = await findMyPage(segments);
  if (mine) return <MyPage page={mine} />;
  if (await pluginOwns(segments)) return <np.PluginPage params={props.params} />;
  return <FallbackPage segments={segments} />;
}
```

Do the same in `generateMetadata`, returning `np.generatePluginMetadata(props)` when a
plugin owns the address. Check your own pages before plugins, so a plugin can never
take over an address the site depends on.

### Caching plugin pages (optional)

By default plugin pages are rendered on each request, which is always correct. Adding
two lines to the generated route makes Next.js render each plugin page once and serve
it from its cache until something changes in the dashboard:

```ts
export const generateStaticParams = async () => [];
export const revalidate = 3600;
```

Only do this when both of these hold:

- **The root layout does not read `cookies()` or `headers()` on the server.** If it
  does, cached plugin pages and unknown addresses fail with a 500 error in production
  builds. It does not show in `next dev`, so check with `next build && next start`.
- **Links to the site never carry private values in the query string.** Next.js stores
  the address of the request that first generated a cached page, query string
  included, in that page's inline data, and serves it to later visitors.

Do not use `export const dynamic = 'force-static'` for this route.

**Check:** after installing a plugin with a page ([step 10](#10-verify)), its address
returns 200, and an address nobody owns still returns what it returned before.

## 8. Give plugins the site's look

**Colours.** Plugins take their colours from five CSS custom properties and fall back
to neutral defaults when the site sets none. Set them once, in the global stylesheet,
to the site's own values:

```css
:root {
  --np-accent: #f57f2e; /* the brand colour: buttons, links, highlights */
  --np-text: #111827; /* body text */
  --np-muted: #6b7280; /* secondary text */
  --np-border: #e5e7eb; /* lines and input borders */
  --np-surface: #ffffff; /* the background of cards and inputs */
}
```

Plugins inherit the site's font. A plugin may still offer a colour setting of its own;
when the owner fills it in, their choice wins over `--np-accent`.

**Header and footer.** A plugin page renders inside the layouts of the route that
serves it, and nothing else. If the header and footer are in the root layout, plugin
pages have them already. If each page renders its own, or they come from a layout the
catch-all route is outside of, wrap `np.PluginPage` in the same frame the site's other
pages use:

```tsx
// app/[...slug]/page.tsx
import { np } from '@/lib/nextpluggable';
import SiteFrame from '@/components/site-frame'; // your header, <main>, and footer

export const generateMetadata = np.generatePluginMetadata;

export default function Page(props: { params: Promise<{ slug: string[] }> }) {
  return (
    <SiteFrame>
      <np.PluginPage params={props.params} />
    </SiteFrame>
  );
}
```

An address no plugin owns still gets the site's 404 page, not an empty frame.

**Check:** a plugin page has the site's header and footer, its text uses the site's
font, and its buttons use the brand colour.

## 9. Sites with locale routing or other middleware

Skip this step if the site has no middleware and its root layout renders `<html>`.

**Keep the dashboard out of locale middleware.** The dashboard lives at one fixed
address. Middleware that prefixes or rewrites paths (next-intl and similar) would send
`/admin/plugins` to `/en/admin/plugins`, which the site's own pages then answer.
Exclude the dashboard path the same way the site already excludes other paths:

```ts
// middleware.ts
export const config = {
  matcher: ['/((?!api|admin|_next|.*\\..*).*)'],
};
```

The API route lives under `/api`, which such matchers normally exclude already. Confirm
that it does: the dashboard cannot work if `/api/nextpluggable` is rewritten.

**Keep the dashboard outside the locale segment.** Its file belongs at
`app/admin/plugins/[[...np]]/page.tsx`, not under `app/[locale]`.

**Give the dashboard its own `<html>` if the root layout has none.** When `<html>` and
`<body>` are rendered by a nested layout, such as `app/[locale]/layout.tsx`, routes
outside it have neither:

```tsx
// app/admin/layout.tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**Plugin pages under a locale segment.** If the catch-all is
`app/[locale]/[[...route]]/page.tsx`, pass its `params` to `np.PluginPage` unchanged.
The plugin page is matched on the `route` part alone, so `/contact` and `/it/contact`
both show the plugin's `/contact` page inside the right locale's layout. Its canonical
link points at the address without the locale.

To move the dashboard or the API to other addresses, set `dashboardPath` and `apiPath`
in the settings and move the two files to match.

**Check:** `/admin/plugins` returns the dashboard, not a redirect and not one of the
site's own pages, including for a browser whose language is not the default locale.

## 10. Verify

Run the site the way it runs in production. Some problems do not appear in `next dev`.

```bash
npm run build
npm run start
```

With the server on port 3000:

```bash
# The API answers and nobody is signed in: 200, and "user":null
curl -s http://localhost:3000/api/nextpluggable/session

# The dashboard's data is private: 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/nextpluggable/admin/state

# The dashboard renders: 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/plugins
```

Then, in a browser:

1. Open `/admin/plugins` and sign in.
2. Under **Sources**, connect `https://github.com/rohittp0/NextPluggable`. It offers two
   reference plugins.
3. Under **Add plugins**, install **EMI Calculator**. Open `/emi-calculator`: the
   calculator renders inside the site's own layout and reacts to input.
4. Install **Enquiry Form**. If the layout has a `body.end` slot, a floating button
   appears on the site's pages.
5. Pause or remove both plugins. Their pages and widgets disappear.

Last, compare the route table from `next build` with the one from before the change.
Routes that were static should still be static.

## 11. Deploy

- Set `NEXTPLUGGABLE_PASSWORD`, `NEXTPLUGGABLE_SECRET` and the storage credentials on
  the host. The build needs the storage credentials too if static pages render a slot.
- On a serverless host, use `upstashStorage()` or `postgresStorage()`.
- Behind a proxy that rewrites the host, set `NEXT_PUBLIC_SITE_URL` (or `siteUrl`) to
  the public address. Otherwise the dashboard's writes are rejected as coming from
  another site.
- With several server instances, a change made in the dashboard reaches the other
  instances' in-memory plugin list within about five seconds (`cacheTtlMs`), and cached
  pages rely on the host propagating Next.js revalidation.

When anything changes in the dashboard, NextPluggable calls
`revalidatePath('/', 'layout')`, so every cached page of the site is regenerated on its
next visit. That is how a widget appears on pages that were built statically.

## Settings reference

Everything `createNextPluggable()` accepts. All of it is optional.

| Option | Default | Meaning |
|---|---|---|
| `siteName` | `'Your site'` | Shown in the dashboard header |
| `auth` | `passwordAuth()` | Who may use the dashboard: `passwordAuth({ password, sessionDays, cookieName })` or `customAuth({ getUser, loginUrl })` |
| `storage` | `fileStorage()` | Where data lives: `fileStorage({ dir })`, `upstashStorage({ url, token, prefix })`, `postgresStorage({ query, table })`, `memoryStorage()` |
| `secret` | `NEXTPLUGGABLE_SECRET` | Signs sessions and encrypts stored secrets |
| `siteUrl` | `NEXT_PUBLIC_SITE_URL`, then the host's own address | Public origin of the site |
| `dashboardPath` | `/admin/plugins` | Must match where the dashboard page file is |
| `apiPath` | `/api/nextpluggable` | Must match where the route handler file is |
| `github` | | `{ token, apiUrl }`. `apiUrl` is for GitHub Enterprise |
| `allowLocalSources` | Only outside production | Lets a folder on the server be connected as a source, for plugin development. `NEXTPLUGGABLE_ALLOW_LOCAL_SOURCES=1` switches it on in production |
| `cacheTtlMs` | `5000` (`0` in development) | How long the list of installed plugins is kept in memory per server instance |

What the returned `np` object holds:

| Member | Use |
|---|---|
| `np.handlers` | `{ GET, POST, PUT, PATCH, DELETE }` for the API route file |
| `np.DashboardPage`, `np.dashboardMetadata` | The dashboard page and its metadata (`noindex`) |
| `np.PluginPage`, `np.generatePluginMetadata` | The page a plugin adds at the requested address, and its SEO metadata |
| `np.hasPluginPage(pathname)` | Resolves to `true` when a switched-on plugin serves a page at that address. Never triggers a 404 |
| `np.Slot` | `<np.Slot name="…" />`, a place in the layout plugins may fill |

Plugins cannot use `/_next`, `/api`, the dashboard path or the API path as page
addresses. The dashboard refuses them.

## Security

- **Plugins are trusted code.** A plugin's server code runs inside the site and can do
  anything the site can, like a WordPress plugin or an npm package. There is no
  sandbox. The owner should connect only sources they trust.
- Only sources the owner connects are used. Every install is pinned to an exact commit,
  and every file is checked against the fingerprint recorded when the plugin was built.
- The dashboard needs a sign-in for everything. Writes are protected against cross-site
  request forgery.
- Access tokens and secret settings are encrypted at rest and never sent back to the
  browser.
- Folder sources are off in production.

## Limits

- Next.js Cache Components mode is not supported.
- Node.js runtime only.
- Serverless hosts need a database adapter.
- Do not put a `loading.tsx` above the plugin-pages route while it is uncached. Next.js
  would start streaming before the plugin lookup finishes, and unknown addresses would
  return 200 with `noindex` instead of a 404.
- Plugins cannot read the query string on the server.
- Plugin storage is a simple key-value store: fine for settings, messages and small
  catalogues, not for large or heavily queried data.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The dashboard says setup is incomplete, naming `NEXTPLUGGABLE_SECRET` | No secret in production | Set a secret of at least 16 characters |
| Sign-in answers "No dashboard password has been set up yet" | `NEXTPLUGGABLE_PASSWORD` is empty | Set it and restart |
| "This request was blocked for security reasons" on every change | The request's origin does not match the site, usually behind a proxy | Set `NEXT_PUBLIC_SITE_URL` to the public address |
| `/admin/plugins` redirects, or shows one of the site's own pages | Locale middleware handles the path | Exclude it ([step 9](#9-sites-with-locale-routing-or-other-middleware)) |
| Next.js reports missing `<html>` and `<body>` tags for the dashboard | The root layout is a pass-through | Add `app/admin/layout.tsx` (step 9) |
| Installing fails with a read-only file system error | File storage on a serverless host | Use `upstashStorage()` or `postgresStorage()` |
| "GitHub is limiting requests right now" | The unauthenticated limit of 60 requests an hour | Set `NEXTPLUGGABLE_GITHUB_TOKEN` |
| A plugin is installed but its page shows the site's own content | The site's catch-all answers first | Serve plugin pages from it ([step 7](#7-serve-plugin-pages)) |
| A plugin is installed but paused | A required setting has no value | Fill it in on the plugin's settings screen |
| A plugin's widget does not appear | The layout has no slot with that name | Add `<np.Slot name="body.end" />` |
| A plugin page has no header or footer | The site renders them per page, not in a layout above the catch-all | Wrap `np.PluginPage` in the site's page frame ([step 8](#8-give-plugins-the-sites-look)) |
| Plugins use colours that do not match the site | The site sets none of the `--np-*` properties, or the owner chose a colour in the plugin's settings | Set them in the global stylesheet (step 8), or clear the plugin's colour setting |
| Unknown addresses return 200 instead of 404 | A `loading.tsx` sits above the catch-all | Move it into a route group, or switch on caching |
| Static pages became dynamic after adding a slot | A custom storage adapter calls `fetch` with `cache: 'no-store'` | Read storage without going through the `fetch` wrapper Next.js installs, as `upstashStorage()` does |

## Done when

- [ ] `next build` succeeds, and routes that were static are still static.
- [ ] `/admin/plugins` shows the dashboard and requires a sign-in.
- [ ] A plugin installed from the dashboard serves its page without a rebuild.
- [ ] That page has the site's header, footer, font and brand colour.
- [ ] An address that no page owns behaves as it did before.
- [ ] The password and secret are set on the host and are not in git.
- [ ] On a serverless host, storage is a database adapter.

To write plugins for this site, continue with
[Build plugins](https://rohittp0.github.io/NextPluggable/build.md).
