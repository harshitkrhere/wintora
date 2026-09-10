/**
 * CSRF origin checking.
 *
 * State-changing requests must come from an origin we recognise. Combined with
 * `SameSite=Lax` session cookies this closes the standard cross-site form and
 * image-tag vectors.
 *
 * Extracted so it can be unit-tested, because the development case is easy to
 * get wrong in a way that looks like a permissions bug: a developer browsing
 * `http://localhost:3000` while `NEXT_PUBLIC_APP_URL` points at a tunnel is a
 * normal, correct setup, and a naive equality check rejects every POST with a
 * bare 403.
 */

export interface OriginCheckOptions {
  /** The Origin header, or null when absent. */
  readonly origin: string | null;
  /** The configured public app URL. */
  readonly appUrl: string;
  readonly isDevelopment: boolean;
  readonly method: string;
}

export type OriginVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Loopback hosts a developer legitimately browses from. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'];

function isLoopback(hostname: string): boolean {
  if (LOOPBACK_HOSTS.includes(hostname)) return true;
  // Private LAN ranges, for testing from a phone on the same network.
  return /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
}

export function checkOrigin(options: OriginCheckOptions): OriginVerdict {
  if (SAFE_METHODS.includes(options.method.toUpperCase())) return { ok: true };

  if (options.origin === null || options.origin.length === 0) {
    return { ok: false, reason: 'missing Origin header on a state-changing request' };
  }

  let requestOrigin: URL;
  try {
    requestOrigin = new URL(options.origin);
  } catch {
    return { ok: false, reason: 'malformed Origin header' };
  }

  let configured: URL;
  try {
    configured = new URL(options.appUrl);
  } catch {
    return { ok: false, reason: `NEXT_PUBLIC_APP_URL is not a valid URL: ${options.appUrl}` };
  }

  if (requestOrigin.origin === configured.origin) return { ok: true };

  // In development the app URL frequently points at a tunnel while the browser
  // sits on localhost. Accepting loopback and LAN origins here costs nothing:
  // an attacker who can already serve pages from the developer's own machine
  // has better options than CSRF.
  if (options.isDevelopment && isLoopback(requestOrigin.hostname)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `cross-origin request from ${requestOrigin.origin}, expected ${configured.origin}`,
  };
}

/**
 * Placeholder values that look real enough to be pasted from documentation.
 * Catching them here turns a baffling 403 into a clear message.
 */
const PLACEHOLDER_HOSTS = [
  'something.trycloudflare.com',
  'example.com',
  'example.invalid',
  'yourdomain.com',
  'your-domain.com',
];

export function isPlaceholderAppUrl(appUrl: string): boolean {
  try {
    return PLACEHOLDER_HOSTS.includes(new URL(appUrl).hostname);
  } catch {
    return false;
  }
}
