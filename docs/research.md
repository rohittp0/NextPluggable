# Research and decisions

Researched 13 November 2026. This is the evidence behind NextPluggable's design: whether
something like it already exists, how plugin code can get into a running Next.js site,
and whether Next.js is the right platform to build on.

Claims are tagged by how they were established:

- **Tested** — reproduced in this repository (the test suite or a throwaway experiment).
- **Sourced** — read from the linked primary source on the research date.
- **Estimate** — arithmetic on stated assumptions.

## Conclusions

1. **Nothing existing does this.** No project combines a drop-in package for an existing
   Next.js site, installation by a non-technical person from a dashboard, GitHub
   repositories (including private ones) as the source, and full-stack plugins with
   public, indexable pages. Two projects come close and each misses on a different axis.
2. **Plugins are loaded at runtime, not built in.** A plugin ships prebuilt bundles; the
   site fetches them from GitHub at a pinned commit, stores them, server-renders the
   plugin's React components with the site's own React, and hydrates them in the
   browser. Installing takes about a second and needs no rebuild or redeploy.
3. **Stay on Next.js, but keep the plugin contract framework-neutral.** Astro measures
   better on performance and is cheaper to host, but no framework makes runtime plugins
   easier, the existing sites are Next.js, and most of the cost difference comes from
   the host rather than the framework. Plugins are written against web standards
   (`Request`/`Response`) and a small SDK, so a second host adapter remains possible.
4. **Two limits to know about.** Plugins are trusted code (there is no sandbox yet), and
   Next.js's newer "Cache Components" mode is not supported yet.

## 1. Does this already exist?

Closest matches, and where each falls short of the idea:

| Project | What it does well | Why it is not this |
|---|---|---|
| [EmDash](https://blog.cloudflare.com/emdash-wordpress/) (Cloudflare; 1.0 in Sept 2026) | One-click plugin install from the admin, with a consent dialog; plugins run sandboxed with declared capabilities | Built on Astro, with no Next.js path. Runtime-installed plugins get admin UI, API routes and storage but cannot render public pages; anything with page UI is a "native" plugin that needs npm, a config edit and a redeploy. Plugins come from its own registry, not from git repositories |
| [Cromwell CMS](https://github.com/CromwellCMS/Cromwell) | The literal "WordPress for Next.js": full-stack plugins installed from an admin GUI | A standalone multi-service system rather than something added to an existing site; no commits since July 2024 |
| [Payload](https://payloadcms.com/docs/plugins/overview) | An npm package that mounts an admin inside your Next.js app | Plugins are code a developer adds to the config; no install from the UI, no marketplace |
| [Directus Marketplace](https://directus.com/docs/guides/extensions/marketplace/publishing) | Runtime, UI-installed, sandbox-by-default extensions | A backend: extensions cannot add pages to a website |
| [shadcn registry](https://ui.shadcn.com/docs/changelog/2026-08-private-github-registries) and [Makerkit plugins](https://makerkit.dev/blog/changelog/introducing-makerkit-plugin-system) | Distribute features from public and private GitHub repositories, pinned to a commit | Developer command-line tools that copy source code into the repository and need a rebuild; no uninstall, no settings |
| [Nuxt Layers](https://nuxt.com/docs/4.x/getting-started/layers) | Pull pages, components and server routes from a GitHub repository | Build-time, edited in config by a developer, and Vue rather than React |
| Shopify, Wix, Webflow app stores | The non-technical experience this project is aiming for | Closed, hosted platforms |

Also surveyed and not close: Strapi, Medusa, Vendure and Saleor (developer-installed or
backend-only), visual builders such as Builder.io, Plasmic, Makeswift and Puck
(components are registered in code), Piral, Backstage dynamic plugins, NocoBase and
Grafana (not website frameworks), and a handful of small "WordPress-like plugins for
Next.js" repositories that are proofs of concept or require a rebuild.

**Why the gap exists** (analysis): Next.js is compiled. The usual way to load UI at
runtime, Module Federation, is in maintenance mode for Next.js and never supported the
App Router ([issue](https://github.com/module-federation/core/issues/3153)), and
serverless hosts have read-only filesystems. So "no rebuild" needs either a hidden
rebuild, or a module system of your own. NextPluggable takes the second route.

**Ideas borrowed:** a permissions list shown before install (EmDash), settings forms
generated from a schema (EmDash), commit pinning and a root index file listing plugins
(shadcn registry), committed build output (GitHub's JavaScript Actions), keeping data on
uninstall by default (EmDash).

**Strategic risk:** EmDash has momentum. If it gains public-page support for
runtime-installed plugins, or a Next.js host, this niche narrows. Neither was found.

## 2. How should plugin code reach a running site?

| | Runtime loading (chosen) | Commit to the site's repository and redeploy | Federation or separate apps |
|---|---|---|---|
| Owner's experience | Instant; no build | A build per install (tens of seconds to minutes) that can fail; needs write access to the site's repository | Each plugin is its own deployed app |
| SEO | Server-rendered HTML and metadata | Native routes | Varies; iframes are poor |
| Security | Plugin code runs inside the site's server process: trust required | Same trust, but reviewable in git | Strongest isolation |
| Where it runs | Any Node.js host. Not on Cloudflare Workers, which forbid evaluating code | Anywhere the site builds | Vercel Microfrontends is Vercel-only, and [$250 per extra project](https://vercel.com/docs/microfrontends) |
| Main risk | Owning a small module system | Lockfiles: a dependency cannot be added safely without running a package manager | Module Federation is unavailable for the App Router and Turbopack |

Runtime loading was chosen because the non-technical experience is the point of the
product, and because the risky part turned out to work:

- **Tested:** on Next.js 16.4.6 with Turbopack, a component from a bundle that was not
  part of the build is server-rendered inside the page (same React tree, the plugin's
  own `<title>` and metadata), then hydrated in the browser with no errors, in
  production builds, in `next dev`, and across client-side navigation. A second,
  independent experiment during research reached the same result on both Turbopack and
  webpack.
- **Tested:** plugin pages can be cached like static pages (ISR) and are refreshed the
  moment a plugin is installed, changed or removed. Caching is optional and has
  conditions; see "Caching plugin pages" below.
- **Tested:** the browser loads plugin code as an ordinary same-origin script, so a
  site's Content Security Policy does not need `unsafe-eval`.
- **Tested:** a plugin that throws while rendering does not take the page down, even
  on statically cached pages, where Next.js would otherwise refuse to produce the page.
  The site hands plugins a React whose components are individually guarded on the
  server, and an error boundary catches failures in the browser.

How it works, briefly: a plugin's client bundle leaves `react` and the SDK as external
`require` calls. On the server, the page's client-component pass evaluates the bundle
and hands it the site's own React, so the plugin renders as part of the page. In the
browser the same bundle arrives as a script that registers itself, and React hydrates
the server-rendered HTML once it has. Sharing the host's React is what every comparable
system does (Grafana, Backstage, Piral, Vercel's experimental
[remote-components](https://vercel.com/academy/microfrontends-on-vercel/remote-components-intro)).

### What this approach costs

- **No sandbox.** A plugin's server code can do anything the site can. Node's own
  [`vm` module is not a security boundary](https://nodejs.org/api/vm.html), and no
  in-process isolate is practical on Vercel. The realistic future options are a
  [workerd](https://blog.cloudflare.com/emdash-cms-plugin-registry/) side process on
  ordinary servers and Cloudflare's Dynamic Workers on Cloudflare. Until then the model
  is the same as WordPress or npm: install only from sources you trust. The mitigations
  in place are owner-chosen sources, commit pinning, integrity fingerprints, and a
  plain-language list of what a plugin does before install.
- **Plugins cannot use Next.js-only features** (React Server Components, server
  actions, `next/image`). They get server loaders, HTTP handlers and client components.
- **Cache Components is not supported yet.** Tested on 16.4.6: with
  `cacheComponents: true` the build rejects the way the layout slot and catch-all route
  read the plugin registry. Next.js [recommends this mode and plans to make it the
  default in version 17](https://nextjs.org/blog/next-16-4), so supporting it is the
  first roadmap item. It needs tag-based caching inside the package, and a decision on
  how unknown addresses return a real 404 in that mode.

### Things verified about the surrounding platform

- **Sourced:** current Next.js is 16.4.6 (9 Nov 2026); Turbopack is the default bundler;
  the Edge runtime is deprecated; Node.js 20.9 is the minimum.
- **Sourced:** in the App Router, a response's status is fixed once streaming starts, so
  a `notFound()` that runs after streaming began returns 200 plus `noindex`
  ([docs](https://nextjs.org/docs/app/api-reference/file-conventions/loading)). This is
  why the plugin page decides "does this address exist" before rendering anything.
  **Tested:** unknown addresses return a real 404. The one exception is an uncached
  catch-all route sitting under a `loading.tsx`, which returns 200 with `noindex`.
- **Sourced:** GitHub allows 60 unauthenticated API requests an hour per address and
  5,000 with a token ([docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  **Tested:** the limit is hit in practice on shared addresses, and the dashboard
  explains it and suggests adding a token.
- **Tested:** installing from the real GitHub API (this repository, pinned to a commit)
  takes about one second.

### Caching plugin pages

Whether the catch-all route that serves plugin pages can be statically cached depends
on the rest of the site. **Tested** on Next.js 16.4.6, production builds:

| | Uncached | Cached: `generateStaticParams` returning `[]`, plus `revalidate` | Cached: `dynamic = 'force-static'` |
|---|---|---|---|
| Root layout reads `cookies()` or `headers()` | Works | 500 on every plugin page and unknown address | Layout renders as a signed-out visitor |
| A component reads the query string (`useSearchParams`) | Works | Left to the browser; not in the cached HTML | The first visitor's value is rendered into the page served to everyone |
| Unknown address | 404 | 404 | 404 |
| Plugin installed, changed or removed | Immediate | Immediate | Immediate |

Two further observations in the cached modes:

- Next.js embeds the address of the request that first generated a page, including
  its query string, in the page's inline data, and serves that copy to later
  visitors. This is independent of plugins.
- For a loader that redirects, the first, uncached response carries the `Location`
  header twice (with the same value).

Decisions that follow:

- The generated route is uncached, which is correct on every site. Caching is a
  two-line opt-in using the `generateStaticParams` recipe, with its conditions stated
  next to it. `force-static` is not recommended.
- Plugins have no server-side access to the query string, and the SDK's query hook is
  browser-only, so plugin markup is identical for every visitor in every mode.
- The browser test runs in both modes.

## 3. Is Next.js the right platform?

### Performance in the field

Share of sites passing all Core Web Vitals on mobile, October 2026
([HTTP Archive](https://cdn.httparchive.org/v1/cwv?technology=Next.js,Astro,Nuxt.js,SvelteKit,Remix,WordPress&geo=ALL&rank=ALL&start=latest),
percentages computed from the raw counts):

| Framework | Passing all three | Sites measured |
|---|---|---|
| Astro | 72.2% | 53,101 |
| All websites | 53.0% | |
| WordPress | 49.0% | 2,513,839 |
| SvelteKit | 48.5% | 10,439 |
| Next.js | 37.2% | 414,664 |
| Remix | 32.9% | 4,322 |
| Nuxt | 28.0% | 94,506 |

This is correlation, not cause. Astro sites skew towards content, Next.js sites towards
heavy applications. A Next.js page that is statically cached and ships little JavaScript
can pass comfortably; the framework does not prevent it.

### Hosting cost

**Estimate** for a site with 1 million page views a month, mostly cacheable pages:

| Host | Monthly cost | Notes |
|---|---|---|
| Cloudflare Workers | about $5–6 | [Pricing](https://developers.cloudflare.com/workers/platform/pricing/). NextPluggable does not run here yet |
| A small server (VPS) | about $6–12, flat | `next start` on one machine; simplest fit for NextPluggable |
| Vercel Pro | about $25–120 | Depends mostly on request volume ([pricing](https://vercel.com/pricing)) |
| Netlify Pro | about $40–100 | Credit-based |

The cost difference is mostly the host, not the framework: Next.js on a small server
costs about the same as Astro on one.

### SEO

No evidence was found that framework choice affects ranking beyond Core Web Vitals and
whether content is in the server-rendered HTML. Google still queues JavaScript rendering,
and [AI crawlers were measured not executing JavaScript at all](https://vercel.com/blog/the-rise-of-the-ai-crawler).
The requirement that follows: plugin content must be in the initial HTML. **Tested:** it
is, including values the plugin computes.

### Decision

Target Next.js now, and keep plugins portable.

- **For Next.js:** the existing sites run on it; it has roughly eight times Astro's
  reach, which matters for a plugin ecosystem; and switching would not make runtime
  plugins easier. Cloudflare, building EmDash on Astro, did not solve
  runtime-installed public pages either.
- **For keeping the door open:** Astro passes Core Web Vitals at about twice the rate
  and is the cheapest to host. Plugins here import nothing from Next.js. They use
  `Request`/`Response` on the server and React components plus a small SDK in
  the browser, and the installer, storage, auth and GitHub code have no Next.js
  imports. An Astro host would be a new adapter, not a rewrite of plugins.
- **The strongest argument against:** a neutral contract is a lowest-common-denominator
  tax, since plugins cannot use Next.js-specific features. The mitigation is to keep
  the contract thin and build exactly one adapter until there is demand for a second.

If lower hosting cost is the main goal, the cheaper move is changing where the Next.js
sites are hosted (a small server, with plugin pages cached) rather than changing
framework.

## Not verified

- Behaviour on real Vercel infrastructure (cold starts, multiple instances). All tests
  ran on a local `next start` and `next dev`. On several instances, a change made
  through one instance reaches the others' in-memory plugin list within a few seconds,
  and cached pages depend on the host propagating Next.js revalidation.
- Whether EmDash's registry installs truly need no redeploy, and that it has no private
  or git-based sources: both are inferred from its documentation.
- Hosting costs are arithmetic on public price lists, not measured bills.
- Cloudflare's Dynamic Workers leaving beta.

## Sources

Existing solutions: [EmDash launch](https://blog.cloudflare.com/emdash-wordpress/) ·
[EmDash 1.0](https://blog.cloudflare.com/emdash-cms-plugin-registry/) ·
[EmDash plugin formats](https://docs.emdashcms.com/plugins/creating-plugins/choosing-a-format/) ·
[Payload plugins](https://payloadcms.com/docs/plugins/overview) ·
[Directus sandbox](https://directus.com/docs/guides/extensions/api-extensions/sandbox) ·
[Strapi marketplace](https://docs.strapi.io/cms/plugins/installing-plugins-via-marketplace) ·
[Medusa plugins](https://docs.medusajs.com/learn/fundamentals/plugins) ·
[Saleor apps](https://docs.saleor.io/developer/extending/apps/architecture/overview) ·
[shadcn registry items](https://ui.shadcn.com/docs/registry/registry-item-json) ·
[Nuxt Layers](https://nuxt.com/docs/4.x/guide/going-further/layers) ·
[Keystatic GitHub mode](https://keystatic.com/docs/github-mode) ·
[Shopify theme app extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions) ·
[Cromwell plugin development](https://cromwellcms.com/docs/development/plugin-development)

Loading techniques: [Next.js 16](https://nextjs.org/blog/next-16) ·
[Next.js 16.4](https://nextjs.org/blog/next-16-4) ·
[Turbopack reference](https://nextjs.org/docs/app/api-reference/turbopack) ·
[Module Federation and Next.js](https://github.com/module-federation/core/issues/3153) ·
[Vercel Microfrontends](https://vercel.com/docs/microfrontends) ·
[Vercel function runtimes](https://vercel.com/docs/functions/runtimes) ·
[Cloudflare Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/) ·
[isolated-vm](https://github.com/laverdet/isolated-vm) ·
[GitHub App manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) ·
[GitHub contents API](https://docs.github.com/en/rest/repos/contents) ·
[JavaScript Actions commit `dist/`](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action) ·
[ISR with Cache Components](https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components)

Platform: [HTTP Archive Core Web Vitals data](https://cdn.httparchive.org/v1/cwv?technology=Next.js,Astro,Nuxt.js,SvelteKit,Remix,WordPress&geo=ALL&rank=ALL&start=latest) ·
[Cloudflare acquires Astro](https://www.businesswire.com/news/home/20260116386991/en/) ·
[Astro 7](https://astro.build/blog/astro-7/) ·
[Next.js across platforms](https://nextjs.org/blog/nextjs-across-platforms) ·
[OpenNext on Cloudflare](https://opennext.js.org/cloudflare) ·
[vinext](https://blog.cloudflare.com/vinext-nextjs-on-vite/) ·
[Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) ·
[Google on JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) ·
[State of JS 2025](https://2025.stateofjs.com/en-US/libraries/meta-frameworks/)
