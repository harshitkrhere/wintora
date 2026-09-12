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
import { RouteProgress } from '@/components/RouteProgress';
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
  // One per theme, matching --bg. src/lib/theme.ts rewrites these when a
  // person chooses a theme explicitly.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    // suppressHydrationWarning: public/theme.js sets data-theme on <html>
    // before React hydrates, and React would otherwise report the attribute
    // it did not render. Nothing else about the element differs.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* A same-origin file, not an inline script, so the strict CSP on the
            static pages allows it. It applies the saved theme before paint. */}
        <script src="/theme.js" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <RouteProgress />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
