/**
 * POST /api/auth/oauth
 *
 * Starts an OAuth sign-in. Returns the provider's authorisation URL for the
 * browser to navigate to; it does not redirect itself, so the client can show
 * an error inline if the provider is not configured.
 *
 * Done server-side rather than in the browser for one reason: `next` has to
 * pass through `safeRedirect` before it is embedded in the callback URL. A
 * client-built OAuth URL is an open redirect waiting to happen, because the
 * value survives the whole round trip and comes back as a redirect target.
 *
 * The round trip is: here -> provider -> Supabase -> /auth/callback -> next.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { safeRedirect } from '@/lib/http/safe-redirect';
import { log } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only providers we have actually configured and tested. */
const SUPPORTED_PROVIDERS = ['google'] as const;

const bodySchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
  next: z.string().max(600).optional(),
});

export const POST = handler('/api/auth/oauth', async (request: NextRequest, context) => {
  const body = await parseBody(request, bodySchema);

  enforceRateLimit('AUTH', { ip: clientIp(request.headers) });

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const next = safeRedirect(body.next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: body.provider,
    options: {
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // Ask for the minimum. We need an email address to identify the account
      // and nothing else: no profile, no contacts, no calendar.
      scopes: 'email',
      queryParams: {
        // Force the account chooser rather than silently reusing whichever
        // Google account the browser happens to be signed into. On a shared
        // machine that is the difference between a user's own medical
        // documents and somebody else's.
        prompt: 'select_account',
      },
    },
  });

  if (error !== null || data.url === null || data.url === undefined) {
    log.warn('oauth start failed', {
      route: '/api/auth/oauth',
      provider: body.provider,
      errorClass: error?.name ?? 'NoUrl',
    });

    throw new AppError(
      'PROVIDER_ERROR',
      'Signing in with Google is not available right now. You can use an email address instead.',
      {
        detail:
          `Supabase returned no OAuth URL for ${body.provider}. ` +
          'The provider is probably not enabled in the Supabase dashboard. ' +
          'See docs/DEPLOYMENT.md.',
      },
    );
  }

  return ok(context, { kind: 'REDIRECT', url: data.url });
});
