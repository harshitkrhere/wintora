/**
 * The moment the app opens: the mark, alone on the canvas, until the
 * signed-in shell is ready.
 *
 * Streamed as the shell's Suspense fallback, so it is on screen only while
 * the shell is genuinely being built (the session looked up, the sidebar
 * drawn) and is replaced the instant that work finishes. It adds nothing to
 * the wait. Moving between pages inside the app never shows it: the shell
 * is already there, and the page's own skeleton takes over.
 *
 * No text, no spinner. The mark fades in so a fast open does not pop, and
 * breathes while a slow one finishes; both stop under reduced motion.
 */

import { LeafMark } from './Logo';

export function Splash(): React.ReactElement {
  return (
    <div className="splash" role="status" aria-busy="true">
      <LeafMark size={56} title="" />
      <span className="sr-only">Opening Wintora</span>
    </div>
  );
}
