/**
 * What a plugin page tells search engines and sharing previews. A plugin may say
 * as little as nothing: every gap is filled here, so a page is complete by default.
 */
import type { Metadata, ResolvedMetadata } from 'next';
import type { PluginPage } from '@nextpluggable/plugin/manifest';
import type { PageResult } from '@nextpluggable/plugin/server';
import type { ResolvedConfig } from '../config.js';
import type { InstallRecord } from '../core/types.js';

export interface PageSeo {
  title: string;
  /** Never empty: the loader's, else the page's, else the plugin's, else the title. */
  description: string;
  canonical?: string;
  image?: string;
  imageAlt: string;
  type: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  noindex: boolean;
}

const clean = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || undefined;
};

/** An absolute URL on this site, or undefined when the value cannot be one. */
export function absoluteUrl(cfg: Pick<ResolvedConfig, 'siteUrl'>, value: string): string | undefined {
  try {
    return new URL(value, `${cfg.siteUrl}/`).toString();
  } catch {
    return undefined;
  }
}

export function pageSeo(cfg: Pick<ResolvedConfig, 'siteUrl'>, install: InstallRecord, page: PluginPage, pathname: string, result: PageResult): PageSeo {
  const meta = result.metadata ?? {};
  const title = clean(meta.title) ?? page.title;
  const image = clean(meta.image);
  return {
    title,
    description: clean(meta.description) ?? clean(page.description) ?? clean(install.manifest.description) ?? title,
    canonical: absoluteUrl(cfg, clean(meta.canonical) ?? pathname),
    image: image ? absoluteUrl(cfg, image) : undefined,
    imageAlt: clean(meta.imageAlt) ?? title,
    type: meta.type === 'article' ? 'article' : 'website',
    publishedTime: clean(meta.publishedTime),
    modifiedTime: clean(meta.modifiedTime),
    noindex: meta.noindex === true,
  };
}

/**
 * Next.js metadata for the page. `inherited` is what the layouts above already
 * declared: a page that brings no image of its own keeps the site's sharing image,
 * site name and Twitter account, but never the site's title or description.
 */
export function pageMetadata(cfg: Pick<ResolvedConfig, 'publicSiteName'>, seo: PageSeo, inherited?: ResolvedMetadata | null): Metadata {
  const og = inherited?.openGraph;
  const tw = inherited?.twitter;
  const ownImage = seo.image ? [{ url: seo.image, alt: seo.imageAlt }] : undefined;
  // "player" and "app" cards need fields a page cannot supply.
  const inheritedCard = tw?.card === 'summary' || tw?.card === 'summary_large_image' ? tw.card : undefined;
  return {
    title: seo.title,
    description: seo.description,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: {
      type: seo.type,
      title: seo.title,
      description: seo.description,
      url: seo.canonical,
      siteName: og?.siteName ?? cfg.publicSiteName,
      locale: og?.locale,
      images: ownImage ?? og?.images,
      ...(seo.type === 'article' ? { publishedTime: seo.publishedTime, modifiedTime: seo.modifiedTime } : {}),
    },
    twitter: {
      card: ownImage ? 'summary_large_image' : (inheritedCard ?? 'summary'),
      title: seo.title,
      description: seo.description,
      site: tw?.site ?? undefined,
      creator: tw?.creator ?? undefined,
      images: ownImage ?? tw?.images,
    },
    robots: seo.noindex ? { index: false, follow: false } : undefined,
  } as Metadata;
}

/** Structured data for the page: the plugin's own, or a plain description of the page when it gives none. */
export function pageJsonLd(cfg: Pick<ResolvedConfig, 'siteUrl' | 'publicSiteName'>, seo: PageSeo, result: PageResult): Record<string, unknown>[] {
  if (result.jsonLd) return Array.isArray(result.jsonLd) ? result.jsonLd : [result.jsonLd];
  if (seo.noindex) return [];
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: seo.title,
      description: seo.description,
      ...(seo.canonical ? { url: seo.canonical } : {}),
      ...(seo.image ? { image: seo.image } : {}),
      ...(seo.modifiedTime ? { dateModified: seo.modifiedTime } : {}),
      ...(cfg.publicSiteName ? { isPartOf: { '@type': 'WebSite', name: cfg.publicSiteName, url: cfg.siteUrl } } : {}),
    },
  ];
}
