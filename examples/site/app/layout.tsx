import type { Metadata } from 'next';
import Link from 'next/link';
import { np } from '@/lib/nextpluggable';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Harbor Lending', template: '%s · Harbor Lending' },
  description: 'A demo site for NextPluggable.',
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
            <p>© Harbor Lending. A demo site.</p>
          </div>
        </footer>
        <np.Slot name="body.end" />
      </body>
    </html>
  );
}
