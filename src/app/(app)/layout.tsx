/**
 * Signed-in shell. Reads the session, so everything under it is dynamic.
 *
 * Three destinations and a way out. The marketing navigation does not
 * appear here: a person inside the product is not being sold to.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { LeafMark } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { AppNav } from '@/components/AppNav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  try {
    await requireUser();
  } catch {
    redirect('/signin');
  }

  return (
    <>
      <header className="app-bar">
        <div className="shell app-bar__inner">
          <Link href="/dashboard" className="brand" aria-label="Dashboard">
            <LeafMark />
            <span>Wintora</span>
          </Link>
          <AppNav />
          <div className="app-bar__end">
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
