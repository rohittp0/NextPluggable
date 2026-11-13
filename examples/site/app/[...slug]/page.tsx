import { np } from '@/lib/nextpluggable';

// Every address your own routes don't handle lands here; installed plugins
// answer for the pages they add, and everything else gets your normal 404.
export const generateMetadata = np.generatePluginMetadata;
export default np.PluginPage;

// Cache plugin pages like static pages: each is rendered once, then served from
// the cache until a plugin is installed, changed or removed in the dashboard.
export const generateStaticParams = async () => [];
export const revalidate = 3600;
