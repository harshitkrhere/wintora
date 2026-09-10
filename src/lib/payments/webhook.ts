/**
 * Provider-agnostic webhook processing.
 *
 * Order of operations, all BEFORE any business state changes:
 *
 *   1. Read raw bytes. Never JSON.parse first: parsing and re-serialising
 *      breaks signature verification for every provider that signs raw bodies.
 *   2. Verify the signature. The adapter does this, because only it knows the
 *      provider's scheme.
 *   3. Claim the event on (provider, event_id). A unique violation means
 *      redelivery: return 200 and change nothing.
 *   4. Reject stale events using the provider's own object timestamp, so a late
 *      delivery cannot roll a subscription backwards.
 *   5. Dispatch on the NORMALISED event kind, so handlers contain no
 *      provider-specific knowledge at all.
 *
 * Step 3 is the real replay defence: a replayed event is a no-op however old
 * it is, and however generous the signature timestamp tolerance was.
 *
 * See docs/BILLING.md section 5 and docs/THREAT_MODEL.md T5.
 */

import { createHash } from 'node:crypto';
import type {
  NormalizedEvent,
  ProviderEventKind,
  ProviderName,
} from '@/domain/billing/provider';

export class WebhookVerificationError extends Error {
  readonly reason: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'MISSING_SECRET';

  constructor(reason: WebhookVerificationError['reason'], detail?: string) {
    super(detail ?? reason);
    this.name = 'WebhookVerificationError';
    this.reason = reason;
  }
}

/** SHA-256 of the raw body. Makes a modified replay of a known id detectable. */
export function hashPayload(rawBody: string | Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export type ClaimResult = 'NEW' | 'DUPLICATE';

export interface WebhookEventStore {
  /**
   * Insert the event row. Returns DUPLICATE on a unique violation, which IS
   * the idempotency mechanism. Must not throw on a duplicate.
   */
  claim(event: {
    provider: ProviderName;
    eventId: string;
    eventType: string;
    payloadHash: string;
    providerCreatedAt: Date | null;
  }): Promise<ClaimResult>;
  markProcessed(eventId: string, status: 'PROCESSED' | 'IGNORED'): Promise<void>;
  markFailed(eventId: string, errorClass: string): Promise<void>;
  /** Provider timestamp last applied to this subscription, for ordering. */
  lastAppliedAt(providerSubscriptionId: string): Promise<Date | null>;
}

export type WebhookHandler = (event: NormalizedEvent) => Promise<void>;

/** Keyed by NORMALISED kind, so one handler map serves every provider. */
export type HandlerMap = Readonly<Partial<Record<ProviderEventKind, WebhookHandler>>>;

export interface ProcessResult {
  readonly outcome: 'PROCESSED' | 'DUPLICATE' | 'IGNORED' | 'STALE' | 'FAILED';
  readonly eventId: string;
  readonly eventType: string;
  readonly errorClass?: string;
}

export async function processWebhookEvent(
  provider: ProviderName,
  store: WebhookEventStore,
  handlers: HandlerMap,
  event: NormalizedEvent,
  payloadHash: string,
): Promise<ProcessResult> {
  const base = { eventId: event.eventId, eventType: event.rawType };

  // 3. Claim. A redelivery stops here having changed nothing.
  const claim = await store.claim({
    provider,
    eventId: event.eventId,
    eventType: event.rawType,
    payloadHash,
    providerCreatedAt: event.occurredAt,
  });

  if (claim === 'DUPLICATE') {
    return { ...base, outcome: 'DUPLICATE' };
  }

  // A recognised event that is not a lifecycle change, or a type we have no
  // handler for. Recorded and acknowledged: a new provider event type must not
  // become a retry storm.
  const handler = event.kind === null ? undefined : handlers[event.kind];
  if (handler === undefined) {
    await store.markProcessed(event.eventId, 'IGNORED');
    return { ...base, outcome: 'IGNORED' };
  }

  // 4. Ordering. A delivery older than what we have already applied is dropped
  //    rather than rolling the subscription backwards.
  const subscriptionId = event.subscription?.providerSubscriptionId ?? null;
  if (subscriptionId !== null && subscriptionId.length > 0) {
    const lastApplied = await store.lastAppliedAt(subscriptionId);
    if (lastApplied !== null && event.occurredAt.getTime() < lastApplied.getTime()) {
      await store.markProcessed(event.eventId, 'IGNORED');
      return { ...base, outcome: 'STALE' };
    }
  }

  // 5. Dispatch.
  try {
    await handler(event);
    await store.markProcessed(event.eventId, 'PROCESSED');
    return { ...base, outcome: 'PROCESSED' };
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : 'UnknownError';
    await store.markFailed(event.eventId, errorClass);
    // The caller returns 500 so the provider retries. Step 3 makes that safe.
    return { ...base, outcome: 'FAILED', errorClass };
  }
}

/** In-memory store for tests. Same semantics as the SQL unique constraint. */
export function createInMemoryWebhookStore(): WebhookEventStore & {
  readonly events: Map<string, { status: string; payloadHash: string }>;
  setLastApplied(subscriptionId: string, at: Date): void;
} {
  const events = new Map<string, { status: string; payloadHash: string }>();
  const applied = new Map<string, Date>();

  return {
    events,
    setLastApplied(subscriptionId, at): void {
      applied.set(subscriptionId, at);
    },
    async claim(event): Promise<ClaimResult> {
      if (events.has(event.eventId)) return 'DUPLICATE';
      events.set(event.eventId, { status: 'RECEIVED', payloadHash: event.payloadHash });
      return 'NEW';
    },
    async markProcessed(eventId, status): Promise<void> {
      const row = events.get(eventId);
      if (row !== undefined) row.status = status;
    },
    async markFailed(eventId, errorClass): Promise<void> {
      const row = events.get(eventId);
      if (row !== undefined) row.status = `FAILED:${errorClass}`;
    },
    async lastAppliedAt(subscriptionId): Promise<Date | null> {
      return applied.get(subscriptionId) ?? null;
    },
  };
}
