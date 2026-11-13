#!/usr/bin/env node
/**
 * Builds the documentation site in `docs/`, which GitHub Pages serves as it is.
 *
 *   pnpm docs:build
 *
 * Each guide is written once, as Markdown in `docs/`. That file is the version coding
 * agents read. This script renders the same file to the HTML page people read, so the
 * two cannot drift apart. The output is committed; a test fails when it is stale.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import hljs from 'highlight.js';
import { Marked } from 'marked';
import { homeBody } from './home.mjs';

/** Where GitHub Pages serves `docs/`. The Markdown guides link to each other with this address. */
export const SITE_URL = 'https://rohittp0.github.io/NextPluggable';
export const REPO_URL = 'https://github.com/rohittp0/NextPluggable';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DOCS_DIR = path.join(root, 'docs');

export const GUIDES = [
  {
    slug: 'integrate',
    nav: 'Integrate',
    summary: 'Add the dashboard, API route, plugin pages and layout slots to an existing Next.js site.',
    prompt: (url) => `Read ${url} and follow it to add NextPluggable to this Next.js project.`,
  },
  {
    slug: 'build',
    nav: 'Build plugins',
    summary: 'Set up a plugin repository, write the manifest, components and server code, and ship updates.',
    prompt: (url) => `Read ${url} and follow it to set this repository up as a NextPluggable plugin source. Then build this plugin: `,
  },
];

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same ids GitHub gives headings, so anchors work in both renderings. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export const icons = {
  copy: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-6A1.25 1.25 0 0 0 2 3.25v6c0 .69.56 1.25 1.25 1.25h.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10M9 2h5v5M14 2 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  theme: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor"/></svg>',
  mark: '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--primary)"/><path d="M14 7.5 20.5 14 14 20.5 7.5 14z" fill="var(--on-primary)"/></svg>',
};

/** The part of the address shown to people and copied for agents: a URL with a copy button. */
export function agentField({ r, file, label, prompt }) {
  const url = `${SITE_URL}/${file}`;
  return `<div class="agent-field">
  <a class="agent-url" href="${r}${file}" data-agent-url="${r}${file}">${esc(url)}</a>
  <button type="button" class="btn btn-primary" data-copy="${esc(url)}" data-copy-url="${r}${file}" aria-label="Copy the address of ${esc(label)}">${icons.copy}<span>Copy URL</span></button>
</div>${
    prompt
      ? `\n<p class="agent-more"><button type="button" class="link" data-copy="${esc(prompt(url))}" data-copy-url="${r}${file}" data-copy-prompt="${esc(prompt('{url}'))}">Copy as a prompt</button></p>`
      : ''
  }`;
}

function chrome({ r, title, description, canonical, current, body, markdown }) {
  const nav = GUIDES.map((g) => `<a href="${r}${g.slug}/"${current === g.slug ? ' aria-current="page"' : ''}>${g.nav}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta name="color-scheme" content="light dark">
${markdown ? `<link rel="alternate" type="text/markdown" href="${SITE_URL}/${markdown}" title="This page as Markdown, for coding agents">\n` : ''}<link rel="icon" href="${r}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${r}assets/site.css">
<script>try{var t=localStorage.getItem('np-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
  <div class="top-in">
    <a class="brand" href="${r || './'}">${icons.mark}<span>NextPluggable</span></a>
    <nav class="top-nav" aria-label="Guides">${nav}</nav>
    <div class="top-tools">
      <a class="top-link" href="${REPO_URL}">GitHub ${icons.out}</a>
      <button type="button" class="icon-btn" data-theme-toggle aria-label="Switch between light and dark">${icons.theme}</button>
    </div>
  </div>
</header>
${body}
<footer class="foot">
  <div class="foot-in">
    <p>NextPluggable is a working prototype. Plugins are trusted code: connect only sources you trust.</p>
    <nav aria-label="More">
      <a href="${REPO_URL}">GitHub</a>
      <a href="https://www.npmjs.com/package/nextpluggable">npm</a>
      <a href="${r}llms.txt">llms.txt</a>
      <a href="${REPO_URL}/blob/main/docs/research.md">Why it is built this way</a>
    </nav>
  </div>
</footer>
<script src="${r}assets/site.js" defer></script>
</body>
</html>
`;
}

/**
 * Each guide carries a revision number that agents compare with the one recorded in a
 * repository's CLAUDE.md. It has to agree in three places, or agents would be told
 * they are up to date when they are not.
 */
export function guideRevision(slug, source) {
  const stated = /\*\*Guide revision: (\d+)\.\*\*/.exec(source)?.[1];
  if (!stated) throw new Error(`${slug}.md must state "**Guide revision: N.**" in its note for agents.`);
  const changes = source.split('\n## Changes to this guide\n')[1];
  const newest = changes && /^### Revision (\d+)$/m.exec(changes)?.[1];
  if (newest !== stated) throw new Error(`${slug}.md states revision ${stated}, but the newest entry under "Changes to this guide" is ${newest ?? 'missing'}.`);
  const recorded = /^Guide revision this (?:repository|site) follows: (\d+)$/m.exec(source)?.[1];
  if (recorded !== stated) throw new Error(`${slug}.md states revision ${stated}, but its CLAUDE.md block records ${recorded ?? 'none'}.`);
  return Number(stated);
}

const LANGS = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', bash: 'bash', json: 'json', yaml: 'yaml', css: 'css', markdown: 'markdown' };

function renderGuide(guide, source) {
  const r = '../';
  const revision = guideRevision(guide.slug, source);
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(source);

  const h1 = tokens.find((t) => t.type === 'heading' && t.depth === 1);
  if (!h1) throw new Error(`${guide.slug}.md needs a top-level heading.`);
  const title = h1.text;
  // The introduction: every paragraph between the title and the first other block.
  const intro = [];
  for (const t of tokens.slice(tokens.indexOf(h1) + 1)) {
    if (t.type === 'paragraph') intro.push(t);
    else if (t.type !== 'space') break;
  }
  if (!intro.length) throw new Error(`${guide.slug}.md needs an opening paragraph.`);
  const description = intro[0].text.replace(/\s+/g, ' ').replace(/[`*]/g, '');

  const ids = new Map();
  const toc = [];
  const headingId = (text) => {
    const base = slugify(text);
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const anchors = [];

  marked.use({
    renderer: {
      heading({ tokens: inline, depth, text }) {
        const html = this.parser.parseInline(inline);
        if (depth === 1) return `<h1>${html}</h1>\n`;
        const id = headingId(text);
        if (depth <= 3) toc.push({ depth, id, html: html.replace(/<\/?code>/g, '') });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = LANGS[lang];
        const html = language ? hljs.highlight(text, { language }).value : esc(text);
        return `<div class="code"><div class="code-head"><span>${esc(lang ?? 'text')}</span><button type="button" class="code-copy" data-copy="${esc(text)}">${icons.copy}<span>Copy</span></button></div><pre><code>${html}</code></pre></div>\n`;
      },
      link({ href, tokens: inline }) {
        const html = this.parser.parseInline(inline);
        // Guides link to each other by their Markdown address; people get the HTML page.
        for (const g of GUIDES) {
          const md = `${SITE_URL}/${g.slug}.md`;
          if (href === md || href.startsWith(`${md}#`)) return `<a href="${r}${g.slug}/${href.slice(md.length)}">${html}</a>`;
        }
        if (href.startsWith('#')) {
          anchors.push(href.slice(1));
          return `<a href="${esc(href)}">${html}</a>`;
        }
        return `<a href="${esc(href)}" rel="noopener">${html}</a>`;
      },
      table(token) {
        const cell = (c, tag) => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
        const rows = token.rows.map((row) => `<tr>${row.map((c) => cell(c, 'td')).join('')}</tr>`).join('\n');
        return `<div class="table"><table>\n<thead>${head}</thead>\n<tbody>\n${rows}\n</tbody>\n</table></div>\n`;
      },
      paragraph({ tokens: inline }) {
        const html = this.parser.parseInline(inline);
        return html.startsWith('<strong>Check:</strong>') ? `<p class="check">${html}</p>\n` : `<p>${html}</p>\n`;
      },
      blockquote({ tokens: inner }) {
        return `<div class="note">${this.parser.parse(inner)}</div>\n`;
      },
    },
  });

  // The note addressed to agents stays in the Markdown; people get the agent address in its place.
  const body = tokens.filter((t) => t !== h1 && !intro.includes(t) && !(t.type === 'blockquote' && t.text.startsWith('**For AI agents.**')));
  body.links = tokens.links;
  const article = marked.parser(body);
  const lead = marked.parser(Object.assign([...intro], { links: tokens.links }));

  for (const a of anchors) if (!ids.has(a)) throw new Error(`${guide.slug}.md links to #${a}, which no heading has.`);

  const tocHtml = toc.map((t) => `<li class="toc-${t.depth}"><a href="#${t.id}">${t.html}</a></li>`).join('\n');
  const other = GUIDES.find((g) => g !== guide);

  const page = `<div class="doc">
  <aside class="side">
    <details class="toc" open>
      <summary>On this page</summary>
      <ul>
${tocHtml}
      </ul>
    </details>
  </aside>
  <main id="content" class="article">
    <p class="kicker">Guide · <a href="#changes-to-this-guide">revision ${revision}</a></p>
    <h1>${esc(title)}</h1>
    <div class="lead">${lead}</div>
    <section class="agent-box" aria-label="This page for coding agents">
      <p class="agent-box-title">Working with a coding agent? Give it this page as Markdown.</p>
      ${agentField({ r, file: `${guide.slug}.md`, label: `the ${guide.nav.toLowerCase()} guide`, prompt: guide.prompt })}
    </section>
${article}
    <nav class="next" aria-label="Other guide">
      <a href="${r}${other.slug}/"><span>Other guide</span><strong>${other.nav} ${icons.arrow}</strong></a>
    </nav>
  </main>
</div>`;

  return chrome({
    r,
    title: `${title} · NextPluggable`,
    description,
    canonical: `${SITE_URL}/${guide.slug}/`,
    current: guide.slug,
    markdown: `${guide.slug}.md`,
    body: page,
  });
}

function renderLlmsTxt(docsDir) {
  const revision = (g) => guideRevision(g.slug, readFileSync(path.join(docsDir, `${g.slug}.md`), 'utf8'));
  return `# NextPluggable

> WordPress-style plugins for Next.js. One package gives a site a dashboard where its owner installs, configures, updates and removes plugins from GitHub repositories, with no rebuild and no redeploy.

Each guide below is a complete, self-contained instruction set written for coding agents. The guides change as NextPluggable does: each states a revision number and lists what changed, and a project that follows one should record that number in its CLAUDE.md and check it at the start of each task.

## Guides

${GUIDES.map((g) => `- [${g.nav}](${SITE_URL}/${g.slug}.md) (revision ${revision(g)}): ${g.summary}`).join('\n')}

## Optional

- [Research and decisions](${SITE_URL}/research.md): why plugins are loaded at runtime, and the limits that follow
- [Source code](${REPO_URL})
`;
}

/** Every generated file, by its path inside `docs/`. */
export function renderSite(docsDir = DOCS_DIR) {
  const files = new Map();
  files.set(
    'index.html',
    chrome({
      r: '',
      title: 'NextPluggable: plugins for Next.js, installed from a dashboard',
      description:
        'Add one package to a Next.js site and its owner installs full-featured plugins from GitHub repositories, with no rebuild. Guides for people and for coding agents.',
      canonical: `${SITE_URL}/`,
      body: homeBody({ r: '' }),
    }),
  );
  for (const guide of GUIDES) files.set(`${guide.slug}/index.html`, renderGuide(guide, readFileSync(path.join(docsDir, `${guide.slug}.md`), 'utf8')));
  // GitHub Pages serves this file for any missing address, at any depth, so its links are absolute.
  const base = `${new URL(SITE_URL).pathname.replace(/\/+$/, '')}/`;
  files.set(
    '404.html',
    chrome({
      r: base,
      title: 'Page not found · NextPluggable',
      description: 'There is nothing at this address.',
      canonical: `${SITE_URL}/`,
      body: `<main id="content" class="missing"><p class="kicker">404</p><h1>There is nothing at this address.</h1><p>Try one of the guides: ${GUIDES.map((g) => `<a href="${base}${g.slug}/">${g.nav}</a>`).join(' or ')}.</p></main>`,
    }),
  );
  files.set('llms.txt', renderLlmsTxt(docsDir));
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, content] of renderSite()) {
    const target = path.join(DOCS_DIR, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`  docs/${file}`);
  }
}
