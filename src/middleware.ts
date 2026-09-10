/**
 * Security headers, with a per-request CSP nonce.
 *
 * The policy itself is built in `src/lib/http/csp.ts` so it can be unit-tested;
 * two of its rules are subtle enough to have been got wrong here once.
 *
 * See docs/SECURITY.md section 7.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/http/csp';

const PRIVATE_PREFIXES = [
  '/dashboard',
  '/cases',
  '/settings',
  '/billing',
  '/api',
  '/preview',
  '/checkout',
];

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    isDevelopment: process.env.NODE_ENV !== 'production',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // BOTH headers are required, and the second one is easy to miss.
  //
  // Next.js reads the nonce out of the REQUEST `Content-Security-Policy` header
  // and stamps it onto the inline <script> tags it emits for the RSC streaming
  // payload. Without it those inline scripts carry no nonce, the browser blocks
  // them, and the page never hydrates: every client component silently dies
  // while the server-rendered HTML still looks fine.
  //
  // `script-src 'self'` does not save you here. It covers same-origin script
  // FILES; an inline script needs a nonce or 'unsafe-inline'.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

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
  const path = request.nextUrl.pathname;
  if (PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the image optimiser.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
