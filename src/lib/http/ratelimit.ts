/**
 * Rate limiting.
 *
 * Limits apply per account AND per IP, with the tighter of the two winning.
 * IPs are stored only as a salted hash and only for the abuse window: this is a
 * health-adjacent service, and building a persistent identity graph to catch a
 * small amount of abuse would be a worse trade than absorbing it.
 *
 * The in-memory limiter below is correct for a single instance. A multi-region
 * deployment needs a shared store; that is recorded in docs/LIMITATIONS.md
 * rather than pretended away.
 */

import { POLICY } from '@/config/policy';
import { rateLimited } from '@/lib/errors';
import { ipHash } from '@/lib/logging';

export type LimitClass =
  | 'AUTH'
  | 'UPLOAD'
  | 'ANALYSIS'
  | 'LETTER'
  | 'EXPORT'
  | 'PUBLIC_TOOL'
  | 'REFERRAL'
  | 'WEBHOOK'
  | 'GENERAL';

interface LimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Deliberately conservative. These sit ON TOP of plan quotas, not instead of. */
export const LIMITS: Readonly<Record<LimitClass, LimitRule>> = {
  AUTH: { limit: 10, windowSeconds: 900 },
  UPLOAD: { limit: 20, windowSeconds: 3600 },
  ANALYSIS: { limit: 10, windowSeconds: 3600 },
  LETTER: { limit: 15, windowSeconds: 3600 },
  EXPORT: { limit: 3, windowSeconds: 3600 },
  PUBLIC_TOOL: { limit: 20, windowSeconds: 3600 },
  REFERRAL: { limit: 5, windowSeconds: 86_400 },
  WEBHOOK: { limit: 600, windowSeconds: 60 },
  GENERAL: { limit: 120, windowSeconds: 60 },
};

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  lastSweep = now;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

function hit(key: string, rule: LimitRule, now: number): RateLimitResult {
  sweep(now);

  const existing = buckets.get(key);
  if (existing === undefined || existing.resetAt <= now) {
    const resetAt = now + rule.windowSeconds * 1000;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: rule.limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;

  return {
    allowed,
    remaining: Math.max(rule.limit - existing.count, 0),
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Check both dimensions. A shared office IP should not lock out an individual
 * account, and one account should not be able to spread abuse across addresses,
 * so both are checked and the stricter answer wins.
 */
export function checkRateLimit(
  limitClass: LimitClass,
  identity: { userId?: string; ip?: string },
  now: number = Date.now(),
): RateLimitResult {
  const rule = LIMITS[limitClass];
  const results: RateLimitResult[] = [];

  if (identity.userId !== undefined) {
    results.push(hit(`${limitClass}:u:${identity.userId}`, rule, now));
  }
  if (identity.ip !== undefined) {
    const salt = currentIpSalt();
    results.push(hit(`${limitClass}:i:${ipHash(identity.ip, salt)}`, rule, now));
  }
  if (results.length === 0) {
    return { allowed: true, remaining: rule.limit, resetAt: now, retryAfterSeconds: 0 };
  }

  const denied = results.find((r) => !r.allowed);
  if (denied !== undefined) return denied;

  return results.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
}

export function enforceRateLimit(
  limitClass: LimitClass,
  identity: { userId?: string; ip?: string },
): RateLimitResult {
  const result = checkRateLimit(limitClass, identity);
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  return result;
}

/**
 * Salt rotates on the retention boundary, so an IP hash stops being linkable
 * once the abuse window has passed even if the row survives.
 */
function currentIpSalt(): string {
  const days = POLICY.security.ipHashRetentionDays;
  const bucket = Math.floor(Date.now() / (days * 24 * 60 * 60 * 1000));
  return `${process.env.LOG_HASH_SECRET ?? 'development-only-salt'}:${bucket}`;
}

/** Client IP from the platform headers, or undefined when unknown. */
export function clientIp(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return headers.get('x-real-ip') ?? undefined;
}

/** Test-only. */
export function __resetRateLimits(): void {
  buckets.clear();
  lastSweep = Date.now();
}
