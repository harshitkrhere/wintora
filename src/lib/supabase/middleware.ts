/**
 * Session refresh, in middleware.
 *
 * Supabase access tokens expire after an hour. Refreshing one means writing
 * new cookies, and a Server Component is not allowed to write cookies: the
 * write throws inside the auth client, the client reports no user, and a
 * signed-in person is sent to /signin with a perfectly good refresh token
 * still in their browser. Route handlers may write cookies, so the header's
 * session check would quietly succeed while the dashboard bounced. That was
 * the "signed in, but cannot get in" bug.
 *
 * Middleware runs before every page and may write cookies on both the request
 * (so this render sees the new token) and the response (so the browser keeps
 * it). With the refresh done here, Server Components only ever read.
 *
 * See https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { hasSessionCookie } from '@/lib/auth/session-cookie';

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * Refresh the session carried by `request`, if there is one.
 *
 * `makeResponse` builds the response from the request as it stands, and is
 * called again after cookies change so the render downstream sees them. It
 * must read `request.headers` when called, not capture them beforehand.
 */
export async function refreshSession(
  request: NextRequest,
  makeResponse: () => NextResponse,
): Promise<NextResponse> {
  let response = makeResponse();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined || url.length === 0 || anonKey.length === 0) {
    return response;
  }
  if (!hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = makeResponse();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  try {
    // getUser() validates the token with the auth server and refreshes it when
    // it has expired; the user itself is not needed here.
    await supabase.auth.getUser();
  } catch {
    // The auth server was unreachable. The page still renders; whatever needs
    // a user will send the person to sign in.
  }

  return response;
}
