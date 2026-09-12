import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';
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

  return (
    <>
      <h1>Create your account</h1>
      <p className="lede">The free plan needs no card. Nothing is claimed that cannot be shown.</p>

      <AuthForm mode="signup" next={next} initialError={null} />

      <p className="small muted" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
        Already have one? <Link href={linkWithNext('/signin', next)}>Sign in</Link>.
      </p>
    </>
  );
}

function linkWithNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}
