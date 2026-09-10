import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';
import { safeRedirect } from '@/lib/http/safe-redirect';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Link failures arrive as a query flag rather than a raw provider message. */
const ERRORS: Record<string, string> = {
  link: 'That sign-in link was not valid. Please request a new one.',
  expired:
    'That sign-in link has expired or was already used. Please request a new one.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};

  // Validated here as well as on the server: the value round-trips through the
  // form, and an unvalidated one is an open redirect.
  const rawNext = params.next;
  const next = typeof rawNext === 'string' ? safeRedirect(rawNext) : null;

  const errorKey = typeof params.error === 'string' ? params.error : null;
  const initialError = errorKey !== null ? (ERRORS[errorKey] ?? null) : null;

  return (
    <div className="narrow" style={{ paddingTop: '3rem' }}>
      <p className="eyebrow">Sign in</p>
      <h1 style={{ marginBottom: '0.35rem' }}>Welcome back</h1>
      <p className="lede">
        Sign in to reach your cases, documents and letters.
      </p>

      <AuthForm mode="signin" next={next} initialError={initialError} />

      <p className="small" style={{ marginTop: '1.25rem' }}>
        New here? <Link href={linkWithNext('/signup', next)}>Create an account</Link>. The
        free plan includes one case, real analysis and a request letter, with no card.
      </p>

      <p className="notice" style={{ marginTop: '1.5rem' }}>
        Your documents are private to your account. We never use them to train models,
        and you can export or delete everything at any time, on any plan.
      </p>
    </div>
  );
}

function linkWithNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}
