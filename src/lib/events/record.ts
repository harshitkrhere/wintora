/**
 * Funnel events, written by the server into our own table.
 *
 * Five kinds, each recorded at the moment it happens, none carrying a
 * payload: anonymous check answered, account created, first upload, first
 * letter sent, free limit refused. `funnel_summary` counts them per week.
 *
 * Recording never throws and never changes what the caller returns. A
 * request that did its job is not failed because a count could not be
 * written; the failure is logged and the count is simply missing.
 *
 * Anonymous identity is a keyed one-way hash of the network address the
 * free checker's rate limit already uses. The address itself is never
 * stored, and without the key the hash cannot be turned back into one.
 */

import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/logging';

export type ProductEventKind =
  | 'anon_check_completed'
  | 'signup_completed'
  | 'first_document_uploaded'
  | 'first_letter_sent'
  | 'free_limit_hit';

export interface ProductEvent {
  readonly kind: ProductEventKind;
  readonly userId?: string;
  readonly anonHash?: string;
  readonly caseId?: string;
}

/** The narrow slice of the client these helpers need, so tests can fake it. */
export interface EventsClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): unknown;
  };
}

export async function recordProductEvent(admin: EventsClient | SupabaseClient, event: ProductEvent): Promise<void> {
  try {
    const { error } = await (admin as EventsClient).from('product_events').insert({
      kind: event.kind,
      user_id: event.userId ?? null,
      anon_hash: event.anonHash ?? null,
      case_id: event.caseId ?? null,
    });
    if (error !== null) {
      log.warn('product event not recorded', { route: 'events.record', kind: event.kind, errorClass: error.code ?? 'unknown' });
    }
  } catch (error) {
    log.warn('product event not recorded', {
      route: 'events.record',
      kind: event.kind,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * The decision behind every "first" event: given how many qualifying rows
 * the account has now, INCLUDING the one just written, is this the first?
 * Pure, so the rule is testable without a database.
 */
export function isFirst(countIncludingThis: number | null | undefined): boolean {
  return countIncludingThis === 1;
}

/**
 * Record an event only when the account's count of something is exactly one.
 * The count is taken by the caller (it knows the table and the filter), so
 * this stays one line of policy rather than a query builder.
 */
export async function recordIfFirst(
  admin: EventsClient | SupabaseClient,
  event: ProductEvent,
  countIncludingThis: number | null | undefined,
): Promise<boolean> {
  if (!isFirst(countIncludingThis)) return false;
  await recordProductEvent(admin, event);
  return true;
}

/**
 * A stable, keyed hash for a network address. Same address, same hash for
 * as long as the secret is the same; no secret, no way back to the address.
 * Undefined when there is no address to hash.
 */
export function anonymousHash(ip: string | undefined, secret: string | undefined): string | undefined {
  if (ip === undefined || ip.length === 0) return undefined;
  const key = secret !== undefined && secret.length > 0 ? secret : 'development-only-not-a-secret';
  return createHmac('sha256', key).update(`product-events:v1:${ip}`).digest('hex').slice(0, 32);
}
