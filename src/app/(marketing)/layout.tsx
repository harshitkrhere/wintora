/**
 * Public site chrome. Statically prerendered; must never read cookies.
 *
 * The header carries the mark, three destinations, a quiet way in and the
 * one action. The footer lists only pages that exist, the appearance
 * control, and the lines the law and honesty require.
 */

import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import { OPERATOR } from '@/config/disclosures';
import { SiteNav } from '@/components/SiteNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LeafMark } from '@/components/Logo';

export default function MarketingLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <header className="site-header">
        <div className="shell site-header__inner">
          <Link href="/" className="brand">
            <LeafMark title="" />
            <span>Wintora</span>
          </Link>
          <SiteNav />
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="site-footer">
        <div className="shell stack--md">
          <div className="footer-grid">
            <div>
              <Link href="/" className="brand">
                <LeafMark size={24} title="" />
                <span>Wintora</span>
              </Link>
              <p className="footer__tagline">
                Clear answers about medical bills, before you pay.
              </p>
            </div>
            <div>
              <h3>Product</h3>
              <ul>
                <li><Link href="/medical-bill-checker">Check a bill</Link></li>
                <li><Link href="/bill-vs-eob">Compare with an EOB</Link></li>
                <li><Link href="/methodology">How it works</Link></li>
                <li><Link href="/pricing">Pricing</Link></li>
              </ul>
            </div>
            <div>
              <h3>Account</h3>
              <ul>
                <li><Link href="/signin">Sign in</Link></li>
                <li><Link href="/signup">Create an account</Link></li>
                <li><Link href="/settings/privacy">Your data</Link></li>
              </ul>
            </div>
            <div>
              <h3>Legal</h3>
              <ul>
                <li><Link href="/terms">Terms of service</Link></li>
                <li><Link href="/privacy">Privacy policy</Link></li>
                <li><Link href="/refunds">Refunds and cancellation</Link></li>
                <li><Link href="/contact">Contact</Link></li>
                {OPERATOR.contactEmail ? (
                  <li><a href={`mailto:${OPERATOR.contactEmail}`}>{OPERATOR.contactEmail}</a></li>
                ) : null}
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-copy">© 2026 Wintora. All rights reserved.</p>
            <ThemeToggle variant="segmented" />
          </div>

          <p className="notice">{GLOBAL_DISCLAIMER}</p>
          <p className="footer-legal">
            Wintora is a software utility. It is not a law firm, medical provider, insurer,
            debt collector, credit-repair business or government agency, and it is not
            affiliated with or endorsed by any government body.
          </p>
        </div>
      </footer>

      {/*
        Cookieless traffic measurement, scoped to this layout on purpose: it
        covers the public marketing pages only. It is never mounted inside the
        (auth) or (app) route groups, so no page a signed-in person visits, and
        no case ID that might appear in a path, is ever reported here. See
        docs/PRIVACY.md and the "Who processes it" table on /privacy.
      */}
      <Analytics />
    </>
  );
}
