/**
 * Public site chrome. Statically prerendered; must never read cookies.
 *
 * The header carries four things: the mark, three destinations, and one
 * action. Everything else is noise. The footer lists only pages that exist.
 */

import Link from 'next/link';
import { GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import { OPERATOR } from '@/config/disclosures';
import { SiteNav } from '@/components/SiteNav';
import { LeafMark } from '@/components/Logo';

export default function MarketingLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <header className="site-header">
        <div className="shell site-header__inner">
          <Link href="/" className="brand">
            <LeafMark />
            <span>Wintora</span>
          </Link>
          <SiteNav />
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="site-footer">
        <div className="shell stack--lg">
          <div className="footer-grid">
            <div>
              <Link href="/" className="brand" style={{ fontSize: '1rem' }}>
                <LeafMark size={24} />
                <span>Wintora</span>
              </Link>
              <p className="small" style={{ marginTop: '0.75rem', maxWidth: '34ch' }}>
                Understand your medical bills before you pay. Review, compare, take action.
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

          <p className="notice">{GLOBAL_DISCLAIMER}</p>
          <p className="small" style={{ margin: 0 }}>
            Wintora is a software utility. It is not a law firm, medical provider, insurer,
            debt collector, credit-repair business or government agency, and it is not
            affiliated with or endorsed by any government body.
          </p>
        </div>
      </footer>
    </>
  );
}
