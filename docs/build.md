# Build plugins for NextPluggable

A plugin is a folder in a GitHub repository. A site that runs NextPluggable installs it
from its dashboard, straight from the repository at an exact commit. Nothing is
published to npm, and the site is not rebuilt.

One plugin can add server-rendered pages that search engines index, HTTP endpoints,
stored data, widgets in the site's layout, a settings form, and screens inside the
dashboard.

> **For AI agents.** This page is the complete instruction set for creating a plugin
> repository and writing plugins in it. Follow the numbered steps in order and run the
> check at the end of each one. Use only the APIs listed here: plugins cannot import
> from `next/*`. When you set up a new repository, also add the block from
> [Add this to CLAUDE.md](#add-this-to-claudemd) to its `CLAUDE.md`, so later sessions
> keep to the same rules.
>
> **Guide revision: 3.** This guide changes as NextPluggable does. If the repository's
> `CLAUDE.md` records an older revision, read
> [Changes to this guide](#changes-to-this-guide) first and bring every plugin in the
> repository in line with what changed, before doing anything else.

## How a plugin reaches a site

1. You write source in `src/` and a manifest, `plugin.json`.
2. `nextpluggable-plugin build` writes `dist/`: the bundles and `dist/build.json`,
   which records the manifest and a fingerprint of every file.
3. You commit `dist/` and push.
4. The site's owner connects the repository under **Sources** in their dashboard and
   installs the plugin. The site downloads `dist/` at that commit, checks every file
   against its fingerprint, and the plugin is live about a second later.
5. When you push a new build, the dashboard offers it as an update.

## Requirements

- Node.js 20.16 or newer.
- A GitHub repository, public or private.
- React knowledge. Plugin UI is React client components.

## 1. Create the repository

Use this layout for a new repository. It holds any number of plugins.

```
acme-plugins/
  nextpluggable.json      lists the plugin folders
  package.json
  tsconfig.json
  plugin-env.d.ts         lets TypeScript accept CSS and image imports
  plugins/
    hello/
      plugin.json         the manifest
      src/client.tsx      React components: pages, widgets, dashboard screens
      src/server.ts       optional: page loaders and HTTP endpoints
      src/style.css       optional: imported from client.tsx
      dist/               build output. Commit it
```

`nextpluggable.json` names the repository and lists every plugin folder:

```json
{
  "name": "Acme plugins",
  "description": "Plugins maintained by Acme.",
  "plugins": ["plugins/hello"]
}
```

`package.json`:

```json
{
  "name": "acme-plugins",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nextpluggable-plugin build plugins/hello",
    "validate": "nextpluggable-plugin validate plugins/hello",
    "typecheck": "tsc --noEmit"
  }
}
```

When you add a plugin, add its folder to `nextpluggable.json` and to both scripts:
`nextpluggable-plugin build plugins/hello && nextpluggable-plugin build plugins/cart`.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["plugins/*/src", "plugin-env.d.ts"]
}
```

`plugin-env.d.ts`:

```ts
// Asset imports understood by `nextpluggable-plugin build`.
declare module '*.css';
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
```

`.gitignore` must ignore `node_modules/` and must **not** ignore `dist/`.

A repository with exactly one plugin may instead keep `plugin.json`, `src/` and `dist/`
at its root, with no `nextpluggable.json`. The build commands then take no folder.

**Check:** the files above exist, and `dist` appears nowhere in `.gitignore`.

## 2. Install the SDK

```bash
npm install --save-dev @nextpluggable/plugin@latest esbuild react @types/react typescript
```

`@nextpluggable/plugin` is the SDK and the build tool. `esbuild` does the bundling.
`react` is needed for types and is never bundled into a plugin. Add `@types/node` if
the server code uses Node built-ins.

**Check:** `npx nextpluggable-plugin` prints its usage.

## 3. Write the manifest

`plugins/hello/plugin.json` says what the plugin adds. Everything the site's owner sees
about the plugin comes from this file.

```json
{
  "manifestVersion": 1,
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "A greeting page with a visitor counter, and a small badge on every page.",
  "author": "Acme",
  "icon": "👋",
  "category": "Examples",

  "pages": [
    {
      "id": "greeting",
      "path": "/hello",
      "component": "HelloPage",
      "title": "Hello",
      "description": "A friendly greeting, and a count of how many times this page has been opened."
    }
  ],
  "slots": [{ "slot": "body.end", "component": "HelloBadge" }],
  "admin": [{ "id": "stats", "title": "Stats", "component": "HelloStats" }],

  "permissions": ["storage"],
  "settings": [
    { "key": "greeting", "label": "Greeting", "type": "text", "default": "Hello there", "required": true },
    { "key": "showBadge", "label": "Show a badge on every page", "type": "toggle", "default": true },
    { "key": "accent", "label": "Accent colour", "type": "color", "placeholder": "Your site's colour", "help": "Leave empty to use your site's own colour." }
  ]
}
```

### Top-level fields

| Field | Required | Rules |
|---|---|---|
| `manifestVersion` | Yes | Always `1` |
| `id` | Yes | 3 to 50 characters: lowercase letters, digits and dashes, starting with a letter and not ending with a dash. Unique across everything a site installs. Changing it makes a different plugin |
| `name` | Yes | At most 80 characters |
| `version` | Yes | `1.2.3`. Shown to the owner |
| `description` | | At most 500 characters. One or two sentences the owner reads before installing |
| `author`, `homepage`, `category` | | Text |
| `icon` | | An emoji, or the path of a `.svg`, `.png`, `.webp` or `.jpg` file inside the plugin folder, 32 kB at most. It is inlined at build time |
| `entry` | | `{ "client": "…", "server": "…" }` to use other entry files than `src/client.*` and `src/server.*` |
| `pages` | | Pages the plugin adds |
| `slots` | | Components to render in named places of the site's layout |
| `admin` | | Screens added as tabs on the plugin's page in the dashboard |
| `settings` | | The settings form |
| `permissions` | | What the plugin does, shown to the owner before install: `storage`, `email`, `fetch:<host>` or `fetch:*`. Declare honestly. Sites display these today and will enforce them once plugins are sandboxed |

### Pages

```json
{ "id": "product", "path": "/shop/:slug", "component": "ProductPage", "title": "Product", "description": "One product." }
```

| Key | Rules |
|---|---|
| `id` | A short identifier: letters, digits and underscores, starting with a letter. The server loader for the page is matched by it |
| `path` | The default address. Starts with `/`, has no trailing slash, and cannot be `/` itself. `:name` matches one segment, and a final `*` matches the rest. Both arrive in `params` |
| `component` | The name of a component exported from the client entry |
| `title` | The default `<title>`, also shown in the dashboard. About 60 characters at most |
| `description` | What search results show under the title, also shown in the dashboard. One or two sentences written for visitors, about 150 characters. The build points out a page without one |
| `configurablePath` | Optional. `false` stops the owner changing the address |

- The owner can change the address of any page with a fixed path. **Never hard-code
  your own addresses.** Read them from `usePlugin().paths` in components and
  `ctx.paths` on the server.
- The site's own routes always win over plugin pages, and two plugins cannot claim the
  same address. `/api`, `/_next` and the dashboard's addresses are reserved.
- The server never sees the query string, because sites may cache plugin pages and
  share them between visitors. Put anything search engines should see in the address
  itself, such as `/shop/page/:n`, and read filters and searches in the browser with
  `useQuery()`.

### Slots

```json
{ "slot": "body.end", "component": "HelloBadge", "order": 10 }
```

A slot component receives no props. The conventional slot names are `header.actions`,
`footer` and `body.end`. A site renders only the slots its developer placed in the
layout, so a widget may not appear on every site. Lower `order` renders first.

### Dashboard screens

```json
{ "id": "stats", "title": "Stats", "component": "HelloStats" }
```

Each entry is a tab on the plugin's page in the dashboard, shown only to the signed-in
owner.

### Settings

Each entry becomes one field of a generated form. Labels and help text are read by a
non-technical person, so write them in plain words.

| `type` | Field | Extra keys |
|---|---|---|
| `text`, `textarea`, `url`, `email` | Text inputs, validated accordingly | `placeholder` |
| `number` | Number input | `min`, `max`, `step` |
| `toggle` | On/off switch | |
| `select` | Dropdown | `options: [{ "value", "label" }]`, required |
| `color` | Colour picker, stored as `#rrggbb` | |
| `secret` | Write-only field for API keys and the like | No `default` allowed |

Common keys: `key` (an identifier, like a page `id`), `label`, `help`, `default`,
`required`, `group` (a section heading), `serverOnly`.

- A `default` must match the type: a number for `number`, `true` or `false` for
  `toggle`, text for everything else.
- `secret` values are encrypted at rest, reach server code only, and are never shown
  again in the dashboard.
- `"serverOnly": true` keeps any other setting away from browsers.
- A plugin with a `required` setting that has no value is installed paused, and
  switches on once the owner fills it in.
- On update, values the owner already entered are kept for settings that still exist.

**Check:** `npx nextpluggable-plugin validate plugins/hello` prints
`✓ Hello 1.0.0 — plugin.json is valid`. On a mistake it lists every problem in words.

## 4. Write the client entry

`src/client.tsx` exports every component the manifest names. They are ordinary React
client components: hooks, state and effects all work.

```tsx
// plugins/hello/src/client.tsx
import { useEffect, useState } from 'react';
import { Link, usePlugin, usePluginApi, usePluginConfig, type PageProps } from '@nextpluggable/plugin';
import './style.css';

interface Config {
  greeting: string;
  showBadge: boolean;
  /** Empty unless the owner chose a colour. The site's own colour applies then. */
  accent?: string;
}

const accent = (color?: string) => (color ? { ['--hello-accent' as string]: color } : undefined);

/** The page at /hello. `data` comes from the server loader. */
export function HelloPage({ data }: PageProps<{ visits: number }>) {
  const config = usePluginConfig<Config>();
  const api = usePluginApi();
  const [visits, setVisits] = useState(data.visits);

  // Counted in the browser: the server-rendered page may be cached and shared.
  useEffect(() => {
    api('/visits', { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { visits: number } | null) => body && setVisits(body.visits))
      .catch(() => {});
  }, [api]);

  return (
    <main className="hello" style={accent(config.accent)}>
      <h1>{config.greeting}</h1>
      <p className="hello-count">This page has been opened {visits} times.</p>
    </main>
  );
}

/** A widget for the `body.end` slot. Slot components receive no props. */
export function HelloBadge() {
  const config = usePluginConfig<Config>();
  const { paths } = usePlugin();
  if (!config.showBadge) return null;
  return (
    <Link href={paths.greeting ?? '/hello'} className="hello-badge" style={accent(config.accent)}>
      {config.greeting}
    </Link>
  );
}

/** A dashboard screen. Only the signed-in owner sees it. */
export function HelloStats() {
  const api = usePluginApi();
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    api('/visits')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { visits: number } | null) => setVisits(body?.visits ?? 0))
      .catch(() => setVisits(0));
  }, [api]);

  return <p className="hello-count">{visits === null ? 'Loading…' : `${visits} visits so far.`}</p>;
}
```

What `@nextpluggable/plugin` provides:

| Export | What it gives you |
|---|---|
| `usePluginConfig<T>()` | The owner's settings, minus secrets and server-only values |
| `usePlugin()` | `{ id, version, apiBase, paths, page }`. `paths` maps your page ids to their current addresses. On a page, `page` is `{ id, path, params }` |
| `usePluginApi()` | `api(path, init)`: a `fetch` bound to your plugin's endpoints. Pass `{ json }` to send a JSON body |
| `useNavigation()` | `{ pathname, push, replace, back }` from the site's router |
| `useQuery()` | The query string as `URLSearchParams`. Browser-only: empty in the server-rendered HTML and on the first render, then it fills in |
| `Link` | A client-side navigation link. Props: `href`, `children`, `className`, `style`, `title` and `aria-label` |
| `PageProps<Data>` | Props of a page component: `data` from the server loader and `params` from the address |

Rules for client code:

- **`react`, `react-dom` and `@nextpluggable/plugin` come from the site and are not
  bundled.** That is why plugin bundles are small and why a plugin shares the site's
  router. Everything else you import is bundled into the plugin.
- **No Next.js imports.** `next/link`, `next/image`, `next/navigation`, server
  components and server actions are not available. Use `Link`, `useNavigation()` and
  plain `<img>`.
- **Components are rendered on the server first, then hydrated.** Do not read `window`,
  `document` or `localStorage` while rendering. Do it in an effect. A component that
  throws on the server is left out of the page and rendered in the browser instead, so
  its content is missing from the HTML search engines read.
- **Images and fonts** imported from the client entry (`.svg`, `.png`, `.jpg`, `.gif`,
  `.webp`, `.woff2`) are inlined as data URLs. Keep them small, or link to hosted
  files.

**Check:** every `component` named in `plugin.json` is exported from the client entry.

## 5. Write the server entry

`src/server.ts` is optional. It runs on the site's server and uses the web-standard
`Request` and `Response`.

```ts
// plugins/hello/src/server.ts
import { adminOnly, definePluginServer, json } from '@nextpluggable/plugin/server';

interface Config {
  greeting: string;
}

export default definePluginServer<Config>({
  // Runs before a page renders: fetch data and describe the page to search engines.
  pages: {
    greeting: async ({ config, storage, site, path }) => ({
      data: { visits: (await storage.get<number>('visits')) ?? 0 },
      metadata: { title: config.greeting, description: 'A friendly greeting.' },
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: config.greeting, url: site.url + path },
    }),
  },

  // HTTP endpoints under the plugin's own base address.
  api: {
    'POST /visits': async ({ storage }) => {
      const visits = ((await storage.get<number>('visits')) ?? 0) + 1;
      await storage.set('visits', visits);
      return json({ visits });
    },
    'GET /visits': adminOnly(async ({ storage }) => json({ visits: (await storage.get<number>('visits')) ?? 0 })),
  },

  onInstall: async ({ storage }) => storage.set('visits', 0),
});
```

The entry must `export default definePluginServer({ … })`.

### Context

Every function receives a context object:

| Key | Meaning |
|---|---|
| `config` | All settings, including secrets and server-only values |
| `storage` | The plugin's private key-value store: `get(key)`, `set(key, value)`, `delete(key)`, `list(prefix)`. Values are JSON, 1 MB each at most. No other plugin can read it |
| `site.url` | The site's public address, such as `https://example.com` |
| `paths` | Current addresses of the plugin's pages, by page id |
| `pluginId` | The plugin's id |
| `log(...)` | Writes to the server log, tagged with the plugin id |
| `path`, `params` | Page loaders: the requested address and its parameters |
| `request`, `path`, `params`, `admin` | Endpoints: the `Request`, the path below the plugin's base, its parameters, and the signed-in dashboard user or `null` |

### Page loaders

`pages` is keyed by page `id`. A loader returns any of:

| Key | Meaning |
|---|---|
| `data` | Passed to the page component as `data`. Must be JSON-serialisable |
| `metadata` | `{ title, description, canonical, image, imageAlt, type, publishedTime, modifiedTime, noindex }`. All optional: see [step 7](#7-get-the-seo-right) |
| `jsonLd` | schema.org structured data: an object or a list of objects |
| `notFound: true` | Respond with the site's 404 page |
| `redirect: '/somewhere'` | Redirect to another address |

A site may cache plugin pages. Write loaders as if their result is shared by every
visitor and kept for a while. Cached pages are refreshed whenever the owner changes
anything in the dashboard, and whenever the owner changes data through one of your
endpoints. Data changed by visitors does not refresh them, so load fast-changing or
per-visitor content from the browser, as the example does with its counter.

### Endpoints

`api` is keyed by `"METHOD /path"`. The methods are `GET`, `POST`, `PUT`, `PATCH` and
`DELETE`, and a path may hold `:name` parameters: `'DELETE /items/:id'`. A handler
returns a `Response`.

- **Endpoints are public unless wrapped in `adminOnly`.** That is what makes form posts
  and third-party webhooks possible, so validate everything a visitor sends.
- Call your endpoints from components with `usePluginApi()`. It knows the base address
  and adds the header that marks the request as coming from the site's own pages.
- For requests that change data, `admin` is only set when the call came through
  `usePluginApi()` from the site itself, so another website cannot act as the signed-in
  owner.
- Helpers from `@nextpluggable/plugin/server`: `json(body, status?, headers?)` builds a
  JSON response, and `readJson<T>(request, maxBytes?)` reads a JSON body, returning
  `null` when it is missing, malformed or too large.

### Sitemap

Pages with a fixed address are listed in the site's sitemap automatically. For a page
with parameters, only the plugin knows which addresses exist, so list them:

```ts
export default definePluginServer({
  // …
  sitemap: async ({ storage, paths }) => {
    const slugs = await storage.list('product/');
    return slugs.map((key) => ({
      path: `/shop/${key.slice('product/'.length)}`,
      lastModified: '2026-11-13', // optional ISO date
    }));
  },
});
```

An entry is a path, or `{ path, lastModified }`. Addresses that are not one of the
plugin's own pages are ignored. Leave out anything a loader would mark `noindex`.

### Lifecycle

`onInstall` runs once, on first install, not on updates. If it throws, or if the server
entry throws while loading, the install is cancelled and the owner is told the plugin
failed to start. `onUninstall` runs before removal. Stored data is kept unless the
owner asks for it to be deleted.

Rules for server code:

- **Do no work when the file loads.** The entry is loaded during the build and again on
  install. Top-level code that throws, or that needs a network or a database, breaks
  both. Do the work inside loaders, handlers and `onInstall`.
- **Only Node built-ins exist at runtime.** Any package you import is bundled into
  `dist/server.js`. Packages that need native binaries or their own files on disk will
  not work.
- **No query string in loaders.** Use address parameters.

**Check:** every key under `pages` matches a page `id` in `plugin.json`, and every key
under `api` looks like `GET /path`.

## 6. Style it

Import CSS from the client entry. It is bundled into `dist/style.css` and loaded with
your components.

```css
/* plugins/hello/src/style.css */
.hello,
.hello-badge {
  /* The site's brand colour, unless the owner picked one in the settings. */
  --hello-accent: var(--np-accent, #4f46e5);
  /* Text on that colour: the site's choice, else white. */
  --hello-on-accent: var(--np-accent-text, #fff);
}
/* Better where the browser can do it: black or white, whichever reads well on the accent. */
@supports (color: oklch(from red l c h)) {
  .hello,
  .hello-badge {
    --hello-on-accent: var(--np-accent-text, oklch(from var(--hello-accent) clamp(0, (0.58 - l) * 1000, 1) 0 0));
  }
}
.hello {
  max-width: 40rem;
  margin: 0 auto;
  padding: 3rem 1rem;
  color: var(--np-text, #0f172a);
}
.hello h1 {
  color: var(--hello-accent);
}
.hello-count {
  color: var(--np-muted, #5b6474);
}
.hello-badge {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  background: var(--hello-accent);
  color: var(--hello-on-accent);
  text-decoration: none;
}
```

**Take your colours from the site.** A site describes its look with six CSS custom
properties. Read them, always with a fallback, because a site may set none of them:

| Property | Use it for |
|---|---|
| `--np-accent` | The site's brand colour: buttons, links, highlights |
| `--np-accent-text` | Text and icons on top of the accent |
| `--np-text` | Body text |
| `--np-muted` | Secondary text |
| `--np-border` | Lines and input borders |
| `--np-surface` | The background of cards and inputs |

- **Do not give a colour setting a `default`.** Leave it empty, fall back to
  `--np-accent` in CSS, and apply the owner's value only when there is one, as the
  example does. A default would override every site's own colour.
- **Never hard-code white text on the accent.** A site's brand colour may be light.
  Use `--np-accent-text`, and fall back to a colour worked out from the accent, as the
  example does. Text must reach a contrast of 4.5 to 1 against what is behind it.
- Inherit the site's fonts. Do not set `font-family`.
- **There is no style isolation.** Prefix every class with something of your own
  (`.hello-…`). Never style bare elements such as `h1` or `button` outside your own
  root class.
- Do not render a header or footer of your own. The site puts its own around your
  page.
- The dashboard sets `--np-text`, `--np-muted`, `--np-border` and `--np-surface` too,
  so dashboard screens match it.

## 7. Get the SEO right

A plugin is responsible for the SEO of everything it adds. The site does the mechanical
part for every plugin page, with no code from you:

| Every page gets | From |
|---|---|
| `<title>` | The loader's `metadata.title`, else the page `title` |
| Meta description | The loader's `metadata.description`, else the page `description`, else the plugin's |
| Canonical link | The page's own address, unless the loader names another |
| Open Graph and Twitter tags | The same title and description, and your `image`, else the site's own sharing image |
| Structured data | Your `jsonLd`, else a plain `WebPage` entry |
| A sitemap entry | Every fixed address that may be indexed, plus what your `sitemap` lists |
| Indexing | Allowed, unless the loader returns `noindex: true` |

That makes a page complete. What makes it good, only you can do. Judge it the way
an audit does: by the HTML the server sends, not by what the page looks like once
scripts have run.

### For search engines

- **Write a `description` for every page in `plugin.json`**, for the visitor who reads it
  in a search result. Not "The page with the form". Return a better one from the loader
  when the content decides it, such as a product's summary.
- **One `<h1>` per page**, saying what the page is. Headings below it in order, with no
  level skipped.
- **Return structured data that fits the content**: `Product`, `Article`, `FAQPage`,
  `ContactPage`, `WebApplication` and so on. It must describe what is visibly on the
  page. The default says only "this is a web page".
- **List pages that have parameters** with [`sitemap`](#sitemap).
- **Mark pages that offer searchers nothing as `noindex`**: thank-you pages, previews,
  empty search results, anything per visitor.
- **One address per piece of content.** When the same content is reachable at two
  addresses, return `canonical` naming the main one.
- **Links are real links**, made with `Link` or `<a href>`, and their text says where
  they go. Not "click here", and never a `<div>` with a click handler.
- For a dated piece of writing, set `type: 'article'` with `publishedTime` and
  `modifiedTime`.

### For AI search

Assistants that answer questions read pages much as a search engine does, and most of
their crawlers do not run JavaScript.

- **Put the content in the server-rendered HTML.** What appears only after a fetch in
  the browser does not exist for them. Render tabs, accordions and "show more" content
  in the HTML and hide it with CSS, not by leaving it out.
- **Say it in words.** A calculator, chart or map should come with a sentence or two
  that states what it does and what the result means. A tool with no text gives a
  machine nothing to quote.
- **Lead with the answer.** Put the fact a visitor came for in the first paragraph
  under the heading, in a full sentence that still makes sense when quoted alone.
- **Use the element that means what you mean**: lists for lists, `<table>` with `<th>`
  for data, `<time datetime>` for dates, `<address>` for contact details.
- Questions and answers go on the page as text, with `FAQPage` structured data.

### For everyone who uses the page

Accessibility and phones are part of the same audit, and the same care.

- **Text reaches a contrast of 4.5 to 1**, including text on the accent colour
  ([step 6](#6-style-it)).
- **Every input has a `<label>`.** Errors are tied to their field with
  `aria-describedby` and announced, not shown by colour alone.
- **Buttons are `<button>`, links are `<a>`.** Everything works from the keyboard, and
  the focused element is visibly outlined.
- **Images have `alt` text, `width` and `height`.** Decorative icons get
  `aria-hidden="true"`. Add `loading="lazy"` below the first screen.
- **Data tables have header cells** (`<th scope="col">`), and a caption or a heading.
- **It fits a phone.** No horizontal scrolling at 320 pixels wide, nothing with a fixed
  width, controls at least 24 pixels across with room between them, and form text of
  16 pixels or more so phones do not zoom in.
- Respect `prefers-reduced-motion`. Never set the page's `lang`: the site does.

### Widgets

A widget is on every page of the site, so it must cost those pages nothing and may
only help them.

- **Never move the page.** Position the widget `fixed` or `absolute`, or give it a size
  that is the same from the first paint. Never insert it above content that is
  already showing.
- **No headings.** Never an `<h1>`, and no `<h2>` to `<h6>` either. The outline of a
  page belongs to the page.
- **Render on the server.** Return the widget's real markup on the first render, not an
  empty box that fills in later.
- **A link is a real link with text that describes it.** A widget that links to your own
  page from every page of the site is good internal linking.
- **Stay small.** The site writes a plugin's stylesheet into the page when it is under
  32 kB, so it is never an extra request the browser waits for. Past that it is. Load
  no web fonts and no third-party scripts when the page loads.
- **No hidden text**, and nothing written for search engines rather than people.
- **Do not cover the page.** On a phone a floating widget stays in a corner, small, and
  clear of the site's own controls.
- Its text meets the same contrast rule as a page's.

**Check:** with the plugin on a site ([step 9](#9-try-it-on-a-site)), run
`npx lighthouse http://localhost:3000/hello --only-categories=seo,accessibility`. SEO
scores 100, and accessibility reports nothing inside your plugin's markup. `curl` the
page: the title, description, canonical link, structured data and the page's main
content are all in the HTML. On another page of the site, the widget causes no layout
shift.

## 8. Build and commit

```bash
npm run build
npm run typecheck
```

The build writes, per plugin:

| File | Contents |
|---|---|
| `dist/client.js` | The components, minified |
| `dist/server.js` | Loaders and endpoints, self-contained |
| `dist/style.css` | Any CSS the client entry imports |
| `dist/build.json` | The manifest, the icon, and a fingerprint of every file |

It stops with a plain message when the manifest names a component the client entry
does not export, when the server entry has a loader for a page that does not exist, or
when an endpoint key is malformed. Lines that start with `!` are advice that does not
stop the build, such as a page with no description for search results. Act on them.
`--no-minify` keeps the client bundle readable.

**Commit `dist/` together with the source change that produced it.** Sites install from
the repository at an exact commit and refuse any file that does not match the
fingerprint in `build.json`. Builds are reproducible: rebuilding without changes leaves
`dist/` untouched.

Sites accept bundles up to 3 MB for `client.js`, 5 MB for `server.js` and 1 MB for
`style.css`.

**Check:** after `npm run build`, `git status` shows `dist/` changes only if the source
or manifest changed. Commit them.

## 9. Try it on a site

A site in development accepts a folder on the same machine as a source.

1. Run a site that has NextPluggable ([integration guide](https://rohittp0.github.io/NextPluggable/integrate.md))
   with `next dev`.
2. Open `/admin/plugins`, sign in, and go to **Sources**.
3. Enter the absolute path of the repository folder and connect it.
4. Under **Add plugins**, install the plugin. Open its page.
5. After each rebuild, press **Check for updates**, then **Update**.

Check these before calling the plugin finished:

- The page's content is in the HTML the server sends (`curl` the address). That is what
  search engines read.
- Lighthouse gives the page an SEO score of 100 ([step 7](#7-get-the-seo-right)).
- The settings form makes sense to someone who has never seen the code.
- The page takes on the site's colours and font, and sits between the site's own
  header and footer.
- The page still works after the owner changes its address in the dashboard.
- Nothing in the browser console reports a hydration mismatch.

## 10. Publish and update

Push the repository to GitHub. The site's owner connects it under **Sources** by
pasting its address. All of these forms work:

| Address | Follows |
|---|---|
| `https://github.com/acme/acme-plugins` or `acme/acme-plugins` | The default branch |
| `https://github.com/acme/acme-plugins/tree/stable` | The branch or tag `stable` |
| `https://github.com/acme/acme-plugins/tree/main/packages/plugins` | A subfolder that holds `nextpluggable.json` or a single plugin |

For a private repository, the owner ticks **This repository is private** and pastes a
read-only access token. The dashboard walks them through creating one.

To release an update:

1. Change the source.
2. Raise `version` in `plugin.json`.
3. Run `npm run build`.
4. Commit source and `dist/` together, and push.

The owner's dashboard offers the update. Their settings and the plugin's stored data
are kept.

**Never change after release:** the plugin `id` (it becomes a different plugin), a page
`id` (the owner's chosen address is lost), or a setting `key` (the owner's value is
lost).

To have CI refuse a stale `dist/`:

```yaml
# .github/workflows/check.yml
name: Check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - name: dist/ must match the source
        run: test -z "$(git status --porcelain)" || (git status --short && exit 1)
```

## Add this to CLAUDE.md

Put this block in the `CLAUDE.md` at the root of the plugin repository. Adjust the
layout lines if the repository holds a single plugin at its root.

```markdown
## NextPluggable plugins

This repository is a NextPluggable plugin source. Sites install plugins straight from
it at an exact commit, using the built files in each plugin's `dist/`.
Full guide: https://rohittp0.github.io/NextPluggable/build.md
Guide revision this repository follows: 3

At the start of every task in this repository, fetch the guide and compare its
"Guide revision" with the number above. If the guide is newer, read its "Changes to
this guide" section, apply every change since the revision above to every plugin
here (rebuild, raise each changed plugin's version, commit `dist/`), replace this
block with the guide's current one, and only then start the task. Read the guide
itself before creating a plugin or changing a manifest.

### Layout

- `nextpluggable.json` lists every plugin folder. A new plugin must be added to it and
  to the `build` and `validate` scripts in `package.json`.
- `plugins/<id>/plugin.json` is the manifest.
- `plugins/<id>/src/client.tsx` exports the React components the manifest names.
- `plugins/<id>/src/server.ts` (optional) default-exports
  `definePluginServer({ pages, api })`.
- `plugins/<id>/dist/` is build output.

### Commands

- `npm run build` rebuilds every plugin's `dist/`.
- `npm run typecheck` type-checks the sources.
- `npm run validate` checks the manifests without building.

### Rules

- After any change under `plugins/<id>/`, source or `plugin.json`, run the build and
  commit `dist/` in the same commit. Never edit `dist/` by hand and never add it to
  `.gitignore`: sites refuse files that do not match `dist/build.json`.
- Raise `version` in `plugin.json` with every change that should reach sites.
- Never change a plugin `id`, a page `id` or a setting `key` after release. Sites key
  installs, page addresses and saved settings on them.
- Client code imports only `react`, `react-dom`, `@nextpluggable/plugin` and packages
  that can be bundled. No `next/*` imports, server components or server actions.
- Components render on the server first. Do not touch `window`, `document` or
  `localStorage` while rendering; use an effect.
- Do not hard-code this plugin's page addresses or endpoint URLs. Use
  `usePlugin().paths`, `ctx.paths` and `usePluginApi()`.
- Server code never sees the query string. Use address parameters (`/shop/:slug`) and
  read filters in the browser with `useQuery()`.
- Endpoints are public unless wrapped in `adminOnly`. Validate all input.
- The server entry must do no work and must not throw when it loads. It is loaded
  during the build and on install.
- Prefix every CSS class with the plugin's own prefix. There is no style isolation.
- Take colours from the site: read `--np-accent`, `--np-accent-text`, `--np-text`,
  `--np-muted`, `--np-border` and `--np-surface`, each with a fallback. Never give a colour setting
  a default, never set `font-family`, and never render a header or footer.
- Settings labels and help text are read by non-technical site owners. Use plain words.
- SEO is the plugin's job. Every page has a `description` written for search results,
  exactly one `<h1>`, its content in the server-rendered HTML, structured data that
  fits it (`jsonLd`), and `noindex` when it offers searchers nothing. Pages with
  parameters are listed by the `sitemap` hook.
- A widget never shifts the page, has no headings, renders on the server, and stays
  small. It runs on every page of the site.
- Write for AI search too: the main content is in the HTML the server sends, a tool
  comes with a sentence saying what it does, and the first paragraph answers the
  question the page is about.
- Accessible by default: text contrast of 4.5 to 1 (never hard-coded white on the
  accent; use `--np-accent-text`), a `<label>` for every input, real `<button>` and
  `<a>` elements, `alt` on images, and no horizontal scrolling on a phone.
```

## Changes to this guide

Newest first. Each entry says what to change in plugins written before it.

### Revision 3

SEO became the plugin's job, with defaults from the site.

- Give every page in `plugin.json` a `description` written for search results.
- Return `jsonLd` that fits each page's content from its loader.
- Add a `sitemap` function to the server entry of any plugin whose pages have
  parameters.
- Return `noindex: true` for pages that offer searchers nothing.
- Check every widget against the [widget rules](#widgets): no layout shift, no
  headings, rendered on the server, small.
- Check every page against the rules [for AI search](#for-ai-search) and
  [for everyone who uses the page](#for-everyone-who-uses-the-page).
- Replace hard-coded white text on the accent with `--np-accent-text`, falling back
  to a colour worked out from the accent ([step 6](#6-style-it)).
- New, optional loader metadata: `imageAlt`, `type`, `publishedTime`, `modifiedTime`.
- The build prints advice lines that start with `!`. Clear them.

### Revision 2

Plugins take their look from the site.

- Read `--np-accent`, `--np-text`, `--np-muted`, `--np-border` and `--np-surface`,
  each with a fallback, in place of colours of your own.
- Remove the `default` from every colour setting, and apply the owner's colour only
  when they chose one.
- Do not set `font-family`, and do not render a header or footer.

### Revision 1

The first version of this guide.

## Troubleshooting

| Message or symptom | Cause | Fix |
|---|---|---|
| `Invalid plugin manifest:` followed by a list | `plugin.json` breaks a rule from [step 3](#3-write-the-manifest) | Fix each listed item |
| `plugin.json refers to component "X", but the client entry does not export it` | A name in the manifest has no matching export | Export it from `src/client.tsx`, or fix the name |
| `The server entry must export default definePluginServer({ ... })` | No default export | Add it |
| `The server entry has a loader for page "x", which plugin.json does not declare` | A key under `pages` matches no page `id` | Make them match |
| `API route "…" must look like "GET /path"` | A malformed endpoint key | Use one of the five methods, a space, then a path starting with `/` |
| `The server entry throws when loaded` | Top-level code that fails | Move the work into a loader, a handler or `onInstall` |
| `Cannot require "x": server bundles may only use Node built-ins at runtime` | A package was left out of the bundle | Import it normally so it is bundled, or drop it |
| `Building plugins needs esbuild` | `esbuild` is not installed | `npm install --save-dev esbuild` |
| A build line starting with `!` | Advice for search engines, such as a page with no `description` | Fix what it names. The build still succeeds |
| The dashboard says the source "does not look like a plugin source" | No `nextpluggable.json` and no built plugin at the top level | Add the index file, or build and commit `dist/` |
| "This plugin has not been built yet" | `dist/build.json` is missing for a listed folder | Build and commit |
| "This plugin failed its integrity check" | `dist/` was edited by hand, or is stale | Rebuild and commit `dist/` unchanged |
| The page appears, then its content flickers or the console reports a hydration mismatch | The first render differs between server and browser | Render the same output first; change it in an effect |
| A widget does not appear on a site | The site's layout has no slot with that name | Ask the site's developer to add it, or use `body.end` |
| `usePluginConfig()` lacks a value | The setting is `secret` or `serverOnly` | Read it in server code and pass on only what the browser may see |

## Done when

- [ ] `npm run build` and `npm run typecheck` pass.
- [ ] `dist/` is committed and matches the source.
- [ ] The plugin installs on a site from the repository, and its page, widgets and
      settings work.
- [ ] The page's content is in the server-rendered HTML, and Lighthouse gives it an SEO
      score of 100.
- [ ] Widgets cause no layout shift on the site's other pages.
- [ ] `CLAUDE.md` holds the block above, with the current guide revision.

The two reference plugins are worth reading:
[EMI Calculator](https://github.com/rohittp0/NextPluggable/tree/main/plugins/emi-calculator),
a page with settings only, and
[Enquiry Form](https://github.com/rohittp0/NextPluggable/tree/main/plugins/enquiry-form),
with a page, endpoints, stored data, a layout widget, a dashboard screen and a secret
setting.
