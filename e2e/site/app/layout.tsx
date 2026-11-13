import type { Metadata } from 'next';
import Link from 'next/link';
import { np } from '@/lib/nextpluggable';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Harbor Lending', template: '%s · Harbor Lending' },
  description: 'The site the NextPluggable browser test runs against.',
  // Site-wide sharing defaults. Plugin pages keep the image and site name, never this title or description.
  openGraph: { siteName: 'Harbor Lending', title: 'Harbor Lending', description: 'Home loans, explained plainly.', images: ['/og-default.png'] },
  twitter: { card: 'summary_large_image', title: 'Harbor Lending', description: 'Home loans, explained plainly.', images: ['/og-default.png'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header" data-mark="HOST-HEADER-MARK">
          <div className="wrap">
            <Link href="/" className="logo">
              Harbor Lending
            </Link>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/about">About</Link>
              {/* Plugins can add things here (a cart button, a call-to-action…). */}
              <np.Slot name="header.actions" />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <np.Slot name="footer" />
            <p>© Harbor Lending. A test site.</p>
          </div>
        </footer>
        <np.Slot name="body.end" />
      </body>
    </html>
  );
}
