'use client';

/**
 * Sign out.
 *
 * A POST, not a link. A GET sign-out can be triggered by any image tag or
 * prefetch on another site, and it is also the kind of thing a link prefetcher
 * will helpfully fire on hover.
 */

import { useCallback, useState } from 'react';
import { clearSessionHint } from '@/lib/auth/session-hint';
import { Icon } from './Icons';

export function SignOutButton(): React.ReactElement {
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await fetch('/api/auth/signout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      // The header must not remember a session that has just been ended.
      clearSessionHint();
      // Navigate regardless: a failed sign-out call still should not leave the
      // person sitting on a page that implies they are signed in.
      window.location.href = '/';
    }
  }, []);

  return (
    <button
      type="button"
      className="btn btn--quiet btn--sm"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? null : <Icon name="logout" />}
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
