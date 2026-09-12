'use client';

/**
 * The account corner of the public site's header.
 *
 * The header lives in a prerendered layout and so cannot know who is looking
 * at it. This component asks /api/auth/session after hydration and shows one
 * of two things: "Sign in", or "Dashboard". Nothing else.
 *
 * There is deliberately no sign-out here. Signing out is something a person
 * does from inside the product, in the signed-in shell; a sign-out button on
 * every marketing page is a way to end someone's session by accident on a
 * shared screen, and it tells anyone glancing at the page that an account is
 * open. The public header only ever offers a way in.
 *
 * Until the answer arrives it starts from the tab's last known answer (see
 * src/lib/auth/session-hint.ts), then "Sign in", which is right for every
 * visitor without a session and for anyone with JavaScript off.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readSessionHint, writeSessionHint } from '@/lib/auth/session-hint';

type State = 'unknown' | 'signed-in' | 'signed-out';

export function AuthNav(): React.ReactElement {
  const [state, setState] = useState<State>('unknown');

  useEffect(() => {
    let cancelled = false;

    const hint = readSessionHint();
    if (hint !== null) setState(hint ? 'signed-in' : 'signed-out');

    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((j: { signedIn?: boolean }) => {
        const signedIn = j.signedIn === true;
        writeSessionHint(signedIn);
        if (!cancelled) setState(signedIn ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (!cancelled) setState('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'signed-in') {
    return (
      <Link href="/dashboard" className="btn btn--primary">
        Dashboard
      </Link>
    );
  }

  return (
    <Link href="/signin" className="btn btn--secondary">
      Sign in
    </Link>
  );
}
