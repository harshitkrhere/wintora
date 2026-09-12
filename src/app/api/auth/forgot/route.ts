/**
 * POST /api/auth/forgot
 *
 * Sends a password reset link. The response is constant-shaped whether or
 * not the address exists: this endpoint must not be an account-existence
 * oracle. Rate limited per address and per IP like every other auth route.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { handler, ok, parseBody } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { log } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.string().email().max(254) });

const MESSAGE =
  'If an account exists for that address, a link to choose a new password is on its way. It expires in an hour.';

export const POST = handler('/api/auth/forgot', async (request: NextRequest, context) => {
  const body = await parseBody(request, bodySchema);
  enforceRateLimit('AUTH', { userId: body.email.toLowerCase(), ip: clientIp(request.headers) });

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const { error } = await supabase.auth.resetPasswordForEmail(body.email, {
    // The callback exchanges the code for a session, then lands on the page
    // that asks for the new password.
    redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
  });

  if (error !== null) {
    // Logged, never surfaced: the shape of the reply does not change.
    log.warn('password reset request failed', { route: '/api/auth/forgot', errorClass: error.name });
  }

  return ok(context, { message: MESSAGE });
});
