/**
 * GET /auth/callback
 *
 * Where a magic link or an email-confirmation link lands. Exchanges the code
 * for a session cookie, then redirects.
 *
 * The `next` parameter is attacker-controllable — it travels in a link someone
 * can send — so it goes through `safeRedirect` before being used. Without that
 * this route is an open redirect that hands a freshly authenticated user to
 * somebody else's page.
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { safeRedirect } from '@/lib/http/safe-redirect';
import { log, newRequestId } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  const code = request.nextUrl.searchParams.get('code');
  const next = safeRedirect(request.nextUrl.searchParams.get('next'));

  if (code === null) {
    log.warn('auth callback without a code', {
      requestId,
      route: '/auth/callback',
    });
    return NextResponse.redirect(new URL('/signin?error=link', appUrl));
  }

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error !== null) {
    // Expired or already-used link. Say that plainly rather than showing a
    // stack trace or a bare failure.
    log.warn('auth callback exchange failed', {
      requestId,
      route: '/auth/callback',
      errorClass: error.name,
    });
    return NextResponse.redirect(new URL('/signin?error=expired', appUrl));
  }

  log.info('session established from link', { requestId, route: '/auth/callback' });

  return NextResponse.redirect(new URL(next, appUrl));
}
