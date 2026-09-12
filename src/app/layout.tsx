/**
 * The document. Nothing else.
 *
 * Header, footer and navigation belong to the route groups: (marketing) has
 * the public site chrome, (auth) has a bare centred card, (app) has the
 * signed-in bar. Keeping them apart is what lets the public pages stay
 * statically cached while the app reads cookies on every request.
 */

import { appUrl } from '@/lib/env';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { OfflineBanner } from '@/components/StatusBanners';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: 'Wintora — Understand your medical bills before you pay',
    template: '%s — Wintora',
  },
  description:
    'Upload a bill, confirm the figures, and see whether the arithmetic holds. Private by design; nothing is claimed that cannot be shown.',
  openGraph: { type: 'website', siteName: 'Wintora' },
  // No fabricated ratings, awards or endorsements anywhere on this site.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
