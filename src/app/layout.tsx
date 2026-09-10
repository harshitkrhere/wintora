import { appUrl } from '@/lib/env';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: 'Wintora — Understand your medical bills before you pay',
    template: '%s — Wintora',
  },
  description:
    'Review bills, compare documents, prepare requests, and keep everything organised in one private workspace.',
  openGraph: {
    type: 'website',
    siteName: 'Wintora',
  },
  // No fabricated ratings, awards or endorsements anywhere in this site.
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <header className="site-header">
          <div className="shell site-header__inner">
            <Link href="/" className="wordmark">
              Wintora
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/medical-bill-checker">Bill checker</Link>
              <Link href="/bill-vs-eob">Bill vs EOB</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/methodology">How it works</Link>
              <Link href="/signin" className="btn btn--secondary">
                Sign in
              </Link>
            </nav>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="site-footer">
          <div className="shell stack--lg">
            <div className="footer-grid">
              <div>
                <h3>Tools</h3>
                <ul>
                  <li>
                    <Link href="/medical-bill-checker">Medical bill checker</Link>
                  </li>
                  <li>
                    <Link href="/bill-vs-eob">Compare a bill with an EOB</Link>
                  </li>
                  <li>
                    <Link href="/itemized-bill-request">Request an itemised bill</Link>
                  </li>
                  <li>
                    <Link href="/payment-plan-request">Request a payment plan</Link>
                  </li>
                </ul>
              </div>
              <div>
                <h3>Trust</h3>
                <ul>
                  <li>
                    <Link href="/security">Security</Link>
                  </li>
                  <li>
                    <Link href="/privacy">Privacy</Link>
                  </li>
                  <li>
                    <Link href="/data-retention">Data retention</Link>
                  </li>
                  <li>
                    <Link href="/sources">Sources</Link>
                  </li>
                  <li>
                    <Link href="/methodology">Methodology</Link>
                  </li>
                  <li>
                    <Link href="/corrections">Report an error</Link>
                  </li>
                </ul>
              </div>
              <div>
                <h3>Account</h3>
                <ul>
                  <li>
                    <Link href="/pricing">Plans and pricing</Link>
                  </li>
                  <li>
                    <Link href="/settings/subscription">Your subscription</Link>
                  </li>
                  <li>
                    <Link href="/settings/privacy">Export or delete your data</Link>
                  </li>
                  <li>
                    <Link href="/status">Status</Link>
                  </li>
                </ul>
              </div>
            </div>

            <p className="notice">{GLOBAL_DISCLAIMER}</p>

            <p className="small muted" style={{ margin: 0 }}>
              Wintora is a software utility. It is not a law firm, medical provider,
              insurer, debt collector, credit-repair business or government agency, and
              it is not affiliated with or endorsed by any government body.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
