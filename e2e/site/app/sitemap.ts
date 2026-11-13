import type { MetadataRoute } from 'next';
import { np } from '@/lib/nextpluggable';

// The site's own pages, then every page that plugins add.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return [{ url: `${base}/` }, { url: `${base}/about` }, ...(await np.sitemap())];
}
