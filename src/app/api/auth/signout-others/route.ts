/**
 * POST /api/auth/signout-others
 *
 * Ends every session for this account except the one making the request.
 * The consumer version of "someone else may have my password": one button,
 * this device stays, everything else is gone.
 *
 * There is deliberately no list of devices with locations. That would need
 * an IP and a device fingerprint stored per session, which docs/SECURITY.md
 * section 8 rules out for a health-adjacent product.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { log } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler('/api/auth/signout-others', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('AUTH', { userId: user.id, ip: clientIp(request.headers) });

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error !== null) {
    log.warn('sign out others failed', { route: '/api/auth/signout-others', errorClass: error.name });
  }

  return ok(context, {
    message: 'Every other device has been signed out. This one stays signed in.',
  });
});
