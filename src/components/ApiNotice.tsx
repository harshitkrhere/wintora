'use client';

/**
 * One failure, said once, with the way out. A session that has ended gets
 * a link back in that returns to this very page; everything else is the
 * server's own sentence.
 */

import { isSessionEnded, signInHref, type ApiFailure } from '@/lib/http/client';

export function ApiNotice({
  failure,
  tone = 'error',
}: {
  failure: ApiFailure | null;
  tone?: 'error' | 'warning';
}): React.ReactElement | null {
  if (failure === null) return null;
  return (
    <p className={`notice notice--${tone}`} role="alert">
      {failure.message}
      {isSessionEnded(failure) ? (
        <>
          {' '}
          <a href={signInHref()}>Sign in</a>
        </>
      ) : null}
    </p>
  );
}
