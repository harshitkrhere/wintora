'use client';

/**
 * Something on our side failed while rendering a page.
 *
 * The person is told plainly that it was not them, given one button that
 * retries, and a reference they can quote. The reference is real: it is the
 * digest Next.js attaches to the server-side error, which is what appears in
 * our logs. See docs/SECURITY.md section 11.
 *
 * What this deliberately does NOT say: "a bug report has been sent to our
 * engineers." No error-reporting service is connected, so that would be
 * untrue, and a comforting sentence that is untrue is worse than none.
 */

import { useEffect } from 'react';
import { OPERATOR } from '@/config/disclosures';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // The server already logged it; this is for the person's own devtools.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  const reference = error.digest ?? null;
  const subject = encodeURIComponent(
    reference ? `Something went wrong (ref ${reference})` : 'Something went wrong',
  );

  return (
    <main id="main" className="auth-shell">
      <div className="auth-card" style={{ width: 'min(520px, 100%)' }}>
        <p className="eyebrow" style={{ color: 'var(--ink-400)' }}>
          Something went wrong
        </p>
        <h1 style={{ marginTop: 0 }}>This one is on us</h1>
        <p className="lede">
          The page could not be shown. It was not anything you did, and nothing of
          yours has been lost. Trying again usually works.
        </p>
        <div className="stack" style={{ gap: '0.6rem' }}>
          <button type="button" className="btn btn--primary" onClick={() => reset()}>
            Try again
          </button>
          <a href="/dashboard" className="btn btn--quiet">
            Go to your dashboard
          </a>
        </div>
        {reference ? (
          <p className="small muted" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
            If it keeps happening, quote reference <code>{reference}</code>
            {OPERATOR.contactEmail ? (
              <>
                {' '}
                when you{' '}
                <a href={`mailto:${OPERATOR.contactEmail}?subject=${subject}`}>email us</a>
              </>
            ) : null}
            . It points us at exactly what failed.
          </p>
        ) : null}
      </div>
    </main>
  );
}
