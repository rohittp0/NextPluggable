import { np } from '@/lib/nextpluggable';

// Addresses your own routes don't handle land here. Installed plugins answer
// for the pages they add; everything else gets your normal 404 page.
export const generateMetadata = np.generatePluginMetadata;
export default np.PluginPage;

// Faster and cheaper: uncomment the next two lines to cache plugin pages like
// static pages. The dashboard refreshes the cache whenever a plugin changes.
// Only do this if nothing in your root layout reads cookies() or headers() on
// the server: with caching on, such a layout makes these pages fail with a
// 500 error in production builds (it will not show up in `next dev`).
// export const generateStaticParams = async () => [];
// export const revalidate = 3600;
