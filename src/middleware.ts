/**
 * Security headers, with a per-request CSP nonce, and the session refresh.
 *
 * The policy itself is built in `src/lib/http/csp.ts` so it can be unit-tested;
 * two of its rules are subtle enough to have been got wrong here once.
 *
 * The session refresh lives here because this is the one place that runs
 * before a page and is allowed to write cookies. Without it, an expired
 * access token turns every signed-in page into a redirect to /signin. See
 * src/lib/supabase/middleware.ts.
 *
 * See docs/SECURITY.md sections 1 and 7.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/http/csp';
import { refreshSession } from '@/lib/supabase/middleware';

/**
 * Surfaces that must never be indexed or cached: they render account data.
 * Every one of these is dynamically rendered and therefore also nonced.
 */
const PRIVATE_PREFIXES = [
  '/dashboard',
  '/cases',
  '/settings',
  '/billing',
  '/api',
  '/preview',
  '/checkout',
  '/upload',
];

/**
 * Public surfaces that are nonetheless dynamically rendered, so they CAN carry
 * a nonce and therefore must, because a strict script-src is the point:
 *
 *   - the auth pages: (auth)/layout.tsx forces dynamic rendering for the
 *     whole segment, precisely so that the pages a person types a password
 *     into never run with 'unsafe-inline' scripts;
 *   - /pricing: reads the billing interval from the URL and the country from
 *     the account. It stays indexable, so it is not private.
 *
 * The coupling is the same as for PRIVATE_PREFIXES: a page listed here that
 * becomes statically prerenderable will be sent a nonce it does not carry and
 * will stop hydrating.
 */
const NONCED_PUBLIC_PREFIXES = ['/signin', '/signup', '/forgot-password', '/reset-password', '/pricing'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;

  // Every private surface reads cookies or search params, so Next renders it
  // dynamically and CAN stamp a nonce. Public pages are prerendered at build
  // time and cannot, so they must not be sent a nonce they will never match.
  //
  // The coupling to worry about: if a page under PRIVATE_PREFIXES ever becomes
  // statically prerenderable, it will be served a nonce it does not carry and
  // will stop hydrating. That is why these surfaces also set `Cache-Control:
  // no-store` below, and why none of them may be made static without revisiting
  // this.
  const isPrivate = PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix));
  const isNonced =
    isPrivate || NONCED_PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));

  const nonce = isNonced ? Buffer.from(crypto.randomUUID()).toString('base64') : null;
  const csp = buildCsp({
    nonce,
    isDevelopment: process.env.NODE_ENV !== 'production',
  });

  // Built from the request as it stands at the time of the call, because the
  // session refresh below may rewrite the request's cookies and then needs a
  // fresh response that carries them to the render.
  const makeResponse = (): NextResponse => {
    const requestHeaders = new Headers(request.headers);
    if (nonce !== null) requestHeaders.set('x-nonce', nonce);

    // BOTH headers are required, and the second one is easy to miss.
    //
    // Next.js reads the nonce out of the REQUEST `Content-Security-Policy`
    // header and stamps it onto the inline <script> tags it emits for the RSC
    // streaming payload. Without it those inline scripts carry no nonce, the
    // browser blocks them, and the page never hydrates: every client component
    // silently dies while the server-rendered HTML still looks fine.
    //
    // `script-src 'self'` does not save you here. It covers same-origin script
    // FILES; an inline script needs a nonce or 'unsafe-inline'.
    if (nonce !== null) requestHeaders.set('Content-Security-Policy', csp);

    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  // Pages get their session refreshed before they render. Route handlers can
  // write cookies themselves, and the auth callback is in the middle of
  // exchanging a code for a session, so neither is touched.
  const managesOwnCookies = path.startsWith('/api/') || path.startsWith('/auth/');
  const response = managesOwnCookies ? makeResponse() : await refreshSession(request, makeResponse);

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // Private surfaces are never indexed. Belt and braces alongside the per-page
  // robots metadata and robots.txt. See docs/SEO.md section 6.
  if (isPrivate) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  } else if (isNonced) {
    // A nonced response is unique per request and must not be served from a
    // shared cache to anyone else. Indexing is left to the page's own metadata.
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the image optimiser.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
