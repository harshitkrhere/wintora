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
import { createAdminClient, createUserClient } from '@/lib/supabase/server';
import { notifyAccount } from '@/lib/email/account';
import { welcomeEmail } from '@/domain/email/messages';

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

  // A welcome, once, for an account that is new. Every first entry lands
  // here (email confirmation, magic link, OAuth), and the key keeps it to one
  // message per account however many links they follow.
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (user !== null && Date.now() - new Date(user.created_at).getTime() < 7 * 24 * 60 * 60 * 1000) {
      await notifyAccount(createAdminClient(), {
        userId: user.id,
        kind: 'WELCOME',
        key: `email_welcome_${user.id}`,
        message: welcomeEmail({ appUrl }),
      });
    }
  } catch (error) {
    log.warn('welcome email skipped', {
      requestId,
      route: '/auth/callback',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return NextResponse.redirect(new URL(next, appUrl));
}
