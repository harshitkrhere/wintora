/**
 * Content Security Policy construction.
 *
 * Extracted from the middleware so it can be unit-tested. Two CSP rules are
 * counter-intuitive enough that both were got wrong here once, and the tests in
 * `tests/csp.test.ts` now pin them:
 *
 *   1. `'unsafe-inline'` is IGNORED whenever a nonce or hash is present in the
 *      same directive. That is the CSP spec, not a browser quirk. Listing both
 *      does not give you "nonce, and inline as a fallback"; it gives you nonce
 *      only, and every inline style or script is silently blocked.
 *
 *   2. Next.js in DEVELOPMENT evaluates strings as JavaScript for hot module
 *      replacement. Without `'unsafe-eval'` the dev bundle throws an EvalError
 *      before React hydrates, so the page renders but nothing is interactive
 *      and the failure looks like "the button does nothing".
 *
 * See docs/SECURITY.md section 7.
 */

export interface CspOptions {
  readonly nonce: string;
  /**
   * Development needs 'unsafe-eval' for HMR. Production must never have it:
   * it re-opens the main injection vector a strict script-src exists to close.
   */
  readonly isDevelopment: boolean;
}

export function buildCsp({ nonce, isDevelopment }: CspOptions): string {
  // Scripts stay strict: a per-request nonce, plus Paddle.js. 'unsafe-eval' is
  // added ONLY in development, and only because Next's HMR requires it.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    'https://cdn.paddle.com',
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ].join(' ');

  // Styles deliberately carry NO nonce, because 'unsafe-inline' has to work.
  // React writes inline styles for every `style={{...}}` prop and Paddle.js
  // injects its own for the checkout overlay. Adding a nonce here would
  // silently disable 'unsafe-inline' and blank the UI.
  //
  // This is a real weakening, and a smaller one than the script equivalent:
  // inline CSS cannot execute code, and img-src is already restricted, which
  // closes the usual CSS-based exfiltration routes. The stricter fix is to
  // remove every inline style prop in favour of classes; that is recorded in
  // docs/LIMITATIONS.md rather than pretended away.
  const styleSrc = ["'self'", "'unsafe-inline'", 'https://*.paddle.com'].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Development also needs a websocket back to the dev server for HMR.
    `connect-src 'self' https://*.supabase.co https://*.paddle.com${
      isDevelopment ? ' ws: wss:' : ''
    }`,
    'frame-src https://*.paddle.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Read one directive out of a built policy, for tests and diagnostics. */
export function directive(csp: string, name: string): string | null {
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (trimmed === name || trimmed.startsWith(`${name} `)) {
      return trimmed.slice(name.length).trim();
    }
  }
  return null;
}
