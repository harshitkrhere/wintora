/**
 * Typed application errors.
 *
 * Every error carries a PUBLIC message safe to show a user and a PRIVATE detail
 * that stays in the logs. Only the public message is ever serialised to a
 * client, so a database error string cannot leak through an error path.
 * See docs/SECURITY.md section 11.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'ENTITLEMENT_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'BILLING_ERROR'
  | 'PROVIDER_ERROR'
  | 'SAFE_MODE'
  | 'INTERNAL';

const STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  ENTITLEMENT_DENIED: 403,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BILLING_ERROR: 402,
  PROVIDER_ERROR: 502,
  SAFE_MODE: 503,
  INTERNAL: 500,
};

/** Generic fallback. Never reveals what actually happened. */
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Safe to show a user verbatim. */
  readonly publicMessage: string;
  /** Server-side only. Never serialised. */
  readonly detail?: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    publicMessage: string,
    options: { detail?: string; meta?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(publicMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = publicMessage;
    this.detail = options.detail;
    this.meta = options.meta;
  }

  /** The only shape that reaches a client. */
  toResponseBody(requestId: string): {
    error: { code: ErrorCode; message: string; requestId: string };
  } {
    return {
      error: { code: this.code, message: this.publicMessage, requestId },
    };
  }
}

export const unauthenticated = (detail?: string): AppError =>
  new AppError('UNAUTHENTICATED', 'Please sign in to continue.', { detail });

export const forbidden = (detail?: string): AppError =>
  new AppError('FORBIDDEN', 'You do not have access to this.', { detail });

/**
 * Deliberately identical to a genuine 404. Never confirm that a resource
 * belonging to someone else exists.
 */
export const notFound = (detail?: string): AppError =>
  new AppError('NOT_FOUND', 'We could not find that item.', { detail });

export const validationFailed = (
  message: string,
  meta?: Record<string, unknown>,
): AppError => new AppError('VALIDATION_FAILED', message, { meta });

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError(
    'RATE_LIMITED',
    'You have made a lot of requests in a short time. Please wait a moment and try again.',
    { meta: { retryAfterSeconds } },
  );

export const safeMode = (): AppError =>
  new AppError(
    'SAFE_MODE',
    'Document processing is paused while we investigate an issue. Your account and documents are unaffected.',
  );

export const internal = (detail?: string, cause?: unknown): AppError =>
  new AppError('INTERNAL', GENERIC_MESSAGE, { detail, cause });

/**
 * Normalise anything thrown into an AppError. An unrecognised error becomes a
 * generic INTERNAL, so an unexpected exception can never leak its message.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return internal(`${error.name}: ${error.message}`, error);
  }
  return internal(`Non-error thrown: ${String(error)}`);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
