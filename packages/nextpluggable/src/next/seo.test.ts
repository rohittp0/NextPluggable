import type { ResolvedMetadata } from 'next';
import { describe, expect, it } from 'vitest';
import type { InstallRecord } from '../core/types.js';
import { pageJsonLd, pageMetadata, pageSeo } from './seo.js';

const cfg = { siteUrl: 'https://site.test', publicSiteName: 'Harbor Lending' as string | undefined };
const page = { id: 'main', path: '/tools/emi', component: 'Main', title: 'EMI Calculator', description: 'Work out a monthly instalment.' };
const install = { id: 'emi', manifest: { manifestVersion: 1, id: 'emi', name: 'EMI', version: '1.0.0', description: 'A calculator plugin.', pages: [page] } } as unknown as InstallRecord;

/** What a site's root layout typically declares: its own title, description and sharing image. */
const site = {
  openGraph: { siteName: 'Harbor Lending', locale: 'en_GB', title: 'Home loans', description: 'The site.', images: [{ url: 'https://site.test/og.png' }] },
  twitter: { card: 'summary_large_image', site: '@harbor', title: 'Home loans', description: 'The site.', images: [{ url: 'https://site.test/og.png' }] },
} as unknown as ResolvedMetadata;

describe('pageSeo', () => {
  it('fills every gap, so a page that says nothing is still complete', () => {
    const seo = pageSeo(cfg, install, page, '/tools/emi', {});
    expect(seo).toMatchObject({ title: 'EMI Calculator', description: 'Work out a monthly instalment.', canonical: 'https://site.test/tools/emi', type: 'website', noindex: false, imageAlt: 'EMI Calculator' });
  });

  it('falls back from the page to the plugin to the title for the description, and is never empty', () => {
    const bare = { ...page, description: undefined };
    expect(pageSeo(cfg, install, bare, '/x', {}).description).toBe('A calculator plugin.');
    const anonymous = { ...install, manifest: { ...install.manifest, description: undefined } } as InstallRecord;
    expect(pageSeo(cfg, anonymous, bare, '/x', {}).description).toBe('EMI Calculator');
    expect(pageSeo(cfg, install, page, '/x', { metadata: { description: '   ' } }).description).toBe('Work out a monthly instalment.');
  });

  it('prefers what the loader says, tidied up, with links made absolute', () => {
    const seo = pageSeo(cfg, install, page, '/tools/emi', {
      metadata: { title: ' Home loan\n calculator ', description: 'Plan a loan.', canonical: '/loans', image: '/og/emi.png', imageAlt: 'A chart', type: 'article', publishedTime: '2026-01-02', noindex: true },
    });
    expect(seo).toEqual({ title: 'Home loan calculator', description: 'Plan a loan.', canonical: 'https://site.test/loans', image: 'https://site.test/og/emi.png', imageAlt: 'A chart', type: 'article', publishedTime: '2026-01-02', modifiedTime: undefined, noindex: true });
  });
});

describe('pageMetadata', () => {
  const seo = pageSeo(cfg, install, page, '/tools/emi', {});

  it('describes the page itself everywhere, never with the site-wide title or description', () => {
    const meta = pageMetadata(cfg, seo, site) as any;
    expect(meta.title).toBe('EMI Calculator');
    expect(meta.alternates.canonical).toBe('https://site.test/tools/emi');
    expect(meta.openGraph).toMatchObject({ title: 'EMI Calculator', description: 'Work out a monthly instalment.', url: 'https://site.test/tools/emi', type: 'website' });
    expect(meta.twitter).toMatchObject({ title: 'EMI Calculator', description: 'Work out a monthly instalment.' });
    expect(meta.robots).toBeUndefined();
  });

  it("keeps the site's sharing image, name and account when the page brings none", () => {
    const meta = pageMetadata(cfg, seo, site) as any;
    expect(meta.openGraph).toMatchObject({ siteName: 'Harbor Lending', locale: 'en_GB', images: [{ url: 'https://site.test/og.png' }] });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', site: '@harbor', images: [{ url: 'https://site.test/og.png' }] });
  });

  it("uses the page's own image when it has one", () => {
    const own = pageSeo(cfg, install, page, '/tools/emi', { metadata: { image: '/og/emi.png' } });
    const meta = pageMetadata(cfg, own, site) as any;
    expect(meta.openGraph.images).toEqual([{ url: 'https://site.test/og/emi.png', alt: 'EMI Calculator' }]);
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [{ url: 'https://site.test/og/emi.png', alt: 'EMI Calculator' }] });
  });

  it('still produces complete tags on a site that declares nothing', () => {
    const meta = pageMetadata(cfg, seo, null) as any;
    expect(meta.openGraph).toMatchObject({ siteName: 'Harbor Lending', title: 'EMI Calculator' });
    expect(meta.openGraph.images).toBeUndefined();
    expect(meta.twitter.card).toBe('summary');
  });

  it('marks articles and pages kept out of search engines', () => {
    const article = pageSeo(cfg, install, page, '/x', { metadata: { type: 'article', publishedTime: '2026-01-02T00:00:00Z', noindex: true } });
    const meta = pageMetadata(cfg, article, site) as any;
    expect(meta.openGraph).toMatchObject({ type: 'article', publishedTime: '2026-01-02T00:00:00Z' });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('pageJsonLd', () => {
  it('describes the page when the plugin provides no structured data', () => {
    const seo = pageSeo(cfg, install, page, '/tools/emi', {});
    expect(pageJsonLd(cfg, seo, {})).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'EMI Calculator',
        description: 'Work out a monthly instalment.',
        url: 'https://site.test/tools/emi',
        isPartOf: { '@type': 'WebSite', name: 'Harbor Lending', url: 'https://site.test' },
      },
    ]);
  });

  it("uses the plugin's own structured data as it is", () => {
    const own = { '@context': 'https://schema.org', '@type': 'Product', name: 'Loan' };
    const seo = pageSeo(cfg, install, page, '/x', {});
    expect(pageJsonLd(cfg, seo, { jsonLd: own })).toEqual([own]);
    expect(pageJsonLd(cfg, seo, { jsonLd: [own, own] })).toHaveLength(2);
  });

  it('adds nothing to a page kept out of search engines', () => {
    expect(pageJsonLd(cfg, pageSeo(cfg, install, page, '/x', { metadata: { noindex: true } }), {})).toEqual([]);
  });
});
