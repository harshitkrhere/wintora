'use client';

/**
 * The account corner of the site header.
 *
 * The header lives in the root layout, which is prerendered for the public
 * pages and so cannot know who is looking at it. This component asks after
 * hydration and swaps the control accordingly.
 *
 * Until the answer arrives it shows "Sign in", which is right for every
 * visitor without a session and for anyone with JavaScript off. A signed-in
 * user sees it flip within a moment of the page loading. That brief flash is
 * the cost of keeping the marketing pages static, and it is a smaller cost
 * than showing "Sign in" to a paying customer indefinitely, which is what this
 * replaces.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignOutButton } from './SignOutButton';

type State = 'unknown' | 'signed-in' | 'signed-out';

export function AuthNav(): React.ReactElement {
  const [state, setState] = useState<State>('unknown');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((j: { signedIn?: boolean }) => {
        if (!cancelled) setState(j.signedIn === true ? 'signed-in' : 'signed-out');
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
      <>
        <Link href="/dashboard" className="btn btn--secondary">
          Dashboard
        </Link>
        <SignOutButton />
      </>
    );
  }

  return (
    <Link href="/signin" className="btn btn--secondary">
      Sign in
    </Link>
  );
}
