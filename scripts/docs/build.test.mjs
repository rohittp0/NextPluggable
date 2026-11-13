import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_DIR, GUIDES, SITE_URL, guideRevision, renderSite, slugify } from './build.mjs';

const site = renderSite();

describe('documentation site', () => {
  it('is committed up to date (run `pnpm docs:build` after editing a guide or the generator)', () => {
    for (const [file, content] of site) {
      const target = path.join(DOCS_DIR, file);
      expect(existsSync(target), `docs/${file} is missing`).toBe(true);
      expect(readFileSync(target, 'utf8'), `docs/${file} is out of date`).toBe(content);
    }
  });

  it('gives every guide an HTML page and a Markdown version for agents', () => {
    for (const guide of GUIDES) {
      const html = site.get(`${guide.slug}/index.html`);
      expect(html).toContain(`<link rel="alternate" type="text/markdown" href="${SITE_URL}/${guide.slug}.md"`);
      expect(existsSync(path.join(DOCS_DIR, `${guide.slug}.md`))).toBe(true);
      expect(site.get('llms.txt')).toContain(`${SITE_URL}/${guide.slug}.md`);
    }
  });

  it('puts the agent addresses of both guides on the landing page', () => {
    const home = site.get('index.html');
    for (const guide of GUIDES) expect(home).toContain(`${SITE_URL}/${guide.slug}.md`);
  });

  it('only links to files that exist', () => {
    for (const [file, html] of site) {
      if (!file.endsWith('.html') || file === '404.html') continue;
      for (const [, href] of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
        if (/^[a-z]+:/i.test(href)) continue;
        const target = path.join(DOCS_DIR, path.dirname(file), href);
        expect(existsSync(target.endsWith('/') || !path.extname(target) ? path.join(target, 'index.html') : target), `${file} links to ${href}`).toBe(true);
      }
    }
  });

  it('keeps the note for agents in the Markdown and out of the page for people', () => {
    for (const guide of GUIDES) {
      expect(readFileSync(path.join(DOCS_DIR, `${guide.slug}.md`), 'utf8')).toContain('**For AI agents.**');
      expect(site.get(`${guide.slug}/index.html`)).not.toContain('For AI agents.');
    }
  });

  it('states one revision per guide, the same in the note for agents, the list of changes and the CLAUDE.md block', () => {
    for (const guide of GUIDES) {
      const source = readFileSync(path.join(DOCS_DIR, `${guide.slug}.md`), 'utf8');
      const revision = guideRevision(guide.slug, source);
      expect(revision).toBeGreaterThan(0);
      expect(site.get(`${guide.slug}/index.html`)).toContain(`revision ${revision}</a>`);
      expect(site.get('llms.txt')).toContain(`(revision ${revision})`);
    }
    const drifted = '**Guide revision: 4.**\n\n## Changes to this guide\n\n### Revision 3\n\nGuide revision this repository follows: 4\n';
    expect(() => guideRevision('x', drifted)).toThrow('newest entry under "Changes to this guide" is 3');
    expect(() => guideRevision('x', drifted.replace('### Revision 3', '### Revision 4').replace('follows: 4', 'follows: 2'))).toThrow('CLAUDE.md block records 2');
  });

  it('tells agents to come back to the guide, in the Markdown and in the block for CLAUDE.md', () => {
    for (const guide of GUIDES) {
      const source = readFileSync(path.join(DOCS_DIR, `${guide.slug}.md`), 'utf8');
      expect(source).toContain('At the start of');
      expect(source).toContain('fetch the guide');
    }
  });

  it('gives headings the ids GitHub would, so anchors work in both renderings', () => {
    expect(slugify('Add this to CLAUDE.md')).toBe('add-this-to-claudemd');
    expect(slugify('8. Sites with locale routing or other middleware')).toBe('8-sites-with-locale-routing-or-other-middleware');
  });
});
