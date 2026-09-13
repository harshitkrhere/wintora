/**
 * 404.
 *
 * Plain, and never a dead end. No search box: there is nothing on this site
 * to search, and a box that searches nothing is decoration. The one filled
 * action works for everyone, signed in or not.
 *
 * Static and cookie-free, so it renders under either shell without reading
 * the session. The quiet links cover both audiences.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { LeafMark } from '@/components/Logo';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

export default function NotFound(): React.ReactElement {
  return (
    <main id="main" className="auth-shell">
      <div className="auth-card auth-card--wide">
        <Link href="/" className="auth-card__mark" aria-label="Wintora home">
          <LeafMark size={32} title="" />
        </Link>
        <h1>That page is not here</h1>
        <p className="lede">
          The link may be old, or typed slightly wrong. Nothing of yours has been affected.
        </p>
        <div className="auth-actions">
          <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
            Check a bill
          </Link>
          <div className="auth-actions--row">
            <Link href="/" className="btn btn--quiet">
              Home
            </Link>
            <Link href="/signin" className="btn btn--quiet">
              Sign in
            </Link>
            <Link href="/cases" className="btn btn--quiet">
              Your cases
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
