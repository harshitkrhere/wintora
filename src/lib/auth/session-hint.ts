/**
 * The header's memory of whether someone was signed in.
 *
 * The public pages are prerendered and cannot know who is looking at them, so
 * the header asks /api/auth/session after hydration. Until the answer comes
 * back it would show "Sign in" to a paying customer on every page load. This
 * remembers the last answer for the tab, so the header starts from it and the
 * fetch merely confirms. Cleared on sign-out, so it can never claim a session
 * that was just ended. A hint only: nothing is authorised by it.
 */

const KEY = 'wintora:signed-in';

export function readSessionHint(): boolean | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeSessionHint(signedIn: boolean): void {
  try {
    sessionStorage.setItem(KEY, signedIn ? '1' : '0');
  } catch {
    // Storage unavailable. The header falls back to asking every time.
  }
}

export function clearSessionHint(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
