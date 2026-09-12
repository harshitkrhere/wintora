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
 *   2. A nonce only works on a DYNAMICALLY rendered response. A statically
 *      prerendered page is built once, with no request in scope, so Next.js has
 *      no nonce to stamp onto its scripts. Serving such a page with a
 *      per-request nonce in the CSP blocks every script it contains, including
 *      the inline RSC payload: the HTML arrives complete, nothing hydrates, and
 *      the console shows only "Connection closed". `nonce: null` exists for
 *      exactly that case.
 *
 *   3. Next.js in DEVELOPMENT evaluates strings as JavaScript for hot module
 *      replacement. Without `'unsafe-eval'` the dev bundle throws an EvalError
 *      before React hydrates, so the page renders but nothing is interactive
 *      and the failure looks like "the button does nothing".
 *
 * See docs/SECURITY.md section 7.
 */

export interface CspOptions {
  /**
   * The per-request nonce, or null when the response may be statically
   * prerendered and therefore cannot carry one. Null trades the nonce for
   * 'unsafe-inline' on scripts; see the note in buildCsp.
   */
  readonly nonce: string | null;
  /**
   * Development needs 'unsafe-eval' for HMR. Production must never have it:
   * it re-opens the main injection vector a strict script-src exists to close.
   */
  readonly isDevelopment: boolean;
}

export function buildCsp({ nonce, isDevelopment }: CspOptions): string {
  // With a nonce, scripts are strict. Without one, the only way a prerendered
  // page can run its own inline RSC payload is 'unsafe-inline'.
  //
  // That weakening is confined to pages that render no user data and no user
  // input: the public marketing and tool pages. Everything that touches an
  // account, a document or money is dynamically rendered, gets a real nonce,
  // and never reaches this branch. The alternative was to force dynamic
  // rendering site-wide, which would drop CDN caching on precisely the pages
  // whose speed the organic-search strategy depends on.
  //
  // It is a genuine reduction in defence depth and is recorded in
  // docs/LIMITATIONS.md rather than glossed over. React escapes by default and
  // `dangerouslySetInnerHTML` is blocked by a build gate, so the inline-script
  // injection route this would otherwise open has no obvious entry point.
  const scriptSrc = [
    "'self'",
    ...(nonce === null ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`]),
    // Razorpay's checkout.js. It renders the payment form in an iframe served
    // by Razorpay, so card details never enter a document we control.
    'https://checkout.razorpay.com',
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ].join(' ');

  // Styles deliberately carry NO nonce, because 'unsafe-inline' has to work.
  // React writes inline styles for every `style={{...}}` prop and checkout.js
  // injects its own for the payment overlay. Adding a nonce here would
  // silently disable 'unsafe-inline' and blank the UI.
  //
  // This is a real weakening, and a smaller one than the script equivalent:
  // inline CSS cannot execute code, and img-src is already restricted, which
  // closes the usual CSS-based exfiltration routes. The stricter fix is to
  // remove every inline style prop in favour of classes; that is recorded in
  // docs/LIMITATIONS.md rather than pretended away.
  const styleSrc = ["'self'", "'unsafe-inline'", 'https://*.razorpay.com'].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    // Razorpay's overlay loads its own logos and method icons.
    "img-src 'self' data: blob: https://*.razorpay.com",
    "font-src 'self'",
    // Development also needs a websocket back to the dev server for HMR.
    `connect-src 'self' https://*.supabase.co https://*.razorpay.com${
      isDevelopment ? ' ws: wss:' : ''
    }`,
    // The payment form itself is an iframe from api.razorpay.com.
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
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
