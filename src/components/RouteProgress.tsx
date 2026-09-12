'use client';

/**
 * A thin bar across the top of the viewport, the instant a click starts an
 * internal navigation.
 *
 * The App Router moves between pages with the History API rather than a real
 * page load, so nothing in the browser chrome shows that a click landed. A
 * page that takes even a few hundred milliseconds to become interactive — the
 * common case the first time a route's code has to be fetched and compiled —
 * looks exactly like the click did nothing, which is what was reported: a
 * person clicks a button and has no way to tell whether it worked.
 *
 * No library, and nothing sent anywhere: this listens for the click itself,
 * before the router has decided anything, and hides the moment the pathname
 * or query string actually changes — the App Router's own signal that the
 * new page has committed. A real full-page navigation (`window.location.href`,
 * sign-out, the hand-off to Razorpay) is deliberately left alone: the browser
 * already shows its own loading state for those.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

const ROUTE_COMMITTED = 'wintora:route-committed';

/** A link this component should treat as an in-app navigation to watch for. */
function isWatchableAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (href === null || href.length === 0) return false;
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  if (anchor.origin !== window.location.origin) return false;
  // Clicking the page already open navigates nowhere.
  if (anchor.href === window.location.href) return false;
  return true;
}

/**
 * Announces every route change. Split out because `useSearchParams` requires
 * a Suspense boundary, and the bar itself must render unconditionally.
 */
function RouteChangeWatcher(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `${pathname}?${searchParams.toString()}`;
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      window.dispatchEvent(new Event(ROUTE_COMMITTED));
    }
  }, [key]);

  return null;
}

export function RouteProgress(): React.ReactElement {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const start = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (anchor === null || !isWatchableAnchor(anchor)) return;

      setState('loading');
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
      // A route that never commits — a thrown error, a genuinely stalled
      // request — must not leave the bar running forever.
      safetyTimer.current = setTimeout(() => setState('idle'), 8000);
    };

    const finish = (): void => {
      setState((prev) => (prev === 'loading' ? 'done' : prev));
      if (safetyTimer.current !== null) {
        clearTimeout(safetyTimer.current);
        safetyTimer.current = null;
      }
    };

    // Capture phase: sees the click before a component's own onClick can
    // call preventDefault(), and before the router has intercepted it.
    document.addEventListener('click', start, true);
    window.addEventListener(ROUTE_COMMITTED, finish);
    return () => {
      document.removeEventListener('click', start, true);
      window.removeEventListener(ROUTE_COMMITTED, finish);
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (state !== 'done') return;
    const id = setTimeout(() => setState('idle'), 260);
    return () => clearTimeout(id);
  }, [state]);

  return (
    <>
      <Suspense fallback={null}>
        <RouteChangeWatcher />
      </Suspense>
      <div className={`route-progress route-progress--${state}`} aria-hidden="true" />
    </>
  );
}
