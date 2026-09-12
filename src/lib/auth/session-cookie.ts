/**
 * Recognising a Supabase session cookie by name.
 *
 * `@supabase/ssr` stores the session as `sb-<project-ref>-auth-token`, split
 * into `.0`, `.1`, ... chunks when it is long. Middleware uses this to decide
 * whether a request is worth a round trip to the auth server at all: an
 * anonymous visitor to a marketing page carries none of these and should not
 * pay for a refresh they cannot need.
 *
 * Pure module: no I/O.
 */

export function hasSessionCookie(names: readonly string[]): boolean {
  return names.some((name) => name.startsWith('sb-') && name.includes('-auth-token'));
}
