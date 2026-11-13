import { createNextPluggable } from 'nextpluggable';

// Defaults: dashboard password from NEXTPLUGGABLE_PASSWORD, data in ./.nextpluggable.
// On serverless hosts, pass a database adapter instead, e.g. `storage: upstashStorage()`.
export const np = createNextPluggable({ siteName: 'Harbor Lending' });
