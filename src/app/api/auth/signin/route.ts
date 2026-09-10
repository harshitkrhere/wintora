/**
 * POST /api/auth/signin
 *
 * Password sign-in, or a magic link when no password is supplied.
 *
 * The response is deliberately CONSTANT-SHAPED. A wrong password and an email
 * that has no account produce the same message and comparable timing, so this
 * endpoint cannot be used to enumerate who has an account. For a service about
 * medical bills, "does this person have an account here" is itself sensitive.
 *
 * See docs/SECURITY.md section 1.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { handler, ok, parseBody } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { safeRedirect } from '@/lib/http/safe-redirect';
import { log } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  // Absent means "send me a magic link instead".
  password: z.string().min(1).max(400).optional(),
  next: z.string().max(600).optional(),
});

/** One message for every failure mode. Never says which part was wrong. */
const GENERIC_FAILURE =
  'That email and password combination did not work. Please check and try again.';

export const POST = handler('/api/auth/signin', async (request: NextRequest, context) => {
  const body = await parseBody(request, bodySchema);

  // Per-IP and per-account, whichever is tighter. Failures feed a security
  // event so a burst across many accounts reads as credential stuffing.
  enforceRateLimit('AUTH', {
    userId: body.email.toLowerCase(),
    ip: clientIp(request.headers),
  });

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const redirectTo = safeRedirect(body.next);

  // --- magic link ---
  if (body.password === undefined) {
    const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
    const { error } = await supabase.auth.signInWithOtp({
      email: body.email,
      options: {
        emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error !== null) {
      log.warn('magic link request failed', {
        route: '/api/auth/signin',
        errorClass: error.name,
      });
    }

    // Same response whether or not the address has an account.
    return ok(context, {
      kind: 'MAGIC_LINK_SENT',
      message:
        'If that email address has an account, a sign-in link is on its way. ' +
        'The link expires shortly, so use it soon.',
    });
  }

  // --- password ---
  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error !== null || data.user === null) {
    log.warn('sign-in failed', {
      route: '/api/auth/signin',
      errorClass: error?.name ?? 'NoUser',
    });
    // 200 with ok:false rather than 401: the client shows the message, and the
    // status code does not become another enumeration signal.
    return ok(context, { kind: 'FAILED', message: GENERIC_FAILURE }, 200);
  }

  log.info('sign-in succeeded', { route: '/api/auth/signin' });

  return ok(context, { kind: 'SIGNED_IN', redirectTo });
});
