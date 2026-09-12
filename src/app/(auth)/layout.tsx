/**
 * Auth shell: one card, centred, nothing to navigate. The mark is the only
 * way back, and it goes home.
 */

import Link from 'next/link';
import { LeafMark } from '@/components/Logo';

/**
 * Dynamic on purpose. These pages take passwords, so they get a per-request
 * CSP nonce and a strict script-src rather than 'unsafe-inline'. A nonce only
 * works on a dynamically rendered response (see src/lib/http/csp.ts), and
 * setting it here covers every page in the segment, including ones that read
 * nothing from the request and would otherwise be prerendered.
 */
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <main id="main" className="auth-shell">
      <div className="auth-card">
        <Link href="/" className="brand" aria-label="Wintora home">
          <LeafMark />
          <span>Wintora</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
