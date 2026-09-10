/**
 * Supabase clients.
 *
 * Two clients, and the difference matters enormously:
 *
 *   createUserClient()  - carries the signed-in user's session. Subject to RLS.
 *                         Use this for anything the user should be able to do
 *                         themselves; RLS then acts as a second, independent
 *                         check behind the application-layer one.
 *
 *   createAdminClient() - uses service_role, which BYPASSES RLS entirely.
 *                         Server-only. Every call site must already have
 *                         performed an explicit ownership check.
 *
 * See docs/SECURITY.md section 2.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/** Minimal cookie port so this module does not import next/headers directly. */
export interface CookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
}

/**
 * A client scoped to the signed-in user. Reads and writes are constrained by
 * RLS, so a mistake in a handler cannot read another user's rows.
 */
export function createUserClient(cookies: CookieStore): SupabaseClient {
  const env = publicEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url === undefined || anonKey === undefined) {
    throw new Error('Supabase is not configured. See .env.example.');
  }

  return createServerClient(url, anonKey, {
    cookies: {
      get: (name: string) => cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        cookies.set(name, value, options);
      },
      remove: (name: string, options: CookieOptions) => {
        cookies.set(name, '', { ...options, maxAge: 0 });
      },
    },
  });
}

let adminSingleton: SupabaseClient | null = null;

/**
 * service_role client. Bypasses RLS.
 *
 * Only for paths that genuinely need it: webhook processing, entitlement
 * recomputation, the retention sweeper, deletion and export jobs, and writes
 * that a user must not be able to make for themselves (findings, entitlements,
 * usage counters). Never instantiate this in response to unauthenticated input
 * without an ownership check first.
 */
export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never run in a browser context.');
  }

  if (adminSingleton !== null) return adminSingleton;

  const url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = serverEnv().SUPABASE_SERVICE_ROLE_KEY;

  if (url === undefined || serviceKey === undefined) {
    throw new Error('Supabase service role is not configured. See .env.example.');
  }

  adminSingleton = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'wintora-server' } },
  });

  return adminSingleton;
}

/**
 * The authenticated user, or null.
 *
 * Uses `getUser()` rather than `getSession()`: getUser revalidates the token
 * with the auth server, so a forged or stale cookie does not produce a user.
 */
export async function getCurrentUser(
  client: SupabaseClient,
): Promise<{ id: string; email: string | null; lastSignInAt: Date | null } | null> {
  const { data, error } = await client.auth.getUser();
  if (error !== null || data.user === null) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    lastSignInAt:
      data.user.last_sign_in_at !== undefined && data.user.last_sign_in_at !== null
        ? new Date(data.user.last_sign_in_at)
        : null,
  };
}

/** Reset the admin singleton. Test-only. */
export function __resetAdminClient(): void {
  adminSingleton = null;
}
