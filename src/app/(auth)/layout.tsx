/**
 * Auth shell: one card, centred, nothing to navigate. The mark is the only
 * way back, and it goes home.
 */

import Link from 'next/link';
import { LeafMark } from '@/components/Logo';

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
