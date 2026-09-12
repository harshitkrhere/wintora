import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { optionalUser } from '@/lib/http/api';
import { safeRedirect } from '@/lib/http/safe-redirect';

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};
  const rawNext = params.next;
  const next = typeof rawNext === 'string' ? safeRedirect(rawNext) : null;

  // Someone who is already signed in has no business on this page. Send them
  // where they were going, or to the dashboard. Offering a signed-in person a
  // sign-up form is confusing at best; on a shared device it is how a
  // session gets swapped or a second account created without a deliberate sign-out first.
  if ((await optionalUser()) !== null) redirect(next ?? safeRedirect(null));

  return (
    <>
      <h1>Create your account</h1>
      <p className="lede">The free plan needs no card. Nothing is claimed that cannot be shown.</p>

      <AuthForm mode="signup" next={next} initialError={null} />

      <div className="auth-links">
        <p>
          Already have one? <Link href={linkWithNext('/signin', next)}>Sign in</Link>
        </p>
      </div>
    </>
  );
}

function linkWithNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}
