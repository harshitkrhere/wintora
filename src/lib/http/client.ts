/**
 * Reading an API failure in the browser, the same way everywhere.
 *
 * Every route answers a failure with { error: { code, message } } (see
 * lib/errors.ts). The code matters for exactly one case the components
 * must all handle alike: UNAUTHENTICATED, a session that has ended under
 * a person mid-flow. They keep what was typed on screen and offer the way
 * back in; nothing is thrown away by a redirect.
 */

export interface ApiFailure {
  readonly code: string | null;
  readonly message: string;
}

export const SESSION_ENDED = 'Your session has ended. Sign in to continue where you were.';

export async function readApiError(response: Response, fallback: string): Promise<ApiFailure> {
  let code: string | null = null;
  let message: string | null = null;
  try {
    const json = (await response.json()) as { error?: { code?: string; message?: string } };
    code = json.error?.code ?? null;
    message = json.error?.message ?? null;
  } catch {
    // Not JSON: a gateway page, an aborted body. The fallback speaks.
  }
  if (response.status === 401 || code === 'UNAUTHENTICATED') {
    return { code: 'UNAUTHENTICATED', message: SESSION_ENDED };
  }
  return { code, message: message ?? fallback };
}

/** The failure to show when the request never reached the service. */
export function offlineFailure(): ApiFailure {
  return { code: 'OFFLINE', message: 'We could not reach the service. Please check your connection and try again.' };
}

export function isSessionEnded(failure: ApiFailure | null): boolean {
  return failure !== null && failure.code === 'UNAUTHENTICATED';
}

/** Where to come back to after signing in again: this page, as it is. */
export function signInHref(): string {
  if (typeof window === 'undefined') return '/signin';
  const here = window.location.pathname + window.location.search;
  return `/signin?next=${encodeURIComponent(here)}`;
}
