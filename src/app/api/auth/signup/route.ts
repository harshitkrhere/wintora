/**
 * POST /api/auth/signup
 *
 * Account creation.
 *
 * Like sign-in, the response is CONSTANT-SHAPED: an address that already has an
 * account produces the same message as a new one. Otherwise signup becomes an
 * account-enumeration oracle, which for a medical-billing service leaks
 * something worth protecting.
 *
 * Password rules come from docs/SECURITY.md section 1: minimum 12 characters.
 * Breached-password rejection is a Supabase Auth project setting and is listed
 * in docs/LIMITATIONS.md as configuration to enable, not something enforced
 * here.
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
import { passwordProblem } from '@/lib/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
  country: z.enum(['US', 'CA']).optional(),
  next: z.string().max(600).optional(),
});

export const POST = handler('/api/auth/signup', async (request: NextRequest, context) => {
  const body = await parseBody(request, bodySchema);

  enforceRateLimit('AUTH', {
    userId: body.email.toLowerCase(),
    ip: clientIp(request.headers),
  });

  // Password rules are checked here so the message is specific and useful.
  // This is the one place a specific error is safe: it says nothing about
  // whether the account exists.
  const problem = passwordProblem(body.password);
  if (problem !== null) {
    return ok(context, { kind: 'INVALID_PASSWORD', message: problem }, 200);
  }

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const redirectTo = safeRedirect(body.next);

  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      // Country drives jurisdiction-correct guidance. The profile trigger
      // creates the row; this seeds it.
      data: body.country !== undefined ? { country: body.country } : undefined,
    },
  });

  if (error !== null) {
    log.warn('sign-up failed', {
      route: '/api/auth/signup',
      errorClass: error.name,
    });
    // Deliberately the same shape as success. An "email already registered"
    // error must not reach the client.
    return ok(context, { kind: 'CHECK_EMAIL', message: checkEmailMessage() });
  }

  // Supabase returns a user with an empty identities array when the address is
  // already registered. Treat it exactly like a new signup.
  const alreadyRegistered =
    data.user !== null && (data.user.identities?.length ?? 0) === 0;

  if (alreadyRegistered) {
    log.info('sign-up for existing address', { route: '/api/auth/signup' });
    return ok(context, { kind: 'CHECK_EMAIL', message: checkEmailMessage() });
  }

  // Email confirmation on: no session yet, the user must click the link.
  if (data.session === null) {
    return ok(context, { kind: 'CHECK_EMAIL', message: checkEmailMessage() });
  }

  log.info('sign-up completed', { route: '/api/auth/signup' });
  return ok(context, { kind: 'SIGNED_IN', redirectTo }, 201);
});

function checkEmailMessage(): string {
  return (
    'Check your email. If that address can be used, we have sent a link to ' +
    'confirm it. The link expires shortly, so use it soon.'
  );
}
