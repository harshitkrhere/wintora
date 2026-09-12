/**
 * Route handler helpers.
 *
 * Every handler gets: a request id, a validated body, an authenticated user
 * where required, consistent error shaping, and a log line that carries no
 * sensitive data.
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkEntitlement, type CheckContext } from '@/domain/entitlements/check';
import type { EntitlementDecision, EntitlementQuery } from '@/domain/entitlements/types';
import { isSafeMode, publicEnv } from '@/lib/env';
import {
  AppError,
  forbidden,
  toAppError,
  unauthenticated,
  validationFailed,
} from '@/lib/errors';
import { log, newRequestId, userRef } from '@/lib/logging';
import { checkOrigin, isPlaceholderAppUrl } from '@/lib/http/origin';
import { createAdminClient, createUserClient, getCurrentUser } from '@/lib/supabase/server';
import { createEntitlementStore } from '@/lib/supabase/stores';

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
  readonly route: string;
  readonly method: string;
}

export interface AuthedContext extends RequestContext {
  readonly user: { id: string; email: string | null; lastSignInAt: Date | null };
}

export function beginRequest(request: NextRequest, route: string): RequestContext {
  return {
    requestId: newRequestId(),
    startedAt: Date.now(),
    route,
    method: request.method,
  };
}

/**
 * CSRF: state-changing requests must be JSON and must originate from our own
 * origin. Combined with SameSite=Lax session cookies this closes the standard
 * cross-site form and image-tag vectors.
 */
export function assertSameOrigin(request: NextRequest): void {
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const verdict = checkOrigin({
    origin: request.headers.get('origin'),
    appUrl,
    isDevelopment,
    method: request.method,
  });

  if (verdict.ok) return;

  // A placeholder copied out of documentation produces a 403 that looks like a
  // permissions problem and is actually a configuration typo. Say so in the
  // log; the client still sees only the generic message.
  const hint = isPlaceholderAppUrl(appUrl)
    ? ` NEXT_PUBLIC_APP_URL is still a documentation placeholder (${appUrl}). Run: npm run tunnel -- --apply`
    : '';

  throw forbidden(`${verdict.reason}.${hint}`);
}

export function assertJsonContentType(request: NextRequest): void {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Expected a JSON request body.');
  }
}

/** Parse and validate a JSON body. Unvalidated data never reaches the domain. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  assertJsonContentType(request);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw validationFailed('The request body was not valid JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Field names and messages only. Never echo the submitted values back,
    // which could reflect sensitive input into a log or an error page.
    throw validationFailed('Some of the details were not valid.', {
      fields: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
      })),
    });
  }
  return result.data;
}

/**
 * The signed-in user, or null. For pages that render for everyone but can do
 * better with an account: reading it makes the page dynamic, so it must not be
 * called from anything that is meant to be statically prerendered.
 */
export async function optionalUser(): Promise<AuthedContext['user'] | null> {
  const cookieStore = await cookies();
  const client = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      // A Server Component may read cookies but not write them, and this is
      // called from layouts and pages as well as route handlers. Sessions are
      // refreshed in middleware before a page renders, so a write refused
      // here has already been made where it is allowed. Swallowing it is
      // what keeps an expired token from reading as "not signed in".
      try {
        cookieStore.set(name, value, options);
      } catch {
        // Rendering a Server Component. Middleware has this covered.
      }
    },
  });
  return getCurrentUser(client);
}

/** Resolve the signed-in user, or throw 401. */
export async function requireUser(): Promise<AuthedContext['user']> {
  const cookieStore = await cookies();
  const client = createUserClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      // A Server Component may read cookies but not write them, and this is
      // called from layouts and pages as well as route handlers. Sessions are
      // refreshed in middleware before a page renders, so a write refused
      // here has already been made where it is allowed. Swallowing it is
      // what keeps an expired token from reading as "not signed in".
      try {
        cookieStore.set(name, value, options);
      } catch {
        // Rendering a Server Component. Middleware has this covered.
      }
    },
  });

  const user = await getCurrentUser(client);
  if (user === null) throw unauthenticated();
  return user;
}

/**
 * The single authorization call for a route.
 *
 * Note the `resource`: entitlement and ownership are separate questions and
 * both are asked here. Being on Pro entitles you to run an analysis; it does
 * not entitle you to run one on someone else's case.
 */
export async function authorize(
  user: AuthedContext['user'],
  query: Omit<EntitlementQuery, 'userId'>,
): Promise<EntitlementDecision> {
  const admin = createAdminClient();
  const context: CheckContext = {
    store: createEntitlementStore(admin),
    safeMode: isSafeMode(),
    lastAuthenticatedAt: user.lastSignInAt,
  };

  const decision = await checkEntitlement(context, { ...query, userId: user.id });

  if (!decision.allowed) {
    throw new AppError('ENTITLEMENT_DENIED', decision.message, {
      detail: `feature=${decision.feature} reason=${decision.reason}`,
      meta: {
        reason: decision.reason,
        gateState: decision.gateState,
        feature: decision.feature,
        plan: decision.plan,
        remaining: decision.remaining,
        limit: decision.limit,
        resetAt: decision.resetAt,
      },
    });
  }

  return decision;
}

export function ok<T>(context: RequestContext, data: T, status = 200): NextResponse {
  log.info('request completed', {
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    status,
    latencyMs: Date.now() - context.startedAt,
  });

  return NextResponse.json(data, {
    status,
    headers: { 'x-request-id': context.requestId, 'cache-control': 'no-store' },
  });
}

/**
 * Turn anything thrown into a safe response.
 *
 * The client gets a code, a plain message and the request id. Stack traces,
 * database errors and provider messages stay in the server log.
 */
export function fail(context: RequestContext, error: unknown): NextResponse {
  const appError = toAppError(error);

  log.error('request failed', {
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    status: appError.status,
    latencyMs: Date.now() - context.startedAt,
    errorClass: appError.code,
    // The private detail, never the public message, and never a payload.
    detail: appError.detail,
  });

  const body = appError.toResponseBody(context.requestId);
  const withMeta =
    appError.meta !== undefined
      ? { ...body, error: { ...body.error, ...appError.meta } }
      : body;

  return NextResponse.json(withMeta, {
    status: appError.status,
    headers: { 'x-request-id': context.requestId, 'cache-control': 'no-store' },
  });
}

/** Wrap a handler so no route can leak an unhandled exception. */
export function handler(
  route: string,
  fn: (request: NextRequest, context: RequestContext) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const context = beginRequest(request, route);
    try {
      assertSameOrigin(request);
      return await fn(request, context);
    } catch (error) {
      return fail(context, error);
    }
  };
}

/** Opaque reference for logs. Never the raw user id. */
export function refFor(user: { id: string }): string {
  return userRef(user.id);
}

export const uuidSchema = z.string().uuid();
