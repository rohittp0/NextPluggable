import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next.js sends the title and description of a page rendered per request after </head>,
  // except to crawlers on its own list. This keeps them in <head> for everyone, including
  // audit tools and crawlers that do not run JavaScript.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
