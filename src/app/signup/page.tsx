import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';
import { CAPABILITY_STATEMENT } from '@/config/disclaimers';
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
    <div className="narrow" style={{ paddingTop: '3rem' }}>
      <p className="eyebrow">Create an account</p>
      <h1 style={{ marginBottom: '0.35rem' }}>Keep your work in one place</h1>
      <p className="lede">
        An account saves your cases, documents and letters. The free plan needs no card.
      </p>

      <AuthForm mode="signup" next={next} initialError={null} />

      <p className="small" style={{ marginTop: '1.25rem' }}>
        Already have one? <Link href={linkWithNext('/signin', next)}>Sign in</Link>.
      </p>

      {/* The boundary, stated before someone commits rather than after. */}
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>What this does, and what it does not</h2>
        <div className="two-col">
          <div>
            <h3 className="small eyebrow">It does</h3>
            <ul className="plan__features">
              {CAPABILITY_STATEMENT.does.slice(0, 4).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="small eyebrow">It does not</h3>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.4rem' }}>
              {CAPABILITY_STATEMENT.doesNot.slice(0, 4).map((item) => (
                <li key={item} className="small muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <p className="notice" style={{ marginTop: '1.5rem' }}>
        We ask for an email address, a password and your country. Nothing else is
        required. Your documents are never used to train models, and you can export or
        delete everything at any time, on any plan.
      </p>
    </div>
  );
}

function linkWithNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}
