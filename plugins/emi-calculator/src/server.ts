import { definePluginServer } from '@nextpluggable/plugin/server';

interface Config {
  heading: string;
  intro?: string;
}

export default definePluginServer<Config>({
  pages: {
    calculator: ({ config, site, path }) => ({
      metadata: {
        title: config.heading,
        description: config.intro?.slice(0, 160),
      },
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: config.heading,
        description: config.intro,
        url: site.url + path,
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
      },
    }),
  },
});
