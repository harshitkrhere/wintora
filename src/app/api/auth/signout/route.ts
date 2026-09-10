/**
 * POST /api/auth/signout
 *
 * Ends the session. POST rather than GET, so a link or an image tag on another
 * site cannot sign a user out, and so the CSRF origin check applies.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { handler, ok } from '@/lib/http/api';
import { log } from '@/lib/logging';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler('/api/auth/signout', async (_request: NextRequest, context) => {
  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  // Signing out an already-signed-out session is not an error worth surfacing.
  await supabase.auth.signOut();

  log.info('signed out', { route: '/api/auth/signout' });

  return ok(context, { kind: 'SIGNED_OUT', redirectTo: '/' });
});
