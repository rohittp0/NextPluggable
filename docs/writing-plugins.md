# Writing plugins

A plugin is a folder in a GitHub repository. Site owners install it from their
dashboard; nothing is published to npm.

```
my-plugin/
  plugin.json       the manifest: what the plugin adds, its settings, what it may do
  src/client.tsx    React components (pages, layout widgets, dashboard screens)
  src/server.ts     optional: page loaders and HTTP endpoints
  src/style.css     optional: imported from client.tsx
  dist/             build output. Commit it.
```

The two reference plugins are the best starting point:
[EMI Calculator](../plugins/emi-calculator) (one page, settings only) and
[Enquiry Form](../plugins/enquiry-form) (page, endpoints, stored data, a layout widget,
a dashboard screen, a secret setting).

## Set up and build

```bash
npm install --save-dev @nextpluggable/plugin esbuild react @types/react
npx nextpluggable-plugin build      # writes dist/
npx nextpluggable-plugin validate   # checks plugin.json only
```

The build produces `dist/client.js`, `dist/server.js`, `dist/style.css` and
`dist/build.json`. It fails with a plain message if the manifest names a component the
client entry does not export, if the server entry declares a loader for a page that
does not exist, or if an endpoint key is malformed.

**Commit `dist/`.** Sites install straight from the repository at an exact commit and
check every file against the fingerprint in `build.json`, so the committed output must
match the source. Builds are reproducible: rebuilding without changes leaves `dist/`
untouched, which makes "is `dist/` up to date" easy to check in CI.

A repository can hold one plugin at its root, or several. For several, add
`nextpluggable.json` at the root:

```json
{
  "name": "Acme plugins",
  "plugins": ["plugins/cart", "plugins/reviews"]
}
```

## The manifest

```json
{
  "manifestVersion": 1,
  "id": "enquiry-form",
  "name": "Enquiry Form",
  "version": "1.0.0",
  "description": "One or two sentences the site owner reads before installing.",
  "author": "Acme",
  "icon": "✉️",
  "category": "Forms",

  "pages": [
    { "id": "form", "path": "/contact", "component": "EnquiryPage", "title": "Contact us" }
  ],
  "slots": [{ "slot": "body.end", "component": "EnquiryButton" }],
  "admin": [{ "id": "inbox", "title": "Enquiries", "component": "EnquiryInbox" }],

  "permissions": ["storage", "fetch:*"],
  "settings": [
    { "key": "heading", "label": "Page heading", "type": "text", "default": "Talk to us", "required": true }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | Lowercase letters, digits and dashes. Unique across everything a site installs; changing it makes a different plugin |
| `version` | `1.2.3`. Shown to the owner; any rebuilt output is offered as an update |
| `icon` | An emoji, or a path to a small `.svg`/`.png` in the plugin folder (inlined at build, 32 kB at most) |
| `pages` | Pages the plugin adds. See below |
| `slots` | Components to render in named places of the site's layout |
| `admin` | Screens added as tabs on the plugin's page in the dashboard |
| `permissions` | What the plugin does, shown to the owner before install: `storage`, `email`, `fetch:<host>` or `fetch:*`. Declare honestly; hosts display these today and will enforce them when sandboxing arrives |
| `settings` | The settings form. See below |

### Pages

```json
{ "id": "product", "path": "/shop/:slug", "component": "ProductPage", "title": "Product" }
```

- `path` is the default address. `:name` matches one segment and a trailing `*` matches
  the rest; both arrive in `params`.
- Owners can change the address of pages with a fixed path from the dashboard. Set
  `"configurablePath": false` to prevent that. Never hard-code your own addresses:
  read them from `usePlugin().paths` (client) or `ctx.paths` (server).
- The site's own routes always win over plugin pages, and two plugins cannot claim the
  same address.
- The server never sees the query string (sites may cache plugin pages and share them
  between visitors). Put anything search engines should see in the address itself,
  such as `/shop/page/:n`, and read filters and searches in the browser with
  `useQuery()`.

### Settings

Each entry becomes one field in a generated form. Write labels and help text for a
non-technical reader.

| `type` | Field | Extra keys |
|---|---|---|
| `text`, `textarea`, `url`, `email` | Text inputs, validated accordingly | `placeholder` |
| `number` | Number input | `min`, `max`, `step` |
| `toggle` | On/off switch | |
| `select` | Dropdown | `options: [{ "value", "label" }]` |
| `color` | Colour picker (`#rrggbb`) | |
| `secret` | Write-only field for API keys and the like | |

Common keys: `key`, `label`, `help`, `default`, `required`, `group` (section heading).

- `secret` values are encrypted at rest, only ever available to server code, and never
  shown again in the dashboard.
- Add `"serverOnly": true` to keep any other setting away from browsers.
- A plugin with a `required` setting that has no default is installed paused, and
  switches on once the owner fills it in.
- When a plugin is updated, values the owner already entered are kept for settings
  that still exist.

## Client code

`src/client.tsx` exports the components the manifest names. They are ordinary React
client components: hooks, state and effects all work. They are rendered on the server
first and then hydrated, so the usual rule applies: do not read `window`, `document`
or `localStorage` while rendering; do that in an effect.

```tsx
import { useState } from 'react';
import { Link, usePlugin, usePluginApi, usePluginConfig, type PageProps } from '@nextpluggable/plugin';
import './style.css';

interface Config {
  heading: string;
}

export function EnquiryPage({ data, params }: PageProps<{ openingHours: string }>) {
  const config = usePluginConfig<Config>();
  const api = usePluginApi();
  const [sent, setSent] = useState(false);

  async function send(values: Record<string, string>) {
    const res = await api('/enquiries', { method: 'POST', json: values });
    setSent(res.ok);
  }
  // …
}
```

| From `@nextpluggable/plugin` | What it gives you |
|---|---|
| `usePluginConfig<T>()` | The owner's settings, minus secrets and server-only values |
| `usePlugin()` | `{ id, version, apiBase, paths, page }`. `paths` maps your page ids to their current addresses |
| `usePluginApi()` | `api(path, init)`: a `fetch` bound to your plugin's endpoints. Pass `{ json }` to send a JSON body |
| `useNavigation()` | `{ pathname, push, replace, back }` from the site's router |
| `useQuery()` | The query string, for filters and searches. Browser-only: it is empty in the server-rendered HTML and on the first render, then fills in |
| `Link` | Client-side navigation link |
| `PageProps<Data>` | Props of a page component: `data` from the server loader and `params` from the address |

`react`, `react-dom` and `@nextpluggable/plugin` are provided by the site and are not
bundled, which is why plugin bundles are small and why a plugin shares the site's
router. Everything else you import is bundled into your plugin.

**Layout widgets** (`slots`) receive no props. Conventional slot names are
`header.actions`, `footer` and `body.end`; a site renders only the slots its developer
placed, so a widget may not appear on every site.

**Dashboard screens** (`admin`) render inside the plugin's page in the dashboard, only
for the signed-in owner. Call your own endpoints with `usePluginApi()` and protect
those endpoints with `adminOnly`.

### Styling

Import CSS from the client entry; it is bundled into `dist/style.css` and loaded with
your components. There is no style isolation, so prefix every class (`.npenq-…`).
Inherit fonts, and read these custom properties with fallbacks so the plugin matches
both the site and the dashboard:

```css
.npenq {
  color: var(--np-text, #0f172a);
  border-color: var(--np-border, #e2e6ee);
  background: var(--np-surface, #ffffff);
}
.npenq-button { background: var(--np-accent, #2563eb); }
.npenq-note { color: var(--np-muted, #5b6474); }
```

## Server code

`src/server.ts` is optional. It runs on the site's server, uses web-standard
`Request` and `Response`, and may import Node built-ins. Other packages you import are
bundled in.

```ts
import { adminOnly, definePluginServer, json, readJson } from '@nextpluggable/plugin/server';

interface Config {
  heading: string;
  webhookUrl?: string;
}

export default definePluginServer<Config>({
  // Runs before a page renders: fetch data and describe the page to search engines.
  pages: {
    form: async ({ config, storage, params, site, path }) => ({
      data: { openingHours: (await storage.get<string>('hours')) ?? '9 to 5' },
      metadata: { title: config.heading, description: 'Get in touch with us.' },
      jsonLd: { '@context': 'https://schema.org', '@type': 'ContactPage', url: site.url + path },
    }),
  },

  // HTTP endpoints under the plugin's own base address.
  api: {
    'POST /enquiries': async ({ request, storage }) => {
      const body = await readJson<{ name?: string }>(request);
      if (!body?.name) return json({ error: 'Please tell us your name.' }, 422);
      await storage.set(`enquiry/${Date.now()}`, body);
      return json({ ok: true });
    },
    'GET /enquiries': adminOnly(async ({ storage }) => json({ keys: await storage.list('enquiry/') })),
    'DELETE /enquiries/:id': adminOnly(async ({ params, storage }) => {
      await storage.delete(`enquiry/${params.id}`);
      return json({ ok: true });
    }),
  },

  onInstall: async ({ storage }) => storage.set('hours', '9 to 5'),
  onUninstall: async () => {},
});
```

Every function receives a context:

| Key | Meaning |
|---|---|
| `config` | All settings, including secrets and server-only values |
| `storage` | The plugin's private key-value store: `get`, `set`, `delete`, `list(prefix)`. Values are JSON, 1 MB each at most. No other plugin can read it |
| `site.url` | The site's public address |
| `paths` | Current addresses of the plugin's pages, by page id |
| `log(...)` | Writes to the server log, tagged with the plugin id |
| `path`, `params` | Page loaders: the requested address and its parameters |
| `request`, `path`, `params`, `admin` | Endpoints: the request, the path below the plugin's base, its parameters, and the signed-in dashboard user or `null` |

**Page loaders** return any of `data` (must be JSON-serialisable), `metadata`
(`title`, `description`, `canonical`, `image`, `noindex`), `jsonLd`, `notFound: true`
or `redirect: '/somewhere'`.

**Endpoints** are public unless wrapped in `adminOnly`: that is what makes form posts
and third-party webhooks possible, so validate everything a visitor sends. For requests
that change data, `admin` is only set when the call came from the site's own pages
through `usePluginApi()`, so another website cannot act as the signed-in owner.

**Caching.** A site may cache plugin pages, so write loaders as if their result is
shared by every visitor and kept for a while. Cached pages are refreshed whenever the
owner changes anything in the dashboard, and whenever the owner changes data through
one of your endpoints. Data changed by visitors does not refresh them, so show
fast-changing or per-visitor content by fetching it from the browser.

**Lifecycle.** `onInstall` runs once, on first install, not on updates. If it throws,
or if the server entry throws while loading, the install is cancelled and the owner is
told the plugin failed to start. `onUninstall` runs before removal; stored data is
kept unless the owner asks for it to be deleted.

## Developing against a real site

In development, a site accepts a folder on the same machine as a source. In the
dashboard, under **Sources**, enter the path of the plugin folder (or of a repository
holding several). After each `nextpluggable-plugin build`, use **Check for updates**
and **Update**.

## Before you publish

- Build, and commit `dist/` together with the source change.
- Bump `version` so owners see what they are updating to.
- Check that pages make sense with JavaScript disabled: the content search engines
  need should be in the server-rendered HTML.
- If a component must touch browser-only APIs, do it in an effect. A plugin that
  throws while rendering is left out of the page rather than breaking the site, but
  its content is then missing from the HTML.
