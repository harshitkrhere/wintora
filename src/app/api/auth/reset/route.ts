/**
 * POST /api/auth/reset
 *
 * Sets a new password for the signed-in session. Reached from the recovery
 * link, which the callback has already exchanged for a session, so the only
 * question here is whether the new password is acceptable.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, passwordProblem } from '@/lib/auth/password';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ password: z.string().max(MAX_PASSWORD_LENGTH) });

export const POST = handler('/api/auth/reset', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('AUTH', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const problem = passwordProblem(body.password);
  if (problem !== null) throw new AppError('VALIDATION_FAILED', problem);

  const cookieStore = await cookies();
  const supabase = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      cookieStore.set(name, value, options);
    },
  });

  const { error } = await supabase.auth.updateUser({ password: body.password });
  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not update your password. Please request a new link.', {
      detail: error.name,
    });
  }

  return ok(context, { message: 'Your password has been changed.' });
});
