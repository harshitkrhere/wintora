/**
 * GET /api/auth/session
 *
 * Answers one question for the header: is there a signed-in user?
 *
 * Exists because the root layout must not read cookies itself. Doing so would
 * opt every route into dynamic rendering, including the public marketing pages
 * whose static prerender and CDN caching the organic-search strategy depends
 * on. A client component asks this endpoint after hydration instead.
 *
 * Returns a boolean and nothing else: no id, no email, no plan. The header does
 * not need them, and a response this small is not worth protecting.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  let signedIn = false;
  try {
    await requireUser();
    signedIn = true;
  } catch {
    // Not signed in. That is an answer, not an error.
  }

  return NextResponse.json(
    { signedIn },
    {
      headers: {
        // Per-user answer. A shared cache serving one visitor's "true" to the
        // next visitor would show a stranger a signed-in header.
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  );
}
