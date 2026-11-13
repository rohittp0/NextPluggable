import { np } from '@/lib/nextpluggable';

// Every address your own routes don't handle lands here; installed plugins
// answer for the pages they add, and everything else gets your normal 404.
export const generateMetadata = np.generatePluginMetadata;
export default np.PluginPage;
