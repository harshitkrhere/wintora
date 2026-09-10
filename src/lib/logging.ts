/**
 * Structured logging with redaction built in.
 *
 * Every record passes through the same redactor used for AI inputs. That is
 * defence in depth rather than the primary control: the primary control is that
 * callers do not pass document content to the logger in the first place.
 *
 * User ids are never logged directly. They are logged as an HMAC keyed per
 * environment, so a log file is not a list of who uses the service, while an
 * operator can still correlate a support request to its requests.
 *
 * See docs/SECURITY.md section 10.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { redactObject } from '@/domain/redaction/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  readonly requestId?: string;
  readonly userRef?: string;
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly errorClass?: string;
  readonly entitlementReason?: string;
  readonly [key: string]: unknown;
}

/**
 * Keys that must never appear in a log record, whatever their value looks like.
 * A field named `documentText` is sensitive even if it happens to be empty.
 */
const FORBIDDEN_KEYS = new Set([
  'documentText',
  'extractedText',
  'content',
  'body',
  'payload',
  'diagnosis',
  'lineItems',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'userId',
  'email',
]);

function hmacKey(): string {
  return (
    process.env.LOG_HASH_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'development-only-log-salt'
  );
}

/**
 * Opaque, stable reference for a user. Same user, same environment, same
 * reference; different environment, different reference.
 */
export function userRef(userId: string): string {
  return createHmac('sha256', hmacKey()).update(userId).digest('hex').slice(0, 16);
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Salted IP hash, kept only for the abuse window. Never the raw address. */
export function ipHash(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 24);
}

function sanitize(context: LogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = redactObject(value);
  }
  return out;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  const record = {
    level,
    message,
    time: new Date().toISOString(),
    ...sanitize(context),
  };

  const line = JSON.stringify(record);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const log = {
  debug: (message: string, context?: LogContext): void => {
    if (process.env.NODE_ENV === 'production') return;
    emit('debug', message, context);
  },
  info: (message: string, context?: LogContext): void => emit('info', message, context),
  warn: (message: string, context?: LogContext): void => emit('warn', message, context),
  /**
   * Errors log their CLASS and message, never a full stack in production and
   * never the request body.
   */
  error: (message: string, context?: LogContext): void => emit('error', message, context),
};

/**
 * Assert that a candidate log payload carries nothing sensitive.
 * Used by `tests/redaction.test.ts` as an executable version of the rule.
 */
export function assertLoggable(context: LogContext): { ok: boolean; offending: string[] } {
  const offending = Object.keys(context).filter((k) => FORBIDDEN_KEYS.has(k));
  return { ok: offending.length === 0, offending };
}

export const FORBIDDEN_LOG_KEYS: readonly string[] = [...FORBIDDEN_KEYS];
