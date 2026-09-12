/**
 * Signed-in shell. Reads the session, so everything under it is dynamic.
 *
 * On a wide screen: a sidebar with the mark, four destinations, the account
 * and the way out. On a phone: a slim top bar with the mark and the way out,
 * and the same four destinations along the bottom, in reach of a thumb. The
 * marketing navigation does not appear here: a person inside the product is
 * not being sold to.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { isSafeMode } from '@/lib/env';
import { LeafMark } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppNav } from '@/components/AppNav';
import { SafeModeBanner } from '@/components/SafeModeBanner';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin');
  }

  const email = user.email;
  const initial = email !== null && email.length > 0 ? email[0] : '·';

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Sidebar">
        <Link href="/dashboard" className="brand sidebar__brand" aria-label="Dashboard">
          <LeafMark />
          <span>Wintora</span>
        </Link>
        <AppNav variant="sidebar" />
        <div className="sidebar__footer">
          <div className="sidebar__account" title={email ?? undefined}>
            <span className="sidebar__avatar" aria-hidden>
              {initial}
            </span>
            <span className="sidebar__email">{email ?? 'Signed in'}</span>
          </div>
          <div className="sidebar__tools">
            <ThemeToggle variant="icon" />
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="shell app-topbar__inner">
            <Link href="/dashboard" className="brand" aria-label="Dashboard">
              <LeafMark />
              <span>Wintora</span>
            </Link>
            <div className="app-topbar__end">
              <ThemeToggle variant="icon" />
              <SignOutButton />
            </div>
          </div>
        </header>
        <SafeModeBanner active={isSafeMode()} />
        <main id="main">{children}</main>
      </div>

      <AppNav variant="tabbar" />
    </div>
  );
}
