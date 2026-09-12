/**
 * 404.
 *
 * Apologetic, plain, and never a dead end. No search box: there is nothing
 * on this site to search, and a box that searches nothing is decoration.
 * Four real places to go instead.
 *
 * Static and cookie-free, so it renders under either shell without
 * reading the session. The links cover both audiences.
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
          <LeafMark size={42} />
        </Link>
        <h1>That page is not here</h1>
        <p className="lede">
          Sorry about that. The link may be old, or it may have been typed slightly
          wrong. Nothing of yours has been affected.
        </p>
        <div className="auth-actions">
          <Link href="/dashboard" className="btn btn--primary btn--lg">
            Go to your dashboard
          </Link>
          <div className="auth-actions--row">
            <Link href="/cases" className="btn btn--quiet">
              Your cases
            </Link>
            <Link href="/medical-bill-checker" className="btn btn--quiet">
              Check a bill
            </Link>
            <Link href="/" className="btn btn--quiet">
              Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
