/**
 * Signed-in shell. Reads the session, so everything under it is dynamic.
 *
 * On a wide screen: a sidebar with the mark, four destinations, the account
 * and the way out. Appearance is chosen in Settings, not in the chrome. On a phone: a slim top bar with the mark and the way out,
 * and the same four destinations along the bottom, in reach of a thumb. The
 * marketing navigation does not appear here: a person inside the product is
 * not being sold to.
 *
 * The shell streams. Looking the session up takes a round trip to the auth
 * server, and until it returns the response would otherwise be blank; the
 * splash (the mark on the canvas) is sent first and replaced the moment the
 * shell is ready. A visit with no session cookie at all is turned away
 * before anything streams, with a real redirect.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { hasSessionCookie } from '@/lib/auth/session-cookie';
import { isSafeMode } from '@/lib/env';
import { LeafMark } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { AppNav } from '@/components/AppNav';
import { SafeModeBanner } from '@/components/SafeModeBanner';
import { Splash } from '@/components/Splash';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  if (!hasSessionCookie(cookieStore.getAll().map((cookie) => cookie.name))) {
    redirect('/signin');
  }
  return (
    <Suspense fallback={<Splash />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    // A cookie that no longer opens a session (expired, revoked). The
    // redirect is carried to the client by the streamed response.
    redirect('/signin');
  }

  const email = user.email;
  const initial = email !== null && email.length > 0 ? email[0] : '·';

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Sidebar">
        <Link href="/dashboard" className="brand sidebar__brand" aria-label="Dashboard">
          <LeafMark title="" />
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
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="shell app-topbar__inner">
            <Link href="/dashboard" className="brand" aria-label="Dashboard">
              <LeafMark title="" />
              <span>Wintora</span>
            </Link>
            <div className="app-topbar__end">
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
